import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FetchLike = typeof global.fetch;

test('loadConversation should return an explicit error for non-404 responses', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async () => new Response(JSON.stringify({
    error: '认证失败',
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })) as FetchLike;

  try {
    const { loadConversation } = await import('../lib/chat/conversation');
    const result = await loadConversation('conv-1');

    assert.deepEqual(result, {
      ok: false,
      notFound: false,
      error: '认证失败',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('loadConversation should return an explicit error when the request throws', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async () => {
    throw new Error('网络异常');
  }) as FetchLike;

  try {
    const { loadConversation } = await import('../lib/chat/conversation');
    const result = await loadConversation('conv-2');

    assert.deepEqual(result, {
      ok: false,
      notFound: false,
      error: '网络异常',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('loadConversations should map paginated list payloads through the browser api boundary', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/conversations?limit=2&offset=4');
    return new Response(JSON.stringify({
      conversations: [{
        id: 'conv-1',
        user_id: 'user-1',
        personality: 'general',
        title: '测试对话',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
        source_type: null,
        question_preview: '最近怎么样？',
        is_archived: false,
        archived_kb_ids: ['kb-1'],
      }],
      pagination: {
        hasMore: true,
        nextOffset: 6,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as FetchLike;

  try {
    const { loadConversations } = await import('../lib/chat/conversation');
    const result = await loadConversations({
      limit: 2,
      offset: 4,
    });

    assert.deepEqual(result, {
      conversations: [{
        id: 'conv-1',
        userId: 'user-1',
        personality: 'general',
        title: '测试对话',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        sourceType: 'chat',
        questionPreview: '最近怎么样？',
        isArchived: false,
        archivedKbIds: ['kb-1'],
      }],
      pagination: {
        hasMore: true,
        nextOffset: 6,
      },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('loadConversations should preserve AbortError from the browser api boundary', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async () => {
    throw new DOMException('aborted', 'AbortError');
  }) as FetchLike;

  try {
    const { loadConversations } = await import('../lib/chat/conversation');

    await assert.rejects(
      () => loadConversations({ signal: new AbortController().signal }),
      (error: unknown) => {
        assert.ok(error instanceof DOMException);
        assert.equal(error.name, 'AbortError');
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat state clears active conversation state only after delete succeeds', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/chat/use-chat-state.ts'), 'utf8');
  const contextSource = readFileSync(resolve(process.cwd(), 'src/lib/chat/ConversationListContext.tsx'), 'utf8');

  assert.match(
    source,
    /const success = await convList\.handleDeleteConversation\(id\);[\s\S]*if \(!success\) \{\s*return;\s*\}[\s\S]*resetDeletedConversationState\(id\);/u,
  );
  assert.match(
    contextSource,
    /window\.dispatchEvent\(new CustomEvent\(CHAT_CONVERSATION_DELETED_EVENT,/u,
  );
  assert.match(
    contextSource,
    /window\.addEventListener\(HISTORY_SUMMARY_DELETED_EVENT,/u,
  );
  assert.match(
    contextSource,
    /window\.addEventListener\(KNOWLEDGE_BASE_SYNC_EVENT,/u,
  );
});

test('chat state updates cached conversation detail title only after rename succeeds', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/chat/use-chat-state.ts'), 'utf8');

  assert.match(
    source,
    /const success = await convList\.handleRenameConversation\(id, title\);[\s\S]*if \(!success\) \{\s*return;\s*\}[\s\S]*conversationDetailsRef\.current\.set\(id,/u,
  );
});

test('chat state clears the URL when deleting the active conversation or removing id from the address bar', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/chat/use-chat-state.ts'), 'utf8');

  assert.match(
    source,
    /if \(!targetConversationId\) \{[\s\S]*if \(activeConversationIdRef\.current !== null\) \{[\s\S]*void handleNewChat\(\);/u,
  );
  assert.match(
    source,
    /if \(searchParams\.get\('id'\) === conversationId\) \{[\s\S]*router\.replace\('\/chat'\);/u,
  );
  assert.match(
    source,
    /window\.addEventListener\(CHAT_CONVERSATION_DELETED_EVENT, handler as EventListener\)/u,
  );
});

test('chat state no longer caches running task snapshots as canonical conversation detail', () => {
  const stateSource = readFileSync(resolve(process.cwd(), 'src/lib/chat/use-chat-state.ts'), 'utf8');
  const messagingSource = readFileSync(resolve(process.cwd(), 'src/lib/chat/use-chat-messaging.ts'), 'utf8');

  assert.doesNotMatch(
    stateSource,
    /getTaskMessages\(id\)[\s\S]*cacheConversationMessages\(id, runningMessages\)/u,
  );
  assert.match(
    messagingSource,
    /const shouldCachePersistedMessages = event\.type === 'task_completed'[\s\S]*event\.errorCode !== 'PERSIST_FAILED'/u,
  );
  assert.doesNotMatch(
    messagingSource,
    /taibu:knowledge-base:ingested/u,
  );
});

test('sidebar conversation viewport top-up waits for the first page to finish loading', () => {
  const sidebarSource = readFileSync(resolve(process.cwd(), 'src/components/layout/SidebarConversations.tsx'), 'utf8');
  const mobileDrawerSource = readFileSync(resolve(process.cwd(), 'src/components/chat/MobileChatDrawer.tsx'), 'utf8');
  const chatSidebarSource = readFileSync(resolve(process.cwd(), 'src/components/chat/sidebar/ChatSidebar.tsx'), 'utf8');
  const conversationItemSource = readFileSync(resolve(process.cwd(), 'src/components/chat/sidebar/ConversationItem.tsx'), 'utf8');
  const conversationSource = readFileSync(resolve(process.cwd(), 'src/lib/chat/conversation.ts'), 'utf8');
  const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/conversations/route.ts'), 'utf8');

  assert.match(
    sidebarSource,
    /const shouldAutoTopUp = !isSearching && searchQuery\.trim\(\)\.length === 0 && collapsedGroups\.size === 0;/u,
  );
  assert.match(
    sidebarSource,
    /if \(availableHeight <= 0 \|\| rowElements\.length === 0\) \{\s*return null;\s*\}/u,
  );
  assert.match(
    sidebarSource,
    /let reservedBottomHeight = 0;[\s\S]*reservedBottomHeight \+= sibling\.getBoundingClientRect\(\)\.height;/u,
  );
  assert.match(
    sidebarSource,
    /if \(!hasLoadedConversations \|\| !shouldAutoTopUp \|\| sidebarTargetCount == null\) \{\s*return;\s*\}[\s\S]*triggerConversationListLoad\(sidebarTargetCount\);/u,
  );
  assert.doesNotMatch(
    sidebarSource,
    /onClick=\{handleInteraction\}/u,
  );
  assert.match(
    sidebarSource,
    /setHasUserScrolled\(scrollContainer\.scrollTop > 0\);/u,
  );
  assert.match(
    sidebarSource,
    /!hasUserScrolled[\s\S]*void loadMoreConversations\(\);/u,
  );
  // The phone drawer shows the sidebar's own panel, so the same top-up rules apply there.
  assert.match(
    chatSidebarSource,
    /data-conversation-scroll="true">\s*\{user \? <SidebarConversations grouping="date" markers=\{markers\} withinModal=\{Boolean\(onClose\)\} \/>/u,
  );
  assert.match(mobileDrawerSource, /<ChatSidebarPanel /u);
  assert.doesNotMatch(mobileDrawerSource, /SidebarConversations|setHasUserScrolled/u);
  // Unmounted while closed: every opening starts from the top with a fresh scroll state.
  assert.doesNotMatch(mobileDrawerSource, /keepMounted/u);
  assert.doesNotMatch(
    conversationSource,
    /debugReason/u,
  );
  assert.doesNotMatch(
    routeSource,
    /conversation-debug/u,
  );
  assert.match(
    conversationItemSource,
    /data-conversation-row="true"/u,
  );
});
