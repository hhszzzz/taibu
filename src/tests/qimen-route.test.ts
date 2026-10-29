import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { blockRouteNetwork } from './helpers/route-mock';
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';

// The CommonJS test loader keeps imported function lookups live; no cache eviction is needed.
beforeEach((t) => {
    assert.ok('mock' in t);
    blockRouteNetwork(t);
});


test('qimen save persists base inputs instead of chart_data', async (t) => {
    const insertCalls: Record<string, unknown>[] = [];
    const scoped = createMockScopedDb({
        tx: async (work) => work({
            insertInto(table: string) {
                assert.equal(table, 'qimen_charts');
                return {
                    values(payload: Record<string, unknown>) {
                        insertCalls.push(payload);
                        return {
                            returning() {
                                return {
                                    async executeTakeFirst() { return { id: 'chart-1' }; },
                                };
                            },
                        };
                    },
                };
            },
        } as never),
    });

    const apiUtils = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(apiUtils, 'requireUserContext', async () => createMockAuthContext('user-1', scoped));

    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            question: '测试问题',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            timezone: 'Asia/Shanghai',
            panType: 'zhuan',
            juMethod: 'chaibu',
            zhiFuJiGong: 'jiLiuYi',
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.chartId, 'chart-1');
    const insertedRecord = insertCalls.at(-1);
    assert.ok(insertedRecord);
    assert.equal(insertedRecord.question, '测试问题');
    assert.equal(insertedRecord.year, 2025);
    assert.equal(insertedRecord.month, 1);
    assert.equal(insertedRecord.day, 15);
    assert.equal(insertedRecord.hour, 10);
    assert.equal(insertedRecord.minute, 30);
    assert.equal(insertedRecord.timezone, 'Asia/Shanghai');
    assert.equal(insertedRecord.pan_type, 'zhuan');
    assert.equal(insertedRecord.ju_method, 'chaibu');
    assert.equal(insertedRecord.zhi_fu_ji_gong, 'ji_liuyi');
    assert.equal(typeof insertedRecord.chart_time, 'string');
    assert.ok(!('chart_data' in insertedRecord));
});

test('qimen route rejects unsupported juMethod before auth', async () => {
    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'calculate',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            juMethod: 'zhirun',
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '定局法无效');
});

test('qimen route rejects unsupported zhiFuJiGong before auth', async () => {
    const { POST } = await import('../app/api/qimen/route');
    const request = new NextRequest('http://localhost/api/qimen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'calculate',
            year: 2025,
            month: 1,
            day: 15,
            hour: 10,
            minute: 30,
            zhiFuJiGong: 'invalid-value',
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '中五寄宫配置无效');
});
