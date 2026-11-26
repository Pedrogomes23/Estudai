import { randomUUID } from 'node:crypto';

export const GROQ_QUOTAS = Object.freeze({
  rpm: 30,
  rpd: 1000,
  tpm: 8000,
  tpd: 200000,
  maxOutputTokens: 2048,
  minOutputTokens: 128,
});

function quotaError(message, retryAfterMs = 60000) {
  const error = new Error(message);
  error.code = 'RATE_LIMITED';
  error.status = 429;
  error.retryAfterMs = Math.max(1000, Math.ceil(retryAfterMs));
  return error;
}

function minuteRetry(oldest, now) {
  if (!oldest) return 60000;
  return Math.max(1000, new Date(oldest).getTime() + 60000 - now);
}

export async function reserveGroqCapacity(
  db,
  { model, estimatedInputTokens, preferredOutputTokens = GROQ_QUOTAS.maxOutputTokens },
) {
  const quotaKey = `groq:${model}`;
  const inputTokens = Math.max(1, Math.ceil((Number(estimatedInputTokens) || 1) * 1.2));

  try {
    return await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO ai_provider_quota_control (quota_key)
         VALUES ($1) ON CONFLICT (quota_key) DO NOTHING`,
        [quotaKey],
      );

      const control = await tx.get(
        'SELECT cooldown_until FROM ai_provider_quota_control WHERE quota_key = $1 FOR UPDATE',
        [quotaKey],
      );

      const clock = await tx.get(
        `SELECT now() AS current_time,
                (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day')
                  AT TIME ZONE 'UTC' AS next_day`,
      );

      const now = new Date(clock.current_time).getTime();
      const cooldown = control?.cooldown_until ? new Date(control.cooldown_until).getTime() : 0;

      if (cooldown > now) {
        throw quotaError('A Klyra está aguardando a liberação temporária do provedor.', cooldown - now);
      }

      const stats = await tx.get(
        `SELECT
          COUNT(*) FILTER (
            WHERE created_at >= now() - interval '1 minute'
          )::int AS requests_minute,
          COUNT(*)::int AS requests_day,
          COALESCE(SUM(COALESCE(actual_tokens, reserved_tokens)) FILTER (
            WHERE created_at >= now() - interval '1 minute'
          ), 0)::bigint AS reserved_minute,
          COALESCE(SUM(COALESCE(actual_tokens, reserved_tokens)), 0)::bigint AS reserved_day,
          MIN(created_at) FILTER (
            WHERE created_at >= now() - interval '1 minute'
          ) AS oldest_minute
         FROM ai_provider_quota_usage
         WHERE quota_key = $1
           AND status <> 'released'
           AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
                             AT TIME ZONE 'UTC'`,
        [quotaKey],
      );

      const requestsMinute = Number(stats.requests_minute || 0);
      const requestsDay = Number(stats.requests_day || 0);
      const tokensMinute = Number(stats.reserved_minute || 0);
      const tokensDay = Number(stats.reserved_day || 0);

      const retryCandidates = [];

      if (requestsMinute >= GROQ_QUOTAS.rpm) {
        retryCandidates.push(minuteRetry(stats.oldest_minute, now));
      }

      if (requestsDay >= GROQ_QUOTAS.rpd) {
        retryCandidates.push(new Date(clock.next_day).getTime() - now);
      }

      const availableTokens = Math.min(GROQ_QUOTAS.tpm - tokensMinute, GROQ_QUOTAS.tpd - tokensDay);

      const outputTokens = Math.min(
        GROQ_QUOTAS.maxOutputTokens,
        Math.floor(availableTokens - inputTokens),
        Math.floor(Number(preferredOutputTokens) || GROQ_QUOTAS.maxOutputTokens),
      );

      if (outputTokens < GROQ_QUOTAS.minOutputTokens) {
        if (tokensDay + inputTokens + GROQ_QUOTAS.minOutputTokens > GROQ_QUOTAS.tpd) {
          retryCandidates.push(new Date(clock.next_day).getTime() - now);
        } else {
          retryCandidates.push(minuteRetry(stats.oldest_minute, now));
        }
      }

      if (retryCandidates.length > 0) {
        throw quotaError(
          'A capacidade global da Klyra está temporariamente esgotada. Aguarde e tente novamente.',
          Math.max(...retryCandidates),
        );
      }

      const reservationId = randomUUID();
      const reservedTokens = inputTokens + outputTokens;

      await tx.run(
        `DELETE FROM ai_provider_quota_usage
         WHERE quota_key = $1 AND created_at < now() - interval '2 days'`,
        [quotaKey],
      );

      await tx.run(
        `INSERT INTO ai_provider_quota_usage
          (quota_key, reservation_id, status, reserved_tokens)
         VALUES ($1, $2, 'reserved', $3)`,
        [quotaKey, reservationId, reservedTokens],
      );

      return { reservationId, maxOutputTokens: outputTokens };
    });
  } catch (err) {
    if (err.code === 'RATE_LIMITED') throw err;

    const error = new Error('O controle de capacidade da Klyra está temporariamente indisponível.');
    error.code = 'AI_QUOTA_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
}

export async function settleGroqReservation(db, reservationId, usage) {
  const total = Number(usage?.totalTokens);

  if (!Number.isFinite(total) || total < 0) {
    await db.run(
      `UPDATE ai_provider_quota_usage
       SET status = 'uncertain', finalized_at = now()
       WHERE reservation_id = $1 AND status = 'reserved'`,
      [reservationId],
    );
    return;
  }

  await db.run(
    `UPDATE ai_provider_quota_usage
     SET status = 'settled', actual_tokens = $2, finalized_at = now()
     WHERE reservation_id = $1 AND status = 'reserved'`,
    [reservationId, Math.ceil(total)],
  );
}

export async function markGroqReservationUncertain(db, reservationId, { retryAfterMs } = {}) {
  await db.transaction(async (tx) => {
    const row = await tx.get(
      `UPDATE ai_provider_quota_usage
       SET status = 'uncertain', finalized_at = now()
       WHERE reservation_id = $1
       RETURNING quota_key`,
      [reservationId],
    );

    if (!row || !Number.isFinite(retryAfterMs)) return;

    const delay = Math.max(1000, Math.ceil(retryAfterMs));

    await tx.run(
      `UPDATE ai_provider_quota_control
       SET cooldown_until = GREATEST(
             COALESCE(cooldown_until, '-infinity'::timestamptz),
             now() + ($2::double precision * interval '1 millisecond')
           ),
           updated_at = now()
       WHERE quota_key = $1`,
      [row.quota_key, delay],
    );
  });
}
