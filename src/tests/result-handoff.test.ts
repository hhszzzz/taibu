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
