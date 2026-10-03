import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionContext, useSessionSafe, type SessionState } from '../lib/hooks/session-context';
import { createMockAuthContext } from './helpers/supabase-mock';

function SessionProbe() {
    const state = useSessionSafe();
    return createElement('output', {
        'data-user': state.user?.id ?? 'visitor',
        'data-session-user': state.session?.user.id ?? 'visitor',
        'data-loading': String(state.loading),
    });
}

test('session hook keeps the non-blocking anonymous fallback without a provider', () => {
    const html = renderToStaticMarkup(createElement(SessionProbe));
    assert.match(html, /data-user="visitor"/u);
    assert.match(html, /data-session-user="visitor"/u);
    assert.match(html, /data-loading="false"/u);
});

test('session hook preserves a pending provider snapshot instead of using its fallback', () => {
    const state: SessionState = { session: null, user: null, loading: true };
    const html = renderToStaticMarkup(createElement(SessionContext.Provider, {
        value: state,
    }, createElement(SessionProbe)));
    assert.match(html, /data-user="visitor"/u);
    assert.match(html, /data-loading="true"/u);
});

test('session hook returns the supplied user and session without creating another store', () => {
    const { user } = createMockAuthContext({}, 'user-context');
    const state: SessionState = {
        user,
        loading: false,
        session: {
            user,
            access_token: 'test-access-token',
            refresh_token: 'test-refresh-token',
            expires_in: 3600,
            token_type: 'bearer',
        },
    };
    const observed: SessionState[] = [];
    function SnapshotProbe() {
        observed.push(useSessionSafe());
        return createElement(SessionProbe);
    }
    const html = renderToStaticMarkup(createElement(SessionContext.Provider, {
        value: state,
    }, createElement(SnapshotProbe)));
    assert.equal(observed[0], state);
    assert.match(html, /data-user="user-context"/u);
    assert.match(html, /data-session-user="user-context"/u);
    assert.match(html, /data-loading="false"/u);
});

test('ClientProviders retains the existing hook export as the same context consumer', () => {
    const providers = require('../components/providers/ClientProviders') as typeof import('../components/providers/ClientProviders');
    assert.equal(providers.useSessionSafe, useSessionSafe);
});
