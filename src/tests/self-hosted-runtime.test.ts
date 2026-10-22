import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfiguredOrigin, shouldSecureAuthCookies } from '../lib/runtime-env';

function environment(t: TestContext, overrides: Record<string, string | undefined>) {
    const values: Record<string, string | undefined> = {
        NODE_ENV: 'production',
        APP_ORIGIN: undefined,
        AUTH_ALLOW_INSECURE_LOCAL_HTTP: undefined,
        ...overrides,
    };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    t.after(() => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

test('parseConfiguredOrigin accepts origins with an optional trailing slash', () => {
    assert.equal(parseConfiguredOrigin('https://mingai.fun', 'APP_ORIGIN').origin, 'https://mingai.fun');
    assert.equal(parseConfiguredOrigin('https://mingai.fun/', 'APP_ORIGIN').origin, 'https://mingai.fun');
    assert.equal(parseConfiguredOrigin('http://localhost:3000', 'APP_ORIGIN').origin, 'http://localhost:3000');
});

for (const value of [undefined, '', 'mingai.fun', 'file:///tmp', 'https://*.example.com',
    'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?x=1',
    'https://example.com#fragment', ' https://example.com', 'https://example.com/../']) {
    test(`parseConfiguredOrigin rejects ${String(value)}`, () => {
        assert.throws(() => parseConfiguredOrigin(value, 'APP_ORIGIN'));
    });
}

test('secure cookies default on for HTTPS and production', (t) => {
    environment(t, { APP_ORIGIN: 'https://mingai.fun' });
    assert.equal(shouldSecureAuthCookies(), true);

    environment(t, { APP_ORIGIN: 'http://example.com', NODE_ENV: 'production' });
    assert.equal(shouldSecureAuthCookies(), true);

    environment(t, { APP_ORIGIN: 'http://example.com', NODE_ENV: 'development' });
    assert.equal(shouldSecureAuthCookies(), false);
});

for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    test(`explicit local HTTP opt-in accepts ${origin}`, (t) => {
        environment(t, {
            APP_ORIGIN: origin,
            AUTH_ALLOW_INSECURE_LOCAL_HTTP: 'true',
            NODE_ENV: 'production',
        });
        assert.equal(shouldSecureAuthCookies(), false);
    });
}

for (const origin of ['https://localhost:3000', 'http://localhost.evil.test:3000',
    'http://example.com', 'http://0.0.0.0:3000', 'http://2130706433:3000']) {
    test(`insecure local opt-in rejects ${origin}`, (t) => {
        environment(t, {
            APP_ORIGIN: origin,
            AUTH_ALLOW_INSECURE_LOCAL_HTTP: 'true',
        });
        assert.throws(() => shouldSecureAuthCookies());
    });
}

test('missing APP_ORIGIN fails closed', (t) => {
    environment(t, { APP_ORIGIN: undefined });
    assert.throws(() => shouldSecureAuthCookies(), /APP_ORIGIN/u);
});
