// Verifies the Agent wake-up triggers against the running local stack.
// Run after `pnpm local:up`; it writes and removes one throwaway run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROJECT = process.env.TAIBU_NOTIFY_PROJECT ?? 'taibu-v2';
const config = JSON.parse(readFileSync(path.join(ROOT, '.taibu-local', PROJECT, 'config.json'), 'utf8'));
const dsn = `postgres://postgres:${encodeURIComponent(config.DB_PASSWORD)}@127.0.0.1:${config.DB_HOST_PORT}/taibu`;

function collector(client) {
  const messages = [];
  const waiters = [];
  client.on('notification', (message) => {
    if (message.channel !== 'taibu-agent' || !message.payload) return;
    const payload = JSON.parse(message.payload);
    messages.push(payload);
    for (const waiter of [...waiters]) waiter(payload);
  });
  return async function waitFor(predicate, timeoutMs = 5_000) {
    const existing = messages.find(predicate);
    if (existing) return existing;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(check), 1);
        reject(new Error(`notification timeout; saw ${JSON.stringify(messages)}`));
      }, timeoutMs);
      const check = (payload) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        waiters.splice(waiters.indexOf(check), 1);
        resolve(payload);
      };
      waiters.push(check);
    });
  };
}

test('Agent triggers publish run, queue, event and command payloads', { timeout: 30_000 }, async () => {
  const listener = new pg.Client({ connectionString: dsn });
  const writer = new pg.Client({ connectionString: dsn });
  await listener.connect();
  await writer.connect();
  await listener.query('listen "taibu-agent"');
  const waitFor = collector(listener);

  const userId = randomUUID();
  const conversationId = randomUUID();
  const runId = randomUUID();
  try {
    await writer.query(
      'insert into identity.users (id, email, email_verified, name) values ($1, $2, true, $3)',
      [userId, `notify-${userId}@fixture.test`, '通知测试'],
    );
    await writer.query('insert into conversations (id, user_id) values ($1, $2)', [conversationId, userId]);

    const queued = writer.query(
      `insert into agent_runs (id, user_id, conversation_id, request_id, request_hash, input, checkpoint, public_message, billing)
       values ($1, $2, $3, 'notify-test', 'hash', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'exempt')`,
      [runId, userId, conversationId],
    );
    assert.deepEqual(await waitFor((payload) => payload.t === 'run' && payload.run === runId), {
      t: 'run', run: runId, status: 'queued', cancel: false,
    });
    assert.deepEqual(await waitFor((payload) => payload.t === 'queue'), { t: 'queue' });
    await queued;

    const { rows: [event] } = await writer.query(
      `insert into agent_run_events (run_id, type, payload) values ($1, 'test', '{}'::jsonb) returning sequence`,
      [runId],
    );
    assert.deepEqual(await waitFor((payload) => payload.t === 'event' && payload.run === runId), {
      t: 'event', run: runId, seq: Number(event.sequence),
    });

    await writer.query(
      `insert into agent_run_commands (run_id, request_id, mode, message, sort_order)
       values ($1, 'notify-command', 'steer', '{}'::jsonb, 1)`,
      [runId],
    );
    assert.deepEqual(await waitFor((payload) => payload.t === 'cmd' && payload.run === runId), {
      t: 'cmd', run: runId,
    });

    await writer.query(`update agent_runs set cancel_requested = true where id = $1`, [runId]);
    const cancelled = await waitFor((payload) => payload.t === 'run' && payload.run === runId && payload.cancel === true);
    assert.equal(cancelled.status, 'queued');
  } finally {
    await writer.query('delete from agent_runs where id = $1', [runId]).catch(() => {});
    await writer.query('delete from conversations where id = $1', [conversationId]).catch(() => {});
    await writer.query('delete from identity.users where id = $1', [userId]).catch(() => {});
    await listener.end().catch(() => {});
    await writer.end().catch(() => {});
  }
});
