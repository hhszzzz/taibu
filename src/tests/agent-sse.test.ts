import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAgentFrame } from '../lib/agent/sse';
import { readAgentStream, canAdoptAgentRun } from '../lib/agent/browser-client';
import type { AgentRunView } from '../lib/agent/types';

test('slow consumers cannot grow the server stream queue beyond its byte budget', async () => {
    let stopped = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
        assert.equal(enqueueAgentFrame(controller, new Uint8Array(8)), true);
        stopped = !enqueueAgentFrame(controller, new Uint8Array(9));
    } }, { highWaterMark: 16, size: item => item.byteLength });
    assert.equal(stopped, true);
    await assert.rejects(stream.getReader().read(), /BACKPRESSURE/);
});

test('正文增量帧只交给 onTail，格式不对的帧被丢掉', async () => {
    const tails: unknown[] = [];
    const runs: unknown[] = [];
    const frame = 'event: tail\ndata: {"runId":"run","seq":2,"text":"甲"}\n\n'
        + 'event: tail\ndata: {"runId":"run","seq":"x"}\n\n'
        + 'event: tail\ndata: {"runId":"run","text":"乙"}\n\n';
    await readAgentStream(new Response(frame), new AbortController().signal, run => runs.push(run), { onTail: tail => tails.push(tail) });
    assert.deepEqual(tails, [{ runId: 'run', seq: 2, text: '甲' }]);
    assert.deepEqual(runs, []);
});

test('client resync resets cursor/epoch and an idle connection is cancelled', async () => {
    const resets: unknown[] = [];
    const frame = 'event: resync\ndata: {"version":1,"runId":"run","cursor":2,"epoch":3,"reason":"epoch"}\n\n';
    await readAgentStream(new Response(frame), new AbortController().signal, () => {}, { onResync: info => resets.push(info) });
    assert.equal(resets.length, 1);
    let cancelled = false;
    const idle = new ReadableStream({ cancel() { cancelled = true; } });
    await assert.rejects(readAgentStream(new Response(idle), new AbortController().signal, () => {}, { idleTimeoutMs: 10 }), /IDLE/);
    assert.equal(cancelled, true);
    const base = { id: 'run', conversationId: 'chat', cursor: 20, epoch: 3 } as AgentRunView;
    assert.equal(canAdoptAgentRun(base, { ...base, cursor: 30, epoch: 2 }), false);
    assert.equal(canAdoptAgentRun(base, { ...base, cursor: 2, epoch: 4 }), true);
});
