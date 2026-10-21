import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

test('pruneExpiredNotifications should delete in a single query and return deleted row count', async (t) => {
    const contextModule = require('../lib/db/context.server') as any;
    const originalSystemDb = contextModule.systemDb;

    const whereColumns: string[] = [];

    contextModule.systemDb = () => createMockScopedDb({
        tx: async (work) => work({
            deleteFrom: () => ({
                where: (column: string) => {
                    whereColumns.push(column);
                    const query = {
                        where: (next: string) => {
                            whereColumns.push(next);
                            return query;
                        },
                        returning: () => ({
                            execute: async () => [{ id: 'n1' }, { id: 'n2' }],
                        }),
                    };
                    return query;
                },
            }),
        } as never),
    });

    t.after(() => {
        contextModule.systemDb = originalSystemDb;
    });

    const notificationModule = await import('../lib/notification-server');
    const deleted = await notificationModule.pruneExpiredNotifications({ userId: 'user-1' });

    assert.deepEqual(whereColumns, ['created_at', 'user_id']);
    assert.equal(deleted, 2);
});

function replaceSystemDb(t: import('node:test').TestContext, scoped: import('../lib/db/context.server').ScopedDb) {
    const contextModule = require('../lib/db/context.server') as typeof import('../lib/db/context.server');
    const original = contextModule.systemDb;
    contextModule.systemDb = (() => scoped) as typeof contextModule.systemDb;
    t.after(() => { contextModule.systemDb = original; });
}

test('getReminderSubscriptions should throw instead of masquerading as an empty list on read failure', async (t) => {
    replaceSystemDb(t, createMockScopedDb({ tx: async () => { throw new Error('db timeout'); } }));
    const { ReminderReadError, getReminderSubscriptions } = require('../lib/reminders') as typeof import('../lib/reminders');

    await assert.rejects(
        () => getReminderSubscriptions('user-1'),
        (error: unknown) => error instanceof ReminderReadError && error.message === '获取提醒订阅失败',
    );
});

test('isSubscribed should throw instead of returning false when user-settings reads fail', async (t) => {
    replaceSystemDb(t, createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                const query = {
                    select() { return query; },
                    where() { return query; },
                    async executeTakeFirst() {
                        if (table === 'reminder_subscriptions') return { enabled: true, notify_site: true };
                        if (table === 'user_settings') throw new Error('settings read failed');
                        throw new Error(`unexpected table: ${table}`);
                    },
                };
                return query;
            },
        } as never),
    }));
    const { ReminderReadError, isSubscribed } = require('../lib/reminders') as typeof import('../lib/reminders');

    await assert.rejects(
        () => isSubscribed('user-1', 'fortune'),
        (error: unknown) => error instanceof ReminderReadError && error.message === '获取通知偏好失败',
    );
});

function createReminderServiceMock(t: import('node:test').TestContext, options: {
    reminder: Record<string, unknown>;
    statuses: Array<'sent' | 'skipped' | 'not_claimed'>;
}) {
    const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    let statusIndex = 0;
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                assert.equal(table, 'scheduled_reminders');
                const query = {
                    selectAll() { return query; },
                    where() { return query; },
                    limit() { return query; },
                    async execute() { return [{ ...options.reminder }]; },
                };
                return query;
            },
        } as never),
        rpc: async (fn: string, args: Record<string, unknown>) => {
            rpcCalls.push({ fn, args });
            const status = options.statuses[statusIndex] ?? 'not_claimed';
            statusIndex += 1;
            return status === undefined ? null : { status };
        },
    });
    replaceSystemDb(t, scoped);
    return { rpcCalls, scoped };
}

test('processScheduledReminders marks skipped reminder as sent only after successful claim', async (t) => {
    const reminder = {
        id: 'rem-1',
        user_id: 'user-1',
        reminder_type: 'solar_term',
        content: { term_name: 'Term', meaning: 'Meaning', tips: 'Tips' },
    };
    const reminderMock = createReminderServiceMock(t, { reminder, statuses: ['skipped'] });

    const { processScheduledReminders } = await import('../lib/reminders');
    const processed = await processScheduledReminders();

    assert.equal(processed, 0);
    assert.equal(reminderMock.rpcCalls.length, 1);
    assert.equal(reminderMock.rpcCalls[0].fn, 'process_scheduled_reminder_delivery_as_service');
    assert.equal(reminderMock.rpcCalls[0].args.p_reminder_id, 'rem-1');
    assert.equal(reminderMock.rpcCalls[0].args.p_notification_title, '🌿 今日节气：Term');
});

test('processScheduledReminders counts sent reminder deliveries', async (t) => {
    const reminder = {
        id: 'rem-2',
        user_id: 'user-1',
        reminder_type: 'fortune',
        content: { summary: 'Summary' },
    };
    const reminderMock = createReminderServiceMock(t, { reminder, statuses: ['sent'] });

    const { processScheduledReminders } = await import('../lib/reminders');
    const processed = await processScheduledReminders();

    assert.equal(processed, 1);
    assert.equal(reminderMock.rpcCalls.length, 1);
    assert.equal(reminderMock.rpcCalls[0].args.p_notification_title, '📅 今日运势提醒');
});

test('processScheduledReminders skips sending when reminder claim was already taken', async (t) => {
    const reminder = {
        id: 'rem-3',
        user_id: 'user-1',
        reminder_type: 'fortune',
        content: { summary: 'Summary' },
    };
    const reminderMock = createReminderServiceMock(t, { reminder, statuses: ['not_claimed'] });

    const { processScheduledReminders } = await import('../lib/reminders');
    const processed = await processScheduledReminders();

    assert.equal(processed, 0);
    assert.equal(reminderMock.rpcCalls.length, 1);
    assert.equal(reminderMock.rpcCalls[0].args.p_reminder_id, 'rem-3');
});

test('processScheduledReminders sends key date reminders through transactional delivery rpc', async (t) => {
    const reminder = {
        id: 'rem-4',
        user_id: 'user-1',
        reminder_type: 'key_date',
        content: { description: '今天有重要事项' },
    };
    const reminderMock = createReminderServiceMock(t, { reminder, statuses: ['sent'] });

    const { processScheduledReminders } = await import('../lib/reminders');
    const processed = await processScheduledReminders();

    assert.equal(processed, 1);
    assert.equal(reminderMock.rpcCalls.length, 1);
    assert.equal(reminderMock.rpcCalls[0].args.p_notification_title, '🔔 重要日期提醒');
    assert.equal(reminderMock.rpcCalls[0].args.p_notification_content, '今天有重要事项');
});

test('scheduleSolarTermReminder should create reminders through transactional rpc', async (t) => {
    const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };
    replaceSystemDb(t, createMockScopedDb({
        rpc: async (fn: string, args: Record<string, unknown>) => {
            capture.rpcCall = { fn, args };
            return true;
        },
    }));

    const { scheduleSolarTermReminder } = await import('../lib/reminders');
    const ok = await scheduleSolarTermReminder('user-1', '2026-04-20', '谷雨');

    assert.equal(ok, true);
    assert.equal(capture.rpcCall?.fn, 'schedule_reminder_if_absent_as_service');
    assert.deepEqual(capture.rpcCall?.args, {
        p_user_id: 'user-1',
        p_reminder_type: 'solar_term',
        p_scheduled_for: '2026-04-20T08:00:00+08:00',
        p_content: {
            term_name: '谷雨',
            meaning: '雨生百谷，播种时节',
            tips: '祛湿健脾，适度运动',
        },
    });
});

test('scheduleFortuneReminder should create reminders through transactional rpc', async (t) => {
    const capture: { rpcCall: { fn: string; args: Record<string, unknown> } | null } = { rpcCall: null };
    replaceSystemDb(t, createMockScopedDb({
        rpc: async (fn: string, args: Record<string, unknown>) => {
            capture.rpcCall = { fn, args };
            return true;
        },
    }));

    const { scheduleFortuneReminder } = await import('../lib/reminders');
    const ok = await scheduleFortuneReminder('user-1', '2026-04-21', { summary: '好运' });

    assert.equal(ok, true);
    assert.equal(capture.rpcCall?.fn, 'schedule_reminder_if_absent_as_service');
    assert.deepEqual(capture.rpcCall?.args, {
        p_user_id: 'user-1',
        p_reminder_type: 'fortune',
        p_scheduled_for: '2026-04-21T07:00:00+08:00',
        p_content: {
            summary: '好运',
        },
    });
});
