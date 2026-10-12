import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentQuestion } from '../lib/agent/questions';
import { createQuestionDraftStore, describeQuestionAnswer, getDraftAnswers, parseQuestionDraft, questionDraftKey } from '../lib/agent/question-drafts';

function storageFixture() {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
        values,
    } as Storage & { values: Map<string, string> };
}

const questions: AgentQuestion[] = [
    { id: 'time', question: '出生时间？', header: '出生时间', options: [{ id: 'morning', label: '早上' }, { id: 'noon', label: '中午' }], allowCustom: true },
    { id: 'place', question: '出生地点？', allowCustom: true, allowSkip: true },
];

test('a stored draft keeps only the asked questions and reads malformed values as unanswered', () => {
    const raw = JSON.stringify({ answers: { time: ['morning', 3, 'noon'], place: null, stale: ['x'] }, custom: { time: ' 七点左右 ', place: 5, stale: 'x' } });
    assert.deepEqual(parseQuestionDraft(raw, questions), { answers: { time: ['morning', 'noon'], place: null }, custom: { time: ' 七点左右 ', place: '' } });
    assert.deepEqual(parseQuestionDraft(null, questions), { answers: { time: [], place: [] }, custom: { time: '', place: '' } });
    assert.deepEqual(parseQuestionDraft('{bad json', questions), { answers: {}, custom: {} });
    assert.deepEqual(parseQuestionDraft('null', questions), { answers: {}, custom: {} });
    const long = parseQuestionDraft(JSON.stringify({ answers: { time: Array.from({ length: 40 }, (_, index) => `option-${index}`) }, custom: { place: '地'.repeat(9000) } }), questions);
    assert.equal(long.answers.time?.length, 31);
    assert.equal(long.custom.place.length, 8000);
});

test('submitting sends chosen options then the trimmed typed text, and the workspace names them by label', () => {
    const draft = parseQuestionDraft(JSON.stringify({ answers: { time: ['morning'], place: null }, custom: { time: ' 七点左右 ', place: '杭州' } }), questions);
    const answers = getDraftAnswers(questions, draft);
    assert.deepEqual(answers, { time: ['morning', '七点左右'], place: null }, 'a skipped question drops its typed text');
    assert.equal(describeQuestionAnswer(questions[0], answers.time), '早上、七点左右');
    assert.equal(describeQuestionAnswer(questions[1], answers.place), '已跳过');
    assert.equal(describeQuestionAnswer(questions[1], []), null);
    assert.equal(describeQuestionAnswer(questions[1], undefined), null);
    assert.deepEqual(getDraftAnswers(questions, { answers: {}, custom: { place: '   ' } }), { time: [], place: [] }, 'blank text is no answer');
});

test('a draft is shared within the tab, rereads only its own keys from other tabs and is removed on submit', () => {
    const storage = storageFixture();
    const store = createQuestionDraftStore(() => storage);
    const key = questionDraftKey('alice:conversation:run', 'ask-1');
    assert.equal(key, 'taibu.question:alice:conversation:run:ask-1');
    let notified = 0;
    const unsubscribe = store.subscribe(() => { notified++; });
    assert.equal(store.read(key), null);
    store.write(key, { answers: { time: ['morning'] }, custom: {} });
    const written = store.read(key);
    assert.equal(written, storage.values.get(key));
    assert.equal(store.read(key), written, 'the snapshot stays the same string until the draft changes');
    assert.equal(notified, 1);

    storage.values.set(key, JSON.stringify({ answers: { time: ['noon'] }, custom: {} }));
    assert.equal(store.read(key), written, 'another tab’s change waits for its storage event');
    store.forget('taibu.workspace:alice');
    assert.equal(notified, 1, 'storage events for other keys are ignored');
    store.forget(key);
    assert.equal(notified, 2);
    assert.deepEqual(parseQuestionDraft(store.read(key), questions).answers.time, ['noon']);
    storage.values.clear();
    store.forget(null);
    assert.equal(store.read(key), null, 'cleared storage clears every cached draft');

    store.write(key, { answers: { place: null }, custom: {} });
    store.remove(key);
    assert.equal(storage.values.has(key), false);
    assert.equal(store.read(key), null);
    unsubscribe();
    const before = notified;
    store.write(key, { answers: {}, custom: {} });
    assert.equal(notified, before, 'an unsubscribed listener is not called');
});

test('a draft stays in memory when storage is denied, full or absent', () => {
    const denied = {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('quota'); },
        removeItem() { throw new Error('denied'); },
    } as unknown as Storage;
    const key = questionDraftKey('alice:conversation:run', 'ask-1');
    for (const store of [createQuestionDraftStore(() => denied), createQuestionDraftStore(() => undefined)]) {
        assert.equal(store.read(key), null);
        store.write(key, { answers: { time: ['morning'] }, custom: {} });
        assert.deepEqual(parseQuestionDraft(store.read(key), questions).answers, { time: ['morning'], place: [] });
        store.remove(key);
        assert.equal(store.read(key), null);
    }
});
