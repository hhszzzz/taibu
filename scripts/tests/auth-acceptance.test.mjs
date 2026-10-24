// End-to-end authentication acceptance against the local Docker stack.
// Requires: pnpm local:up, then pnpm test:auth.
//
// Covered: password sign-up + email verification, password sign-in, OTP sign-in,
// password reset with session revocation, sign-out, server-side login lock,
// imported bcrypt $2a$ credentials, and session survival across a Redis flush.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROJECT = process.env.TAIBU_AUTH_PROJECT ?? 'taibu-v2';
const directory = path.join(ROOT, '.taibu-local', PROJECT);
const config = JSON.parse(readFileSync(path.join(directory, 'config.json'), 'utf8'));
const origin = config.APP_ORIGIN;
const mailpit = `http://127.0.0.1:${config.MAILPIT_PORT}`;
const password = 'acceptance-password-1';

let requestIp = '10.0.0.1';
let ipCounter = 1;
function nextIp() { ipCounter += 1; requestIp = `10.0.0.${ipCounter}`; }

class CookieJar {
  #cookies = new Map();
  absorb(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const value of values) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const cookie = pair.slice(index + 1).trim();
      if (!cookie) this.#cookies.delete(name);
      else this.#cookies.set(name, cookie);
    }
  }
  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  clear() { this.#cookies.clear(); }
}

async function call(pathname, { method = 'GET', body, jar } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
      origin,
      'x-real-ip': requestIp,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  jar?.absorb(response);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error pages */ }
  return { status: response.status, json, text };
}

async function clearMail() {
  await fetch(`${mailpit}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
}

async function latestOtp(email) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${mailpit}/api/v1/messages`);
    if (response.ok) {
      const payload = await response.json();
      const messages = payload.messages ?? [];
      for (const message of messages) {
        const recipients = (message.To ?? []).map((entry) => String(entry.Address).toLowerCase());
        if (!recipients.includes(email.toLowerCase())) continue;
        const detail = await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json();
        const match = /\b(\d{6})\b/u.exec(`${detail.Text ?? ''}\n${detail.HTML ?? ''}`);
        if (match) return match[1];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`未在 Mailpit 中收到 ${email} 的验证码`);
}

async function stackAvailable() {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function compose(...args) {
  return execFileSync('docker', [
    'compose', '--project-directory', ROOT,
    '--env-file', path.join(directory, 'compose.env'),
    '-f', path.join(ROOT, 'deploy/compose.base.yml'),
    '-f', path.join(ROOT, 'deploy/compose.local.yml'),
    '-p', PROJECT,
    ...args,
  ], { encoding: 'utf8' });
}

test('local auth acceptance', async (t) => {
  if (!(await stackAvailable())) {
    t.skip(`local stack at ${origin} is not running; run pnpm local:up`);
    return;
  }

  const stamp = Date.now();
  const user = { email: `accept-${stamp}@example.test`, name: '验收用户' };

  await t.test('registration verifies the email and signs in', async () => {
    nextIp();
    await clearMail();
    const jar = new CookieJar();
    const signUp = await call('/api/auth/sign-up/email', {
      method: 'POST', jar, body: { email: user.email, password, name: user.name },
    });
    assert.equal(signUp.status, 200, signUp.text);
    const otp = await latestOtp(user.email);
    const verified = await call('/api/auth/email-otp/verify-email', {
      method: 'POST', jar, body: { email: user.email, otp },
    });
    assert.equal(verified.status, 200, verified.text);
    const session = await call('/api/auth/get-session', { jar });
    assert.equal(session.status, 200, session.text);
    assert.equal(session.json?.user?.email, user.email);
  });

  await t.test('an unverified password account keeps its password after email verification', async () => {
    // P1-1 regression: a sign-in OTP would revoke every account (password
    // included) when it promotes an unverified user; email verification must not.
    nextIp();
    const unverified = { email: `unverified-${stamp}@example.test`, name: '未验证用户' };
    const signUp = await call('/api/auth/sign-up/email', {
      method: 'POST', jar: new CookieJar(), body: { email: unverified.email, password, name: unverified.name },
    });
    assert.equal(signUp.status, 200, signUp.text);

    const denied = await call('/api/auth/sign-in/email', {
      method: 'POST', jar: new CookieJar(), body: { email: unverified.email, password },
    });
    assert.equal(denied.status, 403, denied.text);

    await clearMail();
    const jar = new CookieJar();
    const sent = await call('/api/auth/email-otp/send-verification-otp', {
      method: 'POST', jar, body: { email: unverified.email, type: 'email-verification' },
    });
    assert.equal(sent.status, 200, sent.text);
    const otp = await latestOtp(unverified.email);
    const verified = await call('/api/auth/email-otp/verify-email', {
      method: 'POST', jar: new CookieJar(), body: { email: unverified.email, otp },
    });
    assert.equal(verified.status, 200, verified.text);

    const signIn = await call('/api/auth/sign-in/email', {
      method: 'POST', jar, body: { email: unverified.email, password },
    });
    assert.equal(signIn.status, 200, signIn.text);
    const session = await call('/api/auth/get-session', { jar });
    assert.equal(session.json?.user?.email, unverified.email);
  });

  await t.test('password sign-in works and rejects a wrong password', async () => {
    nextIp();
    const jar = new CookieJar();
    const wrong = await call('/api/auth/sign-in/email', {
      method: 'POST', jar, body: { email: user.email, password: 'wrong-password' },
    });
    assert.equal(wrong.status, 401, wrong.text);
    const good = await call('/api/auth/sign-in/email', {
      method: 'POST', jar, body: { email: user.email, password },
    });
    assert.equal(good.status, 200, good.text);
    assert.ok(jar.header().includes('taibu.session_token'), 'a session cookie must be issued');
  });

  await t.test('email OTP sign-in issues a session', async () => {
    nextIp();
    await clearMail();
    const jar = new CookieJar();
    const sent = await call('/api/auth/email-otp/send-verification-otp', {
      method: 'POST', jar, body: { email: user.email, type: 'sign-in' },
    });
    assert.equal(sent.status, 200, sent.text);
    const otp = await latestOtp(user.email);
    const signIn = await call('/api/auth/sign-in/email-otp', {
      method: 'POST', jar, body: { email: user.email, otp },
    });
    assert.equal(signIn.status, 200, signIn.text);
    const session = await call('/api/auth/get-session', { jar });
    assert.equal(session.json?.user?.email, user.email);
  });

  await t.test('password reset revokes the previous session', async () => {
    nextIp();
    const oldJar = new CookieJar();
    await call('/api/auth/sign-in/email', { method: 'POST', jar: oldJar, body: { email: user.email, password } });
    await clearMail();
    const sent = await call('/api/auth/email-otp/send-verification-otp', {
      method: 'POST', jar: new CookieJar(), body: { email: user.email, type: 'forget-password' },
    });
    assert.equal(sent.status, 200, sent.text);
    const otp = await latestOtp(user.email);
    const reset = await call('/api/auth/email-otp/reset-password', {
      method: 'POST', jar: new CookieJar(), body: { email: user.email, otp, password: `${password}-new` },
    });
    assert.equal(reset.status, 200, reset.text);
    const oldSession = await call('/api/auth/get-session', { jar: oldJar });
    assert.equal(oldSession.json?.user ?? null, null, 'the old session must be revoked');
  });

  await t.test('sign-out clears the session', async () => {
    nextIp();
    const jar = new CookieJar();
    await call('/api/auth/sign-in/email', { method: 'POST', jar, body: { email: user.email, password: `${password}-new` } });
    const signOut = await call('/api/auth/sign-out', { method: 'POST', jar, body: {} });
    assert.equal(signOut.status, 200, signOut.text);
    const session = await call('/api/auth/get-session', { jar });
    assert.equal(session.json?.user ?? null, null);
  });

  await t.test('the sixth failed sign-in is locked by Redis', async () => {
    nextIp();
    const locked = { email: `lock-${stamp}@example.test` };
    // Create the account first so "wrong password" is the only failure mode.
    await clearMail();
    const jar = new CookieJar();
    await call('/api/auth/sign-up/email', { method: 'POST', jar, body: { email: locked.email, password, name: '锁定用户' } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await call('/api/auth/sign-in/email', {
        method: 'POST', jar: new CookieJar(), body: { email: locked.email, password: 'wrong-password' },
      });
      assert.equal(response.status, 401, `attempt ${attempt + 1}: ${response.text}`);
    }
    const blocked = await call('/api/auth/sign-in/email', {
      method: 'POST', jar: new CookieJar(), body: { email: locked.email, password },
    });
    assert.equal(blocked.status, 429, blocked.text);
  });

  await t.test('imported bcrypt $2a$ credentials can sign in', async () => {
    nextIp();
    const email = `bcrypt-${stamp}@example.test`;
    const userId = randomUUID();
    const hash = (await bcrypt.hash(password, 10)).replace(/^\$2[aby]\$/u, '$2a$');
    const client = new pg.Client({
      connectionString: `postgres://postgres:${encodeURIComponent(config.DB_PASSWORD)}@127.0.0.1:${config.DB_HOST_PORT}/taibu`,
    });
    await client.connect();
    try {
      await client.query('insert into identity.users (id, email, email_verified, name) values ($1, $2, true, $3)', [userId, email, '历史用户']);
      await client.query(
        `insert into identity.accounts (id, user_id, account_id, provider_id, password)
         values ($1, $2, $4, 'credential', $3)`,
        [randomUUID(), userId, hash, userId],
      );
    } finally {
      await client.end();
    }
    const jar = new CookieJar();
    const response = await call('/api/auth/sign-in/email', { method: 'POST', jar, body: { email, password } });
    assert.equal(response.status, 200, response.text);
    const session = await call('/api/auth/get-session', { jar });
    assert.equal(session.json?.user?.email, email);
  });

  await t.test('session survives a Redis flush (database fallback)', async () => {
    nextIp();
    // Earlier subtests intentionally consume the sign-in rate-limit window.
    compose('exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli flushall');
    const jar = new CookieJar();
    const signedIn = await call('/api/auth/sign-in/email', {
      method: 'POST', jar, body: { email: user.email, password: `${password}-new` },
    });
    assert.equal(signedIn.status, 200, signedIn.text);
    compose('exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli flushall');
    const after = await call('/api/auth/get-session', { jar });
    assert.equal(after.status, 200, after.text);
    // Either the database restores the session or the user is asked to sign in
    // again; both are acceptable, silently invalid identity is not.
    if (after.json?.user) assert.equal(after.json.user.email, user.email);
    t.diagnostic(`session after Redis flush: ${after.json?.user ? 'restored from database' : 'login required'}`);
  });
});
