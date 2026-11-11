import { test } from 'node:test';
import assert from 'node:assert/strict';

test('createSaveOnce joins an in-flight save and accepts a new one afterwards', async () => {
    const { createSaveOnce } = require('../lib/chat/result-handoff') as typeof import('../lib/chat/result-handoff');
    const saveOnce = createSaveOnce();
    let calls = 0;
    let release!: (id: string) => void;
    const task = () => {
        calls += 1;
        return new Promise<string>(resolve => { release = resolve; });
    };
    const first = saveOnce(task);
    const second = saveOnce(task);
    assert.equal(calls, 1);
    release('record-1');
    assert.equal(await first, 'record-1');
    assert.equal(await second, 'record-1');
    assert.equal(await saveOnce(async () => { calls += 1; return 'record-2'; }), 'record-2');
    assert.equal(calls, 2);
});

test('createSaveOnce lets a later save retry after a failure', async () => {
    const { createSaveOnce } = require('../lib/chat/result-handoff') as typeof import('../lib/chat/result-handoff');
    const saveOnce = createSaveOnce();
    await assert.rejects(saveOnce(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await saveOnce(async () => 'ok'), 'ok');
});

test('buildAskTaibuText keeps the question wording and asks first when there is none', () => {
    const { buildAskTaibuText } = require('../lib/chat/result-handoff') as typeof import('../lib/chat/result-handoff');

    assert.equal(
        buildAskTaibuText({
            question: '这次合作能否顺利？',
            prompt: '请结合这一卦的用神与动变，解读卦象与应期。',
            questionless: '我起卦时没填所问之事。',
            chartAttached: true,
        }),
        '我问的是「这次合作能否顺利？」。请结合这一卦的用神与动变，解读卦象与应期。',
    );

    const questionless = buildAskTaibuText({
        question: '  ',
        prompt: 'x',
        questionless: '我起卦时没填所问之事。请先看这一卦的卦象，再问我这次想问什么；等我回答后再取用神断卦。',
        chartAttached: true,
    });
    assert.match(questionless, /再问我这次想问什么/u);
    assert.equal(questionless.includes('卦象没能随消息带上'), false);

    const detached = buildAskTaibuText({
        question: null,
        prompt: 'x',
        questionless: '我起卦时没填所问之事。请先看这一卦的卦象。',
        chartAttached: false,
    });
    assert.match(detached, /卦象没能随消息带上/u);
    assert.equal(detached.includes('先看这一卦的卦象'), false);

    const detachedWithQuestion = buildAskTaibuText({
        question: '财运',
        prompt: 'x',
        questionless: 'y',
        chartAttached: false,
    });
    assert.equal(detachedWithQuestion, '我问的是「财运」。卦象没能随消息带上，请先保存成功后再带上卦象。');
});
