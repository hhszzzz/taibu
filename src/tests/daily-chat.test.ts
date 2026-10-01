import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestDailyChat } from '../lib/chat/daily-chat';
import { CUSTOM_PROVIDER_STORAGE_KEY } from '../lib/chat/custom-provider';

function setup(t: TestContext, provider?: object) {
    const storage = new Map<string, string>();
    if (provider) storage.set(CUSTOM_PROVIDER_STORAGE_KEY, JSON.stringify(provider));
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
    } });
    t.after(() => {
        globalThis.fetch = originalFetch;
        for (const [key, descriptor] of [['window', originalWindow], ['sessionStorage', originalStorage]] as const) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    });
}

for (const modelId of ['deepseek-chat', 'my-custom-model']) {
    test(`daily BYOK uses ${modelId} and keeps credentials in the browser`, async (t) => {
        setup(t, { apiUrl: 'https://api.deepseek.com/chat/completions', apiKey: 'fixture-only', modelId });
        const calls: string[] = [];
        globalThis.fetch = async (url, init) => {
            calls.push(String(url));
            const body = JSON.parse(String(init?.body));
            if (calls.length === 1) {
                assert.equal(url, '/api/chat/direct/prepare');
                assert.deepEqual(body.messages, [{ role: 'user', content: '选中日期的黄历' }]);
                assert.equal(body.model, undefined);
                assert.equal(body.apiKey, undefined);
                assert.equal(String(init?.body).includes('fixture-only'), false);
                return Response.json({ systemPrompt: 'prepared system', sanitizedMessages: body.messages });
            }
            assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
            assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fixture-only');
            assert.equal(body.model, modelId);
            assert.deepEqual(body.messages, [
                { role: 'system', content: 'prepared system' },
                { role: 'user', content: '选中日期的黄历' },
            ]);
            return Response.json({ choices: [{ message: { content: '日运解答' } }] });
        };
        assert.deepEqual(await (await requestDailyChat('选中日期的黄历')).json(), { content: '日运解答' });
        assert.equal(calls.length, 2);
    });
}

test('daily without BYOK leaves model resolution to the server default', async (t) => {
    setup(t);
    globalThis.fetch = async (url, init) => {
        assert.equal(url, '/api/chat');
        assert.deepEqual(JSON.parse(String(init?.body)), {
            messages: [{ role: 'user', content: 'question' }], stream: false,
        });
        return Response.json({ content: 'default model answer' });
    };
    assert.equal((await (await requestDailyChat('question')).json()).content, 'default model answer');
});

for (const status of [401, 429]) {
    test(`daily stops before provider call when prepare returns ${status}`, async (t) => {
        setup(t, { apiUrl: 'https://api.deepseek.com', apiKey: 'fixture-only', modelId: 'custom' });
        let count = 0;
        globalThis.fetch = async () => {
            count++;
            return Response.json({ error: 'prepare rejected' }, { status });
        };
        const response = await requestDailyChat('question');
        assert.equal(response.status, status);
        assert.equal(count, 1);
    });
}

test('daily component uses the shared daily transport', () => {
    const source = readFileSync('src/components/daily/DailyAIChat.tsx', 'utf8');
    assert.match(source, /await requestDailyChat\(contextMessage\)/u);
    assert.doesNotMatch(source, /model:\s*'deepseek'/u);
});
