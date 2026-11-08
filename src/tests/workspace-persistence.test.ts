import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carryDraftWorkspace } from '../lib/chat/workspace-persistence';

function storage(entries: Record<string, string>) {
    const values = new Map(Object.entries(entries));
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
    };
}

test('a draft workspace carries its open panel and selected page to the new conversation', () => {
    const store = storage({
        'taibu.workspace-open:alice:new': '1',
        'taibu.workspace:alice:new': '{"tabs":["tool:i"],"selected":"tool:i","followModel":false}',
        'taibu.workspace-open:bob:new': '1',
    });
    carryDraftWorkspace(store, 'alice', 'conversation-1');
    assert.equal(store.values.get('taibu.workspace-open:alice:conversation-1'), '1');
    assert.equal(store.values.get('taibu.workspace:alice:conversation-1'), '{"tabs":["tool:i"],"selected":"tool:i","followModel":false}');
    assert.equal(store.values.get('taibu.workspace-open:bob:new'), '1', 'other accounts keep their own draft state');
});

test('an existing conversation keeps its own workspace state', () => {
    const store = storage({
        'taibu.workspace-open:alice:new': '1',
        'taibu.workspace-open:alice:conversation-1': '0',
        'taibu.workspace:alice:new': '{"selected":"old"}',
        'taibu.workspace:alice:conversation-1': '{"selected":"saved"}',
    });
    carryDraftWorkspace(store, 'alice', 'conversation-1');
    assert.equal(store.values.get('taibu.workspace-open:alice:conversation-1'), '0');
    assert.equal(store.values.get('taibu.workspace:alice:conversation-1'), '{"selected":"saved"}');
});
