import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createMockScopedDb } from './helpers/db-mock';


const CHART_ID = '550e8400-e29b-41d4-a716-446655440000';

type CrudState = {
    existing: Record<string, unknown> | null;
    writes: Record<string, unknown>[];
    filters: Array<[string, unknown]>;
};

function createChartCrudScope(state: CrudState) {
    return createMockScopedDb({
        tx: async (work) => work({
            selectFrom() {
                const query = {
                    select(fields: string | readonly string[]) {
                        const columns = Array.isArray(fields) ? fields : String(fields).split(',').map((field) => field.trim());
                        if (columns.join(',').includes('timezone')) assert.ok(columns.includes('timezone'));
                        if (columns.join(',').includes('disambiguation')) assert.ok(columns.includes('disambiguation'));
                        return query;
                    },
                    where(field: string, _operator: string, value: unknown) {
                        state.filters.push([field, value]);
                        return query;
                    },
                    async executeTakeFirst() { return state.existing ?? undefined; },
                    async execute() { return []; },
                };
                return query;
            },
            insertInto() {
                const query = {
                    values(payload: Record<string, unknown>) {
                        state.writes.push(payload);
                        return query;
                    },
                    returning() { return query; },
                    async executeTakeFirst() { return { id: CHART_ID }; },
                    async execute() { return []; },
                };
                return query;
            },
            updateTable() {
                const query = {
                    set(payload: Record<string, unknown>) {
                        state.writes.push(payload);
                        return query;
                    },
                    where(field: string, _operator: string, value: unknown) {
                        state.filters.push([field, value]);
                        return query;
                    },
                    returning() { return query; },
                    async executeTakeFirst() { return state.existing ? { id: CHART_ID } : undefined; },
                    async execute() { return []; },
                };
                return query;
            },
        } as never),
    });
}

function mockChartCrudUser(t: import('node:test').TestContext, scoped: unknown) {
    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    const original = apiUtils.requireUserContext;
    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: scoped,
        accessToken: null,
    })) as unknown as typeof apiUtils.requireUserContext;
    t.after(() => { apiUtils.requireUserContext = original; });
}

test('chart CRUD retains time rules, rejects invalid calculations, and keeps owner boundaries', async (t) => {
    const base = {
        id: CHART_ID, user_id: 'user-1', name: 'DST', gender: 'male',
        birth_date: '2024-03-10', birth_time: '02:30', calendar_type: 'solar',
        longitude: -74, timezone: 'America/New_York', disambiguation: 'later',
    };
    const state: CrudState = { existing: base, writes: [], filters: [] };
    mockChartCrudUser(t, createChartCrudScope(state));

    const handlers = [
        { type: 'bazi', create: (await import('../app/api/bazi/charts/route')).POST, update: (await import('../app/api/bazi/charts/update/route')).POST },
        { type: 'ziwei', create: (await import('../app/api/ziwei/charts/route')).POST, update: (await import('../app/api/ziwei/charts/update/route')).POST },
    ];
    for (const { type, create, update } of handlers) {
        const request = (body: unknown, expectedUserId = 'user-1') => new NextRequest(`http://localhost/api/${type}/charts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Expected-User-Id': expectedUserId }, body: JSON.stringify(body) });
        state.existing = base;
        state.writes.length = 0;
        assert.equal((await create(request({ payload: { ...base, user_id: 'attacker' } }))).status, 201);
        assert.equal(state.writes[0].timezone, 'America/New_York');
        assert.equal(state.writes[0].disambiguation, 'later');
        assert.equal(state.writes[0].user_id, 'user-1');
        if (type === 'bazi') assert.equal(typeof state.writes[0].day_master, 'string');

        for (const patch of [{ timezone: 'invalid/timezone' }, { disambiguation: 'invalid' }, { disambiguation: 'reject' }, { birth_date: '2024-02-30' }]) {
            state.writes.length = 0;
            assert.equal((await create(request({ payload: { ...base, ...patch } }))).status, 400);
            assert.equal((await update(request({ chartId: CHART_ID, payload: patch }))).status, 400);
            assert.equal(state.writes.length, 0);
        }
        state.writes.length = 0;
        assert.equal((await update(request({ chartId: CHART_ID, payload: { timezone: 'UTC' } }))).status, 200);
        assert.equal(state.writes[0].timezone, 'UTC');
        assert.equal(state.writes[0].disambiguation, 'later');
        state.writes.length = 0;
        assert.equal((await update(request({ chartId: CHART_ID, payload: { disambiguation: 'earlier' } }))).status, 200);
        assert.equal(state.writes[0].timezone, 'America/New_York');
        assert.equal(state.writes[0].disambiguation, 'earlier');
        state.writes.length = 0;
        assert.equal((await update(request({ chartId: CHART_ID, payload: { name: 'renamed', user_id: 'attacker' } }))).status, 200);
        assert.deepEqual(state.writes[0], { name: 'renamed' });
        assert.ok(state.filters.some(([field, value]) => field === 'user_id' && value === 'user-1'));

        state.writes.length = 0;
        assert.equal((await update(request({ chartId: CHART_ID, payload: { timezone: 'UTC' } }, 'other-user'))).status, 409);
        assert.equal((await create(request({ payload: base }, 'other-user'))).status, 409);
        assert.equal(state.writes.length, 0);
        state.existing = null;
        assert.equal((await update(request({ chartId: CHART_ID, payload: { timezone: 'UTC' } }))).status, 404);
        assert.equal(state.writes.length, 0);
        assert.equal((await create(request(null))).status, 400);
        assert.equal((await update(request(null))).status, 400);
    }
});

test('bazi chart create rejects missing birth_time', async (t) => {
    const state: CrudState = { existing: null, writes: [], filters: [] };
    mockChartCrudUser(t, createChartCrudScope(state));

    const { POST } = await import('../app/api/bazi/charts/route');
    const request = new NextRequest('http://localhost/api/bazi/charts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            payload: {
                name: '八字一号',
                gender: 'male',
                birth_date: '1990-01-01',
                birth_time: null,
            },
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '八字命盘必须提供有效的出生时辰');
    assert.equal(state.writes.length, 0);
});

test('bazi chart update recomputes derived fields from merged existing chart data', async (t) => {
    const state: CrudState = {
        existing: {
            id: CHART_ID,
            user_id: 'user-1',
            gender: 'male',
            birth_date: '1990-01-01',
            birth_time: '08:00',
            birth_place: '北京',
            longitude: null,
            calendar_type: 'solar',
            is_leap_month: false,
        },
        writes: [],
        filters: [],
    };
    mockChartCrudUser(t, createChartCrudScope(state));

    const { POST } = await import('../app/api/bazi/charts/update/route');
    const request = new NextRequest('http://localhost/api/bazi/charts/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartId: CHART_ID, payload: { birth_time: '09:30' } }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    const [updatedRecord] = state.writes;
    assert.ok(updatedRecord);
    assert.equal(updatedRecord.birth_time, '09:30');
    assert.equal(typeof updatedRecord.day_master, 'string');
    assert.equal(typeof updatedRecord.day_branch, 'string');
});

test('bazi chart update rejects merged records without valid birth_time', async (t) => {
    const state: CrudState = {
        existing: {
            id: CHART_ID,
            user_id: 'user-1',
            gender: 'male',
            birth_date: '1990-01-01',
            birth_time: null,
            birth_place: '北京',
            longitude: null,
            calendar_type: 'solar',
            is_leap_month: false,
        },
        writes: [],
        filters: [],
    };
    mockChartCrudUser(t, createChartCrudScope(state));

    const { POST } = await import('../app/api/bazi/charts/update/route');
    const request = new NextRequest('http://localhost/api/bazi/charts/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chartId: CHART_ID, payload: { name: '更新名称' } }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '八字命盘必须提供有效的出生时辰');
    assert.equal(state.writes.length, 0);
});
