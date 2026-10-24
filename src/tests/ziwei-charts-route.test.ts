import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';


test('ziwei chart create rejects missing birth_time', async (t) => {
    const apiUtils = require('../lib/api-utils') as {
        requireUserContext: typeof import('../lib/api-utils').requireUserContext;
    };
    const originalRequireUserContext = apiUtils.requireUserContext;
    let insertCalled = false;

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: { tx() { insertCalled = true; throw new Error('invalid input reached the database'); } },
    })) as unknown as typeof apiUtils.requireUserContext;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
    });

    const { POST } = await import('../app/api/ziwei/charts/route');
    const request = new NextRequest('http://localhost/api/ziwei/charts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            payload: {
                name: '紫微一号',
                gender: 'female',
                birth_date: '1992-02-02',
                birth_time: null,
            },
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '紫微命盘必须提供有效的出生时辰');
    assert.equal(insertCalled, false);
});

test('ziwei chart update rejects invalid birth_time', async (t) => {
    const apiUtils = require('../lib/api-utils') as {
        requireUserContext: typeof import('../lib/api-utils').requireUserContext;
    };
    const originalRequireUserContext = apiUtils.requireUserContext;
    let updateCalled = false;

    apiUtils.requireUserContext = (async () => ({
        user: { id: 'user-1' },
        db: { tx() { updateCalled = true; throw new Error('invalid input reached the database'); } },
    })) as unknown as typeof apiUtils.requireUserContext;

    t.after(() => {
        apiUtils.requireUserContext = originalRequireUserContext;
    });

    const { POST } = await import('../app/api/ziwei/charts/update/route');
    const request = new NextRequest('http://localhost/api/ziwei/charts/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chartId: '550e8400-e29b-41d4-a716-446655440000',
            payload: {
                birth_time: '  ',
            },
        }),
    });

    const response = await POST(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, '紫微命盘必须提供有效的出生时辰');
    assert.equal(updateCalled, false);
});
