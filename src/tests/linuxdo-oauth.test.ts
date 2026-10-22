import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthUrl,
  exchangeCode,
  fetchUserInfo,
  generatePKCE,
  normalizeLinuxDoReturnTo,
  normalizeLinuxDoUser,
} from '../lib/oauth/linuxdo';

process.env.LINUXDO_CLIENT_ID = process.env.LINUXDO_CLIENT_ID || 'fixture-client';
process.env.LINUXDO_CLIENT_SECRET = process.env.LINUXDO_CLIENT_SECRET || 'fixture-secret';

test('normalizeLinuxDoReturnTo only accepts same-origin paths', () => {
  assert.equal(normalizeLinuxDoReturnTo('/settings/upgrade?claim=1'), '/settings/upgrade?claim=1');
  assert.equal(normalizeLinuxDoReturnTo('/chat#top'), '/chat#top');
  for (const value of [undefined, null, '', 'chat', '//evil.test', 'https://evil.test/x', 'javascript:alert(1)', '/\\evil']) {
    assert.equal(normalizeLinuxDoReturnTo(value), '/', String(value));
  }
});

test('buildAuthUrl carries PKCE, state, redirect and scope', () => {
  const { codeChallenge } = generatePKCE();
  const url = new URL(buildAuthUrl('state-1', codeChallenge, 'https://mingai.fun/api/auth/linuxdo/callback'));
  assert.equal(url.origin, 'https://connect.linux.do');
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'fixture-client');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.get('code_challenge'), codeChallenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://mingai.fun/api/auth/linuxdo/callback');
  assert.equal(url.searchParams.get('scope'), 'openid profile email');
});

test('normalizeLinuxDoUser maps profile fields and keeps unverified email explicit', () => {
  const verified = normalizeLinuxDoUser({
    sub: '42', email: 'user@linux.do', email_verified: true,
    preferred_username: 'alice', name: 'Alice', picture: 'https://cdn.example/a.png',
    trust_level: 3,
  });
  assert.deepEqual(
    {
      sub: verified.sub,
      email: verified.email,
      emailVerified: verified.email_verified,
      nickname: verified.preferred_username,
      avatarUrl: verified.picture,
      trustLevel: verified.trust_level,
      name: verified.name,
    },
    {
      sub: '42', email: 'user@linux.do', emailVerified: true,
      nickname: 'alice', avatarUrl: 'https://cdn.example/a.png', trustLevel: 3,
      name: 'Alice',
    },
  );

  const unverified = normalizeLinuxDoUser({ sub: '43', email: 'other@linux.do', email_verified: false, preferred_username: 'other' });
  assert.equal(unverified.email_verified, false);
  assert.equal(unverified.name, 'other');
  assert.throws(() => normalizeLinuxDoUser({ email: 'x@linux.do', preferred_username: 'x' }), /missing sub/u);
  assert.throws(() => normalizeLinuxDoUser({ sub: '1', email: 'x@linux.do' }), /missing preferred username/u);
});

test('exchangeCode falls back to the secondary token endpoint', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (calls.length === 1) return new Response('unavailable', { status: 503 });
    return Response.json({ access_token: 'token-1', token_type: 'bearer' });
  });

  const token = await exchangeCode('code', 'verifier', 'https://mingai.fun/api/auth/linuxdo/callback');
  assert.equal(token.access_token, 'token-1');
  assert.deepEqual(calls, [
    'https://connect.linux.do/oauth2/token',
    'https://connect.linuxdo.org/oauth2/token',
  ]);
});

test('exchangeCode refuses to retry on a client error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('denied', { status: 400 }));
  await assert.rejects(
    exchangeCode('code', 'verifier', 'https://mingai.fun/api/auth/linuxdo/callback'),
    /Token exchange failed/u,
  );
});

test('fetchUserInfo falls back to the secondary userinfo endpoint', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    if (calls === 1) return new Response('unavailable', { status: 502 });
    return Response.json({ sub: '7', email: 'u@linux.do', email_verified: true, username: 'u' });
  });
  const user = await fetchUserInfo('token-1');
  assert.equal(user.sub, '7');
  assert.equal(user.email_verified, true);
  assert.equal(calls, 2);
});
