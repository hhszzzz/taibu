import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSidebarStore, isChatSidebarCollapsed } from '../lib/chat/chat-sidebar';

function storage(initial?: string) {
    const values = new Map<string, string>(initial ? [['taibu.chat-sidebar', initial]] : []);
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

test('the sidebar folds while the workspace is open and restores the viewer’s choice afterwards', () => {
    const saved = storage();
    const store = createChatSidebarStore(() => saved);
    let notified = 0;
    store.subscribe(() => { notified++; });
    const collapsed = () => isChatSidebarCollapsed(store.getSnapshot());
    assert.equal(collapsed(), false, 'expanded by default');

    store.setWorkspaceOpen(true);
    assert.equal(collapsed(), true, 'the workspace folds it to the rail');
    store.expand();
    assert.equal(collapsed(), false, 'the viewer can unfold it beside the workspace');
    store.setWorkspaceOpen(true);
    assert.equal(notified, 2, 'repeating the same state notifies no one');
    store.setWorkspaceOpen(false);
    store.setWorkspaceOpen(true);
    assert.equal(collapsed(), true, 'each opening folds again');
    store.setWorkspaceOpen(false);
    assert.equal(collapsed(), false);
    assert.equal(saved.values.has('taibu.chat-sidebar'), false, 'unfolding beside the workspace keeps the stored choice as it was');

    store.collapse();
    assert.equal(saved.values.get('taibu.chat-sidebar'), 'collapsed');
    assert.equal(collapsed(), true);
    assert.equal(isChatSidebarCollapsed(createChatSidebarStore(() => saved).getSnapshot()), true, 'the choice is read back on the next page');
    const snapshot = store.getSnapshot();
    store.collapse();
    assert.equal(store.getSnapshot(), snapshot, 'unchanged state keeps its snapshot');
});

test('a denied or missing storage keeps the choice for the page only', () => {
    const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
    for (const store of [createChatSidebarStore(() => denied), createChatSidebarStore(() => undefined)]) {
        assert.equal(isChatSidebarCollapsed(store.getSnapshot()), false);
        store.collapse();
        assert.equal(isChatSidebarCollapsed(store.getSnapshot()), true);
    }
    assert.equal(isChatSidebarCollapsed(createChatSidebarStore(() => storage('collapsed')).getSnapshot()), true);
    assert.equal(isChatSidebarCollapsed(createChatSidebarStore(() => storage('wide')).getSnapshot()), false, 'unknown values fall back to expanded');
});
