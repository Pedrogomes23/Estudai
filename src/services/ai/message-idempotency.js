const PROCESSING_LEASE_MINUTES = 3;

export async function beginMessageRequest(db, { userId, requestId, conversationId, payloadHash }) {
  return db.transaction(async (tx) => {
    const inserted = await tx.get(
      `INSERT INTO ai_message_requests
        (user_id, request_id, conversation_id, payload_hash, status, lease_until)
       VALUES (
         $1, $2, $3, $4, 'processing',
         now() + interval '${PROCESSING_LEASE_MINUTES} minutes'
       )
       ON CONFLICT (user_id, request_id) DO NOTHING
       RETURNING request_id`,
      [userId, requestId, conversationId, payloadHash],
    );

    if (inserted) {
      return { action: 'new' };
    }

    const request = await tx.get(
      `SELECT
         conversation_id,
         payload_hash,
         status,
         user_message_id,
         response,
         lease_until
       FROM ai_message_requests
       WHERE user_id = $1 AND request_id = $2
       FOR UPDATE`,
      [userId, requestId],
    );

    if (!request) {
      throw new Error('Não foi possível registrar a solicitação.');
    }

    if (
      Number(request.conversation_id) !== Number(conversationId) ||
      request.payload_hash.trim() !== payloadHash
    ) {
      return { action: 'conflict' };
    }

    if (request.status === 'completed') {
      return {
        action: 'completed',
        response: request.response,
      };
    }

    if (request.status === 'uncertain') {
      return { action: 'uncertain' };
    }

    if (request.status === 'processing') {
      if (request.lease_until && new Date(request.lease_until) <= new Date()) {
        await tx.run(
          `UPDATE ai_message_requests
           SET status = 'uncertain',
               error_code = 'PROCESSING_LEASE_EXPIRED',
               updated_at = now()
           WHERE user_id = $1 AND request_id = $2`,
          [userId, requestId],
        );

        return { action: 'uncertain' };
      }

      return { action: 'processing' };
    }

    if (request.status === 'retryable') {
      await tx.run(
        `UPDATE ai_message_requests
         SET status = 'processing',
             lease_until = now() + interval '${PROCESSING_LEASE_MINUTES} minutes',
             error_code = NULL,
             updated_at = now()
         WHERE user_id = $1 AND request_id = $2`,
        [userId, requestId],
      );

      return {
        action: 'retry',
        userMessageId: request.user_message_id,
      };
    }

    return { action: 'conflict' };
  });
}

export async function recordMessageRequestUserMessage(db, { userId, requestId, messageId }) {
  const updated = await db.run(
    `UPDATE ai_message_requests
     SET user_message_id = COALESCE(user_message_id, $3),
         updated_at = now()
     WHERE user_id = $1
       AND request_id = $2
       AND status = 'processing'`,
    [userId, requestId, messageId],
  );

  if (updated !== 1) {
    throw new Error('Não foi possível vincular a mensagem à solicitação.');
  }
}

export async function completeMessageRequest(db, { userId, requestId, response }) {
  const updated = await db.run(
    `UPDATE ai_message_requests
     SET status = 'completed',
         response = $3::jsonb,
         error_code = NULL,
         lease_until = NULL,
         updated_at = now()
     WHERE user_id = $1
       AND request_id = $2
       AND status = 'processing'`,
    [userId, requestId, JSON.stringify(response)],
  );

  if (updated !== 1) {
    throw new Error('Não foi possível concluir a solicitação de forma idempotente.');
  }
}

export async function markMessageRequestRetryable(db, { userId, requestId, errorCode }) {
  await db.run(
    `UPDATE ai_message_requests
     SET status = 'retryable',
         error_code = $3,
         lease_until = NULL,
         updated_at = now()
     WHERE user_id = $1
       AND request_id = $2
       AND status = 'processing'`,
    [userId, requestId, errorCode || 'REQUEST_FAILED'],
  );
}

export async function markMessageRequestUncertain(db, { userId, requestId, errorCode }) {
  await db.run(
    `UPDATE ai_message_requests
     SET status = 'uncertain',
         error_code = $3,
         lease_until = NULL,
         updated_at = now()
     WHERE user_id = $1
       AND request_id = $2
       AND status = 'processing'`,
    [userId, requestId, errorCode || 'RESULT_UNCERTAIN'],
  );
}
