import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDailyChatContext, requestDailyChat } from '../lib/chat/daily-chat';
import { CUSTOM_PROVIDER_STORAGE_KEY } from '../lib/chat/custom-provider';
import { calculateBaziChartBundle } from '../lib/divination/bazi';
import { getCalendarAlmanac } from '../lib/divination/calendar';
import { calculateDailyFortune } from '../lib/divination/fortune';

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

test('daily context without a chart is grounded on the almanac only', () => {
    const date = new Date(2026, 9, 10);
    const context = buildDailyChatContext({ date, almanac: getCalendarAlmanac(date), question: '  这一天适合签约吗？' });
    assert.match(context, /^用户正在查询 2026年10月10日 的黄历信息和运势。/u);
    assert.match(context, /- 干支：丙午年 戊戌月 丁巳日\n/u);
    assert.match(context, /- 宜：嫁娶、求嗣、纳采、进人口、纳财、结网、纳畜、牧养、会亲友\n/u);
    assert.match(context, /- 值神：明堂\n\n用户问题：  这一天适合签约吗？\n/u);
    assert.match(context, /请基于以上黄历信息，用专业但易懂的方式回答用户的问题。$/u);
    assert.doesNotMatch(context, /命盘/u);
});

test('daily context with a chart adds only the ten god and fortune levels', () => {
    const date = new Date(2026, 9, 10);
    const { output } = calculateBaziChartBundle({
        name: '林知夏',
        gender: 'female',
        birthYear: 1984,
        birthMonth: 9,
        birthDay: 27,
        birthHour: 4,
        birthMinute: 20,
        calendarType: 'solar',
    });
    const fortune = calculateDailyFortune(output, date);
    const context = buildDailyChatContext({ date, almanac: getCalendarAlmanac(date), question: '财运如何？', personalFortune: fortune });
    const levels = `综合 ${fortune.overall}，事业运 ${fortune.career}，财运 ${fortune.wealth}，感情运 ${fortune.love}，健康运 ${fortune.health}，人际运 ${fortune.social}`;
    assert.ok(context.includes(`- 值神：明堂\n\n用户当前八字命盘在该日的运势：\n- 流日十神：${fortune.tenGod}\n- 运势等级：${levels}\n\n用户问题：财运如何？`));
    assert.match(context, /请基于以上黄历信息与命盘当日运势，用专业但易懂的方式回答用户的问题。$/u);
    // 不外传姓名与出生信息
    for (const secret of ['林知夏', '1984', '04:20']) {
        assert.equal(context.includes(secret), false, secret);
    }
});
