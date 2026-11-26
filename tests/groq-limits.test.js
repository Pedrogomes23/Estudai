import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import {
  reserveGroqCapacity,
  settleGroqReservation,
  markGroqReservationUncertain,
} from '../src/services/ai/groq-limits.js';

test('controle global de cotas da Groq', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  await t.test('serializa reservas concorrentes e respeita RPM 30', async () => {
    const reservations = await Promise.all(
      Array.from({ length: 30 }, () =>
        reserveGroqCapacity(srv.db, {
          model: 'test-rpm',
          estimatedInputTokens: 1,
          preferredOutputTokens: 128,
        }),
      ),
    );

    assert.equal(reservations.length, 30);

    await assert.rejects(
      reserveGroqCapacity(srv.db, {
        model: 'test-rpm',
        estimatedInputTokens: 1,
        preferredOutputTokens: 128,
      }),
      (error) => {
        assert.equal(error.code, 'RATE_LIMITED');
        assert.equal(error.status, 429);
        assert.ok(error.retryAfterMs >= 1000);
        return true;
      },
    );
  });

  await t.test('reconcilia a reserva com o consumo real informado', async () => {
    const first = await reserveGroqCapacity(srv.db, {
      model: 'test-reconcile',
      estimatedInputTokens: 4000,
      preferredOutputTokens: 2048,
    });

    await settleGroqReservation(srv.db, first.reservationId, {
      totalTokens: 500,
    });

    const second = await reserveGroqCapacity(srv.db, {
      model: 'test-reconcile',
      estimatedInputTokens: 5000,
      preferredOutputTokens: 128,
    });

    assert.equal(second.maxOutputTokens, 128);

    const rows = await srv.db.get(
      `SELECT status, reserved_tokens, actual_tokens
       FROM ai_provider_quota_usage
       WHERE reservation_id = $1`,
      [first.reservationId],
    );

    assert.equal(rows.status, 'settled');
    assert.equal(Number(rows.actual_tokens), 500);
    assert.ok(Number(rows.reserved_tokens) > Number(rows.actual_tokens));
  });

  await t.test('compartilha cooldown após falha com Retry-After', async () => {
    const reservation = await reserveGroqCapacity(srv.db, {
      model: 'test-cooldown',
      estimatedInputTokens: 100,
      preferredOutputTokens: 128,
    });

    await markGroqReservationUncertain(srv.db, reservation.reservationId, { retryAfterMs: 10000 });

    await assert.rejects(
      reserveGroqCapacity(srv.db, {
        model: 'test-cooldown',
        estimatedInputTokens: 100,
        preferredOutputTokens: 128,
      }),
      (error) => {
        assert.equal(error.code, 'RATE_LIMITED');
        assert.ok(error.retryAfterMs >= 9000);
        return true;
      },
    );
  });

  await t.test('mantém RLS habilitado nas tabelas de cotas', async () => {
    const result = await srv.db.all(
      `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema()
         AND c.relname IN (
           'ai_provider_quota_control',
           'ai_provider_quota_usage'
         )
       ORDER BY c.relname`,
    );

    assert.equal(result.length, 2);
    assert.ok(result.every((row) => row.relrowsecurity === true));
  });
});
