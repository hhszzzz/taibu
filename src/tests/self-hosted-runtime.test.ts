import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest, NextResponse } from 'next/server';
import { authCookieOptions, buildSessionFromUser, setSessionCookies } from '../lib/auth-session';
import { getSupabasePublicUrl, getSupabaseUrl, toPublicStorageUrl } from '../lib/supabase-env';
import { isSelfHosted, parseConfiguredOrigin } from '../lib/runtime-env';
import { blockRouteNetwork } from './helpers/route-mock';
import { createMockAuthContext } from './helpers/supabase-mock';

function environment(t: TestContext, overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
        NODE_ENV: 'production', SELF_HOSTED: undefined, APP_ORIGIN: undefined,
        AUTH_ALLOW_INSECURE_LOCAL_HTTP: undefined, SUPABASE_PUBLIC_URL: undefined,
        SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'offline-fixture',
        ...overrides,
    };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    const apply = (settings: typeof values) => {
        for (const [key, value] of Object.entries(settings)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    };
    apply(values);
    t.after(() => apply(previous));
    blockRouteNetwork(t);
}

const local = {
    SELF_HOSTED: 'true', APP_ORIGIN: 'http://localhost:3000',
    AUTH_ALLOW_INSECURE_LOCAL_HTTP: 'true', SUPABASE_URL: 'http://gateway:8000',
    SUPABASE_PUBLIC_URL: 'http://localhost:8000',
};

for (const selfHosted of [false, true]) {
    test(`session creation and deletion share cookie policy (self-hosted=${selfHosted})`, t => {
        environment(t, selfHosted ? local : {});
        const session = buildSessionFromUser(createMockAuthContext({}).user, 'access', 'refresh');
        for (const value of [session, null]) {
            const response = NextResponse.json({});
            setSessionCookies(response, value);
            for (const cookie of response.cookies.getAll()) {
                assert.equal(cookie.httpOnly, true);
                assert.equal(cookie.sameSite, 'lax');
                assert.equal(cookie.path, '/');
                assert.equal(Boolean(cookie.secure), !selfHosted);
                if (!value) {
                    assert.equal(cookie.maxAge, 0);
                    assert.equal((cookie.expires as Date).getTime(), 0);
                }
            }
        }
    });
}

for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    test(`explicit local HTTP opt-in accepts ${origin}`, t => {
        environment(t, { ...local, APP_ORIGIN: origin });
        assert.equal(authCookieOptions().secure, false);
    });
}

for (const origin of [undefined, 'http://example.com', 'https://localhost', 'http://localhost.evil.test',
    'http://127.1', 'http://2130706433', 'http://0.0.0.0', 'http://user@localhost',
    'http://localhost/path', 'http://localhost?x=1', 'http://localhost#x', ' http://localhost',
    'http://localhost/../', 'file:///localhost']) {
    test(`unsafe local cookie origin is rejected: ${origin}`, t => {
        environment(t, { ...local, APP_ORIGIN: origin });
        assert.throws(() => authCookieOptions());
    });
}

test('hosted defaults and non-opted-in self-hosted cookies remain secure', t => {
    environment(t, { APP_ORIGIN: 'http://localhost:3000' });
    assert.equal(isSelfHosted(), false);
    assert.equal(authCookieOptions().secure, true);
    process.env.AUTH_ALLOW_INSECURE_LOCAL_HTTP = 'true';
    assert.throws(() => authCookieOptions());
    delete process.env.AUTH_ALLOW_INSECURE_LOCAL_HTTP;
    process.env.SELF_HOSTED = 'true';
    Object.assign(process.env, { NODE_ENV: 'development' });
    assert.equal(authCookieOptions().secure, true);
    delete process.env.SELF_HOSTED;
    assert.equal(authCookieOptions().secure, false);
});

for (const selfHosted of [false, true]) {
    test(`LinuxDo state creation/deletion uses shared policy without trusting Host (${selfHosted})`, async t => {
        environment(t, { ...(selfHosted ? local : {}), LINUXDO_CLIENT_ID: 'offline-client' });
        const start = require('../app/api/auth/linuxdo/route') as typeof import('../app/api/auth/linuxdo/route');
        const callback = require('../app/api/auth/linuxdo/callback/route') as typeof import('../app/api/auth/linuxdo/callback/route');
        const created = await start.GET(new NextRequest('http://attacker.test/api/auth/linuxdo'));
        const deleted = await callback.GET(new NextRequest('http://attacker.test/api/auth/linuxdo/callback?error=access_denied'));
        for (const response of [created, deleted]) {
            const cookie = response.cookies.get('linuxdo-oauth-state');
            assert.ok(cookie);
            assert.equal(Boolean(cookie.secure), !selfHosted);
            assert.equal(cookie.httpOnly, true);
            assert.equal(cookie.sameSite, 'lax');
            assert.equal(cookie.path, '/');
        }
        assert.equal(deleted.cookies.get('linuxdo-oauth-state')?.maxAge, 0);
    });
}

test('storage URLs use a controlled browser origin and preserve encoded keys', t => {
    environment(t, local);
    assert.equal(getSupabaseUrl(), 'http://gateway:8000');
    assert.equal(getSupabasePublicUrl(), 'http://localhost:8000');
    assert.equal(toPublicStorageUrl('http://gateway:8000/storage/v1/object/public/avatars/user/a%20b%252F.png'),
        'http://localhost:8000/storage/v1/object/public/avatars/user/a%20b%252F.png');
    for (const url of ['http://evil.test/storage/v1/object/public/avatars/a.png',
        'http://gateway:8000/auth/v1/user', 'http://user@gateway:8000/storage/v1/object/public/avatars/a.png']) {
        assert.throws(() => toPublicStorageUrl(url));
    }
    delete process.env.SUPABASE_PUBLIC_URL;
    assert.throws(() => getSupabasePublicUrl());
    for (const invalid of ['http://localhost:8000/path', 'http://user@localhost:8000', 'file:///tmp', 'https://*.example.com']) {
        assert.throws(() => parseConfiguredOrigin(invalid, 'SUPABASE_PUBLIC_URL'));
    }
});

test('hosted public URL default is unchanged', t => {
    environment(t, { SUPABASE_PUBLIC_URL: 'http://ignored.test' });
    const url = 'https://fixture.supabase.co/storage/v1/object/public/avatars/user.png';
    assert.equal(toPublicStorageUrl(url), url);
    assert.equal(getSupabasePublicUrl(), getSupabaseUrl());
});

test('storage GET and upload return browser URLs and retain ownership checks', async t => {
    environment(t, local);
    let uploads = 0;
    const client = { storage: { from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `http://gateway:8000/storage/v1/object/public/avatars/${path}` } }),
        upload: async (path: string) => { uploads++; return { data: { path }, error: null }; },
    }) } };
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api, 'getAuthContext', async () => createMockAuthContext({}, 'user-1'));
    t.mock.method(api, 'createUserStorageClient', () => client);
    t.mock.method(api, 'createRequestSupabaseClient', async () => client);
    const route = require('../app/api/supabase/storage/route') as typeof import('../app/api/supabase/storage/route');
    const response = await route.GET(new NextRequest('http://attacker.test/api/supabase/storage?bucket=avatars&path=user-1.png'));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'http://localhost:8000/storage/v1/object/public/avatars/user-1.png');
    for (const [path, status] of [['user-1-avatar.png', 200], ['other-avatar.png', 403], ['../user-1.png', 400]] as const) {
        const body = new FormData();
        body.set('bucket', 'avatars');
        body.set('path', path);
        body.set('file', new File(['image'], 'avatar.png', { type: 'image/png' }));
        const uploaded = await route.POST(new NextRequest('http://localhost/api/supabase/storage', { method: 'POST', body }));
        assert.equal(uploaded.status, status);
        if (status === 200) assert.equal((await uploaded.json()).data.publicUrl,
            'http://localhost:8000/storage/v1/object/public/avatars/user-1-avatar.png');
    }
    assert.equal(uploads, 1);
    assert.equal((await route.GET(new NextRequest('http://localhost/api/supabase/storage?bucket=private&path=user-1.png'))).status, 403);
    t.mock.method(api, 'getAuthContext', async () => ({ ...createMockAuthContext({}, 'user-1'), user: null }));
    assert.equal((await route.POST(new NextRequest('http://localhost/api/supabase/storage', { method: 'POST' }))).status, 401);
});

for (const selfHosted of [false, true]) {
    test(`image config only allows the configured storage origin (${selfHosted})`, t => {
        environment(t, selfHosted ? local : {});
        const configPath = require.resolve('../../next.config');
        delete require.cache[configPath];
        t.after(() => { delete require.cache[configPath]; });
        const config = (require('../../next.config') as { default: import('next').NextConfig }).default;
        assert.deepEqual(config.images?.remotePatterns?.[0], {
            protocol: selfHosted ? 'http' : 'https',
            hostname: selfHosted ? 'localhost' : 'gdaaipkdmwxkvgesknsp.supabase.co',
            port: selfHosted ? '8000' : '',
            pathname: '/storage/v1/object/public/**',
        });
        assert.notEqual(config.images?.dangerouslyAllowLocalIP, true);
        assert.equal(config.images?.remotePatterns?.length, 3);
    });
}

test('health is unauthenticated liveness and needs no Supabase configuration', async t => {
    environment(t, { SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined });
    const { GET } = require('../app/api/health/route') as typeof import('../app/api/health/route');
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true });
});
