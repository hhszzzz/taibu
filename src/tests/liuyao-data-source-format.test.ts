import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liuyaoProvider } from '../lib/data-sources/liuyao';

const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'rec-1',
    user_id: 'user-1',
    question: '',
    hexagram_code: '101111',
    changed_hexagram_code: '101110',
    changed_lines: [2],
    yongshen_targets: null,
    created_at: '2026-02-10T00:00:00.000Z',
    conversation_id: null,
    ...overrides,
} as Parameters<typeof liuyaoProvider.formatForAI>[0]);

test('liuyao provider renders the full chart and asks for a missing question', async () => {
    const content = await liuyaoProvider.formatForAI(row());

    for (const label of [
        '## 占问说明',
        '未填写所问之事',
        '所问未明时先问清',
        '起卦时间',
        '# 六爻盘面',
        '## 六爻排盘',
        '旺衰',
        '动静',
        '空亡',
        '变出',
        '化变',
        '世应',
    ]) {
        assert.equal(content.includes(label), true, label);
    }
    assert.equal(content.includes('不应正式断卦'), false);
});

test('liuyao provider asks for yongshen when a question has no targets', async () => {
    const content = await liuyaoProvider.formatForAI(row({ question: '本月事业运势如何？' }));

    assert.match(content, /没有记录用神目标/u);
    assert.match(content, /自行取用神/u);
    assert.equal(content.includes('未填写所问之事'), false);
    assert.equal(content.includes('不应正式断卦'), false);
});

test('liuyao provider keeps user-selected yongshen targets when the question is missing', async () => {
    const content = await liuyaoProvider.formatForAI(row({ yongshen_targets: ['官鬼'] }));

    assert.match(content, /已记录的用神目标：官鬼/u);
    assert.match(content, /未填写所问之事/u);
    assert.match(content, /## 用神分析/u);
});

test('liuyao provider keeps an incomplete record readable without refusing to interpret', async () => {
    const content = await liuyaoProvider.formatForAI(row({ hexagram_code: 'bad' }));

    assert.match(content, /卦码或起卦时间不完整/u);
    assert.equal(content.includes('不应正式断卦'), false);
});
