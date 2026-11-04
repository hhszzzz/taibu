import test from 'node:test';
import assert from 'node:assert/strict';

type FetchLike = typeof global.fetch;

test('loadConversationWindow should preserve the already loaded conversation window size on refresh', async () => {
  const originalFetch = global.fetch;
  const requests: string[] = [];

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.includes('/api/conversations?limit=7&offset=0')) {
      return new Response(JSON.stringify({
        conversations: Array.from({ length: 7 }, (_, index) => ({
          id: `conv-${index + 1}`,
          user_id: 'user-1',
            title: `对话 ${index + 1}`,
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-17T00:00:00.000Z',
          messages: [],
        })),
        pagination: {
          hasMore: true,
          nextOffset: 7,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/conversations?limit=7&offset=7')) {
      return new Response(JSON.stringify({
        conversations: Array.from({ length: 7 }, (_, index) => ({
          id: `conv-${index + 8}`,
          user_id: 'user-1',
            title: `对话 ${index + 8}`,
          created_at: '2026-03-16T00:00:00.000Z',
          updated_at: '2026-03-16T00:00:00.000Z',
          messages: [],
        })),
        pagination: {
          hasMore: true,
          nextOffset: 14,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as FetchLike;

  try {
    const conversationModule = await import('../lib/chat/conversation');
    const result = await conversationModule.loadConversationWindow({
      targetCount: 14,
    });

    assert.equal(result?.conversations.length, 14);
    assert.equal(result?.pagination.hasMore, true);
    assert.equal(result?.pagination.nextOffset, 14);
    assert.deepEqual(requests, [
      '/api/conversations?limit=7&offset=0',
      '/api/conversations?limit=7&offset=7',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('loadConversationWindow should fetch only the remaining target rows for viewport top-up', async () => {
  const originalFetch = global.fetch;
  const requests: string[] = [];

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.includes('/api/conversations?limit=7&offset=0')) {
      return new Response(JSON.stringify({
        conversations: Array.from({ length: 7 }, (_, index) => ({
          id: `conv-${index + 1}`,
          user_id: 'user-1',
            title: `对话 ${index + 1}`,
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-17T00:00:00.000Z',
          messages: [],
        })),
        pagination: {
          hasMore: true,
          nextOffset: 7,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/conversations?limit=3&offset=7')) {
      return new Response(JSON.stringify({
        conversations: Array.from({ length: 3 }, (_, index) => ({
          id: `conv-${index + 8}`,
          user_id: 'user-1',
            title: `对话 ${index + 8}`,
          created_at: '2026-03-16T00:00:00.000Z',
          updated_at: '2026-03-16T00:00:00.000Z',
          messages: [],
        })),
        pagination: {
          hasMore: true,
          nextOffset: 10,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as FetchLike;

  try {
    const conversationModule = await import('../lib/chat/conversation');
    const result = await conversationModule.loadConversationWindow({
      targetCount: 10,
    });

    assert.equal(result?.conversations.length, 10);
    assert.equal(result?.pagination.hasMore, true);
    assert.equal(result?.pagination.nextOffset, 10);
    assert.deepEqual(requests, [
      '/api/conversations?limit=7&offset=0',
      '/api/conversations?limit=3&offset=7',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('loadConversationWindow should keep fetching until previously loaded conversation ids are preserved', async () => {
  const originalFetch = global.fetch;
  const requests: string[] = [];

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.includes('/api/conversations?limit=7&offset=0')) {
      return new Response(JSON.stringify({
        conversations: Array.from({ length: 7 }, (_, index) => ({
          id: `new-${index + 1}`,
          user_id: 'user-1',
            title: `新对话 ${index + 1}`,
          created_at: '2026-03-18T00:00:00.000Z',
          updated_at: '2026-03-18T00:00:00.000Z',
          messages: [],
        })),
        pagination: {
          hasMore: true,
          nextOffset: 7,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/conversations?limit=7&offset=7')) {
      return new Response(JSON.stringify({
        conversations: Array.from({ length: 7 }, (_, index) => ({
          id: `conv-${index + 1}`,
          user_id: 'user-1',
            title: `旧对话 ${index + 1}`,
          created_at: '2026-03-17T00:00:00.000Z',
          updated_at: '2026-03-17T00:00:00.000Z',
          messages: [],
        })),
        pagination: {
          hasMore: true,
          nextOffset: 14,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/conversations?limit=7&offset=14')) {
      return new Response(JSON.stringify({
        conversations: Array.from({ length: 7 }, (_, index) => ({
          id: `conv-${index + 8}`,
          user_id: 'user-1',
            title: `旧对话 ${index + 8}`,
          created_at: '2026-03-16T00:00:00.000Z',
          updated_at: '2026-03-16T00:00:00.000Z',
          messages: [],
        })),
        pagination: {
          hasMore: false,
          nextOffset: null,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as FetchLike;

  try {
    const conversationModule = await import('../lib/chat/conversation');
    const result = await conversationModule.loadConversationWindow({
      targetCount: 14,
      preserveIds: Array.from({ length: 14 }, (_, index) => `conv-${index + 1}`),
    });

    assert.equal(result?.conversations.length, 21);
    assert.equal(result?.pagination.hasMore, false);
    assert.equal(result?.pagination.nextOffset, null);
    assert.ok(result?.conversations.some((conversation) => conversation.id === 'conv-14'));
    assert.deepEqual(requests, [
      '/api/conversations?limit=7&offset=0',
      '/api/conversations?limit=7&offset=7',
      '/api/conversations?limit=7&offset=14',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});
