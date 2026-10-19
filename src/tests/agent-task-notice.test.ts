import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import {
    canEnableBrowserNotifications,
    collectTaskNoticeBaseline,
    getBrowserNotificationAvailability,
    getTaskNoticeToastType,
    shouldPopupTaskNotice,
} from '../lib/notification';
import { DEFAULT_CHAT_PREFERENCES } from '../lib/chat/preferences';
import { mutationEffects } from '../lib/query/invalidation';
import { registerBrowserQueryClient } from '../lib/query/client';
import { normalizeUserSettings, updateCurrentUserSettings } from '../lib/user/settings';

function setupBrowser(t: TestContext) {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            location: { origin: 'https://test.invalid' },
            dispatchEvent: () => true,
            localStorage: {
                get length() { return storage.size; },
                key: (index: number) => Array.from(storage.keys())[index] ?? null,
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
            },
        },
    });
    const client = new QueryClient();
    registerBrowserQueryClient(client);
    t.after(() => {
        client.clear();
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
    });
    return client;
}

test('only completed or failed tasks pop a toast; waiting for an answer stays in the chat', () => {
    assert.equal(getTaskNoticeToastType('completed'), 'success');
    assert.equal(getTaskNoticeToastType('failed'), 'error');
    assert.equal(getTaskNoticeToastType('awaiting_input'), null);
    assert.equal(getTaskNoticeToastType(undefined), null);
});

test('the first successful poll records history so a refresh never replays it', () => {
    const baseline = collectTaskNoticeBaseline([
        { id: 'n1', created_at: '2026-10-19T08:00:00.000Z' },
        { id: 'n2', created_at: '2026-10-19T09:00:00.000Z' },
    ]);
    assert.deepEqual([...baseline.ids], ['n1', 'n2']);
    assert.equal(baseline.newestCreatedAt, '2026-10-19T09:00:00.000Z');
    assert.equal(shouldPopupTaskNotice({ id: 'n1', is_read: false, popup_claimed_at: null, created_at: '2026-10-19T08:00:00.000Z' }, { baseline }), false);
    assert.equal(shouldPopupTaskNotice({ id: 'n3', is_read: false, popup_claimed_at: null, created_at: '2026-10-19T10:00:00.000Z' }, { baseline }), true, 'a notice that appeared after load still pops');
    assert.equal(shouldPopupTaskNotice({ id: 'old-paged-in', is_read: false, popup_claimed_at: null, created_at: '2026-10-19T07:00:00.000Z' }, { baseline }), false, 'older notices paged in later are still history');
});

test('the same task state pops at most once, even across tabs and re-renders', () => {
    const empty = collectTaskNoticeBaseline([]);
    assert.equal(shouldPopupTaskNotice({ id: 'n1', is_read: false, popup_claimed_at: null }, { baseline: empty, popped: new Set() }), true);
    assert.equal(shouldPopupTaskNotice({ id: 'n1', is_read: false, popup_claimed_at: null }, { baseline: empty, popped: new Set(['n1']) }), false, 'already popped in this tab');
    assert.equal(shouldPopupTaskNotice({ id: 'n1', is_read: false, popup_claimed_at: '2026-10-19T00:00:00.000Z' }, { baseline: empty }), false, 'claimed by another tab');
    assert.equal(shouldPopupTaskNotice({ id: 'n1', is_read: true, popup_claimed_at: null }, { baseline: empty }), false, 'read notices never pop');
});

test('the browser notification switch follows support and permission boundaries', () => {
    assert.equal(getBrowserNotificationAvailability({ supported: false, permission: 'granted' }), 'unsupported');
    assert.equal(getBrowserNotificationAvailability({ supported: true, permission: 'denied' }), 'denied');
    assert.equal(getBrowserNotificationAvailability({ supported: true, permission: 'default' }), 'prompt');
    assert.equal(getBrowserNotificationAvailability({ supported: true, permission: 'granted' }), 'granted');
    assert.equal(getBrowserNotificationAvailability({ supported: true, permission: undefined }), 'prompt');

    assert.equal(canEnableBrowserNotifications('unsupported'), false);
    assert.equal(canEnableBrowserNotifications('denied'), false);
    assert.equal(canEnableBrowserNotifications('prompt'), true);
    assert.equal(canEnableBrowserNotifications('granted'), true);
});

test('the browser notification preference persists through existing chat preferences', async (t) => {
    setupBrowser(t);
    const requests: Array<{ method: string; url: string; body: string | null }> = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ method: init?.method ?? 'GET', url: String(input), body: typeof init?.body === 'string' ? init.body : null });
        return Response.json({
            data: { settings: normalizeUserSettings({ chat_preferences: { desktopNotifications: true } }) },
            error: null,
        });
    });

    const saved = await updateCurrentUserSettings(
        { chatPreferences: { ...DEFAULT_CHAT_PREFERENCES, desktopNotifications: true } },
        mutationEffects.userSettings('alice'),
        { expectedUserId: 'alice' },
    );

    assert.equal(saved?.chatPreferences.desktopNotifications, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[0].url, '/api/user/settings');
    assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), {
        chatPreferences: { width: 768, fontScale: 100, desktopNotifications: true },
    });
});
