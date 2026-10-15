import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon';

test('calculateResult chooses dominant dimensions from answers', () => {
    const mbti = require('../lib/divination/mbti') as any;

    const questions = [
        { question: 'Q1', choice_a: { value: 'E', text: 'A' }, choice_b: { value: 'I', text: 'B' } },
        { question: 'Q2', choice_a: { value: 'S', text: 'A' }, choice_b: { value: 'N', text: 'B' } },
        { question: 'Q3', choice_a: { value: 'T', text: 'A' }, choice_b: { value: 'F', text: 'B' } },
        { question: 'Q4', choice_a: { value: 'J', text: 'A' }, choice_b: { value: 'P', text: 'B' } },
    ];

    const answers = [
        { questionIndex: 0, likertValue: 1 },
        { questionIndex: 1, likertValue: 1 },
        { questionIndex: 2, likertValue: 1 },
        { questionIndex: 3, likertValue: 1 },
    ];

    const result = mbti.calculateResult(questions, answers);

    assert.equal(result.type, 'ESTJ');
    assert.equal(result.percentages.EI.E, 100);
    assert.equal(result.percentages.SN.S, 100);
    assert.equal(result.percentages.TF.T, 100);
    assert.equal(result.percentages.JP.J, 100);
});

test('buildViewResult returns defaults for valid type', () => {
    const mbti = require('../lib/divination/mbti') as any;

    assert.equal(typeof mbti.buildViewResult, 'function');

    const result = mbti.buildViewResult('INTJ');
    assert.equal(result?.type, 'INTJ');
    assert.equal(result?.percentages?.EI?.E, 50);
    assert.equal(result?.percentages?.EI?.I, 50);
});

test('buildViewResult rejects invalid type', () => {
    const mbti = require('../lib/divination/mbti') as any;

    assert.equal(mbti.buildViewResult('NOPE'), null);
});

type MBTIModule = typeof import('../lib/divination/mbti');

test('getMBTIPageState slices pages of three and clamps out-of-range pages', () => {
    const { getMBTIPageState } = require('../lib/divination/mbti') as MBTIModule;
    const none = new Set<number>();

    assert.deepEqual(getMBTIPageState(0, 7, none), { start: 0, end: 3, totalPages: 3, isLastPage: false, firstUnanswered: 0 });
    // 最后一页不足三题
    assert.deepEqual(getMBTIPageState(2, 7, none), { start: 6, end: 7, totalPages: 3, isLastPage: true, firstUnanswered: 6 });
    // 页码越界夹到有效范围
    assert.equal(getMBTIPageState(9, 7, none).start, 6);
    assert.equal(getMBTIPageState(-1, 7, none).start, 0);
    assert.equal(getMBTIPageState(Number.NaN, 7, none).start, 0);
    // 非法每页题数退化为每页一题
    assert.equal(getMBTIPageState(0, 7, none, 0).totalPages, 7);
});

test('getMBTIPageState treats an empty bank as one empty last page', () => {
    const { getMBTIPageState } = require('../lib/divination/mbti') as MBTIModule;

    assert.deepEqual(getMBTIPageState(3, 0, new Set()), { start: 0, end: 0, totalPages: 1, isLastPage: true, firstUnanswered: null });
});

test('getMBTIPageState points at the first unanswered question of the page only', () => {
    const { getMBTIPageState } = require('../lib/divination/mbti') as MBTIModule;

    // 其他页未答不影响本页
    assert.equal(getMBTIPageState(1, 9, new Set([3, 5])).firstUnanswered, 4);
    assert.equal(getMBTIPageState(1, 9, new Set([3, 4, 5])).firstUnanswered, null);
});

test('toggleMBTIAnswer adds, replaces and clears answers without mutating input', () => {
    const { toggleMBTIAnswer } = require('../lib/divination/mbti') as MBTIModule;
    const initial = Object.freeze([{ questionIndex: 0, likertValue: 2 as const }]);

    const added = toggleMBTIAnswer(initial, 1, 6);
    assert.deepEqual(added, [{ questionIndex: 0, likertValue: 2 }, { questionIndex: 1, likertValue: 6 }]);

    const replaced = toggleMBTIAnswer(added, 0, 4);
    assert.deepEqual(replaced, [{ questionIndex: 0, likertValue: 4 }, { questionIndex: 1, likertValue: 6 }]);

    // 再次点选同一档位即取消作答
    assert.deepEqual(toggleMBTIAnswer(replaced, 1, 6), [{ questionIndex: 0, likertValue: 4 }]);
    assert.deepEqual(initial, [{ questionIndex: 0, likertValue: 2 }]);
});
