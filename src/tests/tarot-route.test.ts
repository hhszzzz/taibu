import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { mockAIFeatureState, mockAIRateLimit, mockRouteUserContext, blockRouteNetwork } from './helpers/route-mock';
import { createMockAuthContext } from './helpers/auth-mock';
import { createMockScopedDb } from './helpers/db-mock';

// The CommonJS test loader keeps imported function lookups live; no cache eviction is needed.
beforeEach((t) => {
    assert.ok('mock' in t);
    blockRouteNetwork(t);
});

const apiUtilsModule = require('../lib/api-utils') as typeof import('../lib/api-utils');

function scopedTarot(options: {
    captureInsert?: (payload: Record<string, unknown>) => void;
    insertResult?: (payload: Record<string, unknown>) => Record<string, unknown>;
} = {}) {
    return createMockScopedDb({
        tx: async (work) => work({
            insertInto(table: string) {
                assert.equal(table, 'tarot_readings');
                return {
                    values(payload: Record<string, unknown>) {
                        options.captureInsert?.(payload);
                        return {
                            returning() {
                                return {
                                    async executeTakeFirst() {
                                        return options.insertResult?.(payload) ?? { id: 'reading-1' };
                                    },
                                };
                            },
                        };
                    },
                };
            },
        } as never),
    });
}

test('tarot route returns 400 for invalid timezone on GET daily requests', async () => {
    const { GET } = await import('../app/api/tarot/route');

    const request = new NextRequest('http://localhost/api/tarot?action=daily&timezone=Bad/Timezone');
    const response = await GET(request);
    const data = await response.json();

    assert.equal(response.status, 400);
    assert.equal(data.success, false);
    assert.equal(data.error, 'timezone 无效');
});

test('tarot route returns numerology on draw-only and persists birth metadata on save', async (t) => {

    const insertCalls: Record<string, unknown>[] = [];
    const scoped = scopedTarot({ captureInsert: (payload) => { insertCalls.push(payload); } });

    t.mock.method(apiUtilsModule, 'getAuthContext', async () =>
        createMockAuthContext(null));

    t.mock.method(apiUtilsModule, 'requireUserContext', async () =>
        createMockAuthContext('user-1', scoped));

    const { POST } = await import('../app/api/tarot/route');

    const drawOnlyResponse = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'draw-only',
            spreadId: 'single',
            birthDate: '1990-01-01',
        }),
    }));
    const drawOnlyPayload = await drawOnlyResponse.json();

    assert.equal(drawOnlyResponse.status, 200);
    assert.equal(drawOnlyPayload.success, true);
    assert.ok(drawOnlyPayload.data?.numerology);
    assert.equal(typeof drawOnlyPayload.data?.numerology?.personalityCard?.nameChinese, 'string');

    const saveResponse = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            spreadId: 'single',
            question: '今天如何',
            birthDate: '1990-01-01',
            numerology: drawOnlyPayload.data?.numerology,
            cards: drawOnlyPayload.data?.cards,
        }),
    }));
    const savePayload = await saveResponse.json();

    assert.equal(saveResponse.status, 200);
    assert.equal(savePayload.success, true);
    const inserted = insertCalls.at(-1);
    assert.ok(inserted);
    assert.deepEqual(inserted.metadata, {
        birthDate: '1990-01-01',
        numerology: drawOnlyPayload.data?.numerology,
    });
});

test('tarot route draws and titles the spreads newly exposed to the web layer', async (t) => {
    mockAIFeatureState(t);
    mockAIRateLimit(t);
    t.mock.method(apiUtilsModule, 'getAuthContext', async () => createMockAuthContext(null));
    mockRouteUserContext(t);

    const { POST } = await import('../app/api/tarot/route');
    const post = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
        const response = await POST(new NextRequest('http://localhost/api/tarot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
        }));
        return { status: response.status, payload: await response.json() };
    };

    const spreads = await post({ action: 'list-spreads' });
    assert.equal(spreads.status, 200);
    assert.ok(spreads.payload.data.spreads.some((spread: { id: string }) => spread.id === 'horseshoe'));

    const draw = await post({ action: 'draw-only', spreadId: 'horseshoe', seed: 'horseshoe-seed', allowReversed: false });
    assert.equal(draw.status, 200);
    assert.equal(draw.payload.data.spread.name, '马蹄牌阵');
    assert.equal(draw.payload.data.cards.length, 7);
    assert.ok(draw.payload.data.cards.every((card: { orientation: string }) => card.orientation === 'upright'));

    const unknown = await post({ action: 'draw-only', spreadId: 'not-a-spread' });
    assert.equal(unknown.status, 404);
});

test('tarot save should fail fast when metadata column is missing', async (t) => {

    const inserted: Record<string, unknown>[] = [];
    let insertAttempts = 0;
    const scoped = scopedTarot({
        captureInsert: (payload) => {
            insertAttempts += 1;
            inserted.push(payload);
        },
        insertResult: (payload) => {
            if ('metadata' in payload) {
                throw new Error('column \"metadata\" of relation \"tarot_readings\" does not exist');
            }
            return { id: 'reading-2' };
        },
    });

    t.mock.method(apiUtilsModule, 'requireUserContext', async () =>
        createMockAuthContext('user-1', scoped));

    const { POST } = await import('../app/api/tarot/route');

    const response = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({
            action: 'save',
            spreadId: 'single',
            question: '今天如何',
            birthDate: '1990-01-01',
            numerology: {
                personalityCard: { number: 1, name: 'The Magician', nameChinese: '魔术师' },
                soulCard: { number: 2, name: 'The High Priestess', nameChinese: '女祭司' },
                yearlyCard: { number: 19, name: 'The Sun', nameChinese: '太阳', year: 2026 },
            },
            cards: [
                {
                    card: { nameChinese: '测试牌', keywords: ['关键词'], uprightMeaning: '正位', reversedMeaning: '逆位' },
                    orientation: 'upright',
                },
            ],
        }),
    }));

    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.equal(payload.success, false);
    assert.equal(payload.error, '保存记录失败');
    assert.equal(insertAttempts, 1);
    assert.ok('metadata' in inserted[0]);
});

test('tarot spread persists reading for cookie-authenticated users without bearer header', async (t) => {

    const insertCalls: Record<string, unknown>[] = [];
    const scoped = scopedTarot({
        captureInsert: (payload) => { insertCalls.push(payload); },
        insertResult: () => ({ id: 'reading-cookie' }),
    });

    t.mock.method(apiUtilsModule, 'getAuthContext', async () =>
        createMockAuthContext('user-cookie', scoped));

    const { POST } = await import('../app/api/tarot/route');
    const response = await POST(new NextRequest('http://localhost/api/tarot', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'spread',
            spreadId: 'single',
            question: '今天如何',
        }),
    }));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data?.readingId, 'reading-cookie');
    const inserted = insertCalls.at(-1);
    assert.ok(inserted);
    assert.equal(inserted.user_id, 'user-cookie');
});
