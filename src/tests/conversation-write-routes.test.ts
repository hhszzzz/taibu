import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon';

const VALID_CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

test('conversations POST should create through transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: 'conv-1', error: null });
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { POST } = await import('../app/api/conversations/route');
  const response = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '会话标题',
      personality: 'general',
      messages: [
        {
          id: 'm-1',
          role: 'user',
          content: '你好',
          createdAt: '2026-04-09T00:00:00.000Z',
        },
      ],
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'create_conversation_with_messages');
  assert.deepEqual(rpcCall.args, {
    p_user_id: 'user-1',
    p_title: '会话标题',
    p_personality: 'general',
    p_source_type: null,
    p_source_data: null,
    p_messages: [
      {
        id: 'm-1',
        role: 'user',
        content: '你好',
        createdAt: '2026-04-09T00:00:00.000Z',
      },
    ],
  });
  assert.equal(payload.id, 'conv-1');
});

test('conversations POST should reject non-object request bodies', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { POST } = await import('../app/api/conversations/route');
  const response = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null',
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '请求体必须是对象');
});

test('conversations POST should reject non-string title and personality payloads', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { POST } = await import('../app/api/conversations/route');

  const badTitleResponse = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: { bad: true } }),
  }));
  const badTitlePayload = await badTitleResponse.json();
  assert.equal(badTitleResponse.status, 400);
  assert.equal(badTitlePayload.error, 'title 必须是字符串或 null');

  const badPersonalityResponse = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personality: 123 }),
  }));
  const badPersonalityPayload = await badPersonalityResponse.json();
  assert.equal(badPersonalityResponse.status, 400);
  assert.equal(badPersonalityPayload.error, 'personality 必须是字符串或 null');
});

test('conversations POST should normalize blank titles back to the default title', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: 'conv-1', error: null });
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { POST } = await import('../app/api/conversations/route');
  const response = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '   ' }),
  }));

  assert.equal(response.status, 201);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.args.p_title, '新对话');
});

test('conversations POST should reject non-array non-null messages payloads', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { POST } = await import('../app/api/conversations/route');
  const response = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: { bad: true } }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'messages 必须是数组或 null');
});

test('conversations POST should reject invalid message items inside messages array', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { POST } = await import('../app/api/conversations/route');
  const response = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [null] }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'messages 包含非法消息项');
});

test('conversations POST should reject message items with invalid createdAt timestamps', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { POST } = await import('../app/api/conversations/route');
  const response = await POST(new NextRequest('http://localhost/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          id: 'm-1',
          role: 'user',
          content: 'hi',
          createdAt: 'not-a-date',
        },
      ],
    }),
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'messages 包含非法消息项');
});

test('conversation detail PATCH should update through transactional rpc', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: { status: 'ok' }, error: null });
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '更新标题',
        personality: 'master',
        messages: [
          {
            id: 'm-2',
            role: 'assistant',
            content: '回复',
            createdAt: '2026-04-09T00:01:00.000Z',
          },
        ],
      }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'update_conversation_with_messages');
  assert.deepEqual(rpcCall.args, {
    p_conversation_id: VALID_CONVERSATION_ID,
    p_title: '更新标题',
    p_title_present: true,
    p_personality: 'master',
    p_personality_present: true,
    p_messages: [
      {
        id: 'm-2',
        role: 'assistant',
        content: '回复',
        createdAt: '2026-04-09T00:01:00.000Z',
      },
    ],
    p_messages_present: true,
  });
  assert.equal(payload.success, true);
  assert.equal(payload.id, VALID_CONVERSATION_ID);
});

test('conversation detail PATCH should return 404 when transactional rpc reports missing conversation', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        return Promise.resolve({ data: { status: 'not_found' }, error: null });
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${MISSING_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '不存在' }),
    }),
    { params: Promise.resolve({ id: MISSING_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '对话不存在');
});

test('conversation detail PATCH should normalize messages null into an empty transactional write', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        return Promise.resolve({ data: { status: 'ok' }, error: null });
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: null }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
  const [rpcCall] = rpcCalls;
  assert.ok(rpcCall);
  assert.equal(rpcCall.fn, 'update_conversation_with_messages');
  assert.deepEqual(rpcCall.args, {
    p_conversation_id: VALID_CONVERSATION_ID,
    p_title: null,
    p_title_present: false,
    p_personality: null,
    p_personality_present: false,
    p_messages: [],
    p_messages_present: true,
  });
  assert.equal(payload.success, true);
});

test('conversation detail PATCH should reject non-array non-null messages payloads', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: { bad: true } }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'messages 必须是数组或 null');
});

test('conversation detail PATCH should reject non-object request bodies', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '请求体必须是对象');
});

test('conversation detail PATCH should reject non-string title and personality payloads', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');

  const badTitleResponse = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: { bad: true } }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const badTitlePayload = await badTitleResponse.json();
  assert.equal(badTitleResponse.status, 400);
  assert.equal(badTitlePayload.error, 'title 必须是字符串或 null');

  const badPersonalityResponse = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personality: 123 }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const badPersonalityPayload = await badPersonalityResponse.json();
  assert.equal(badPersonalityResponse.status, 400);
  assert.equal(badPersonalityPayload.error, 'personality 必须是字符串或 null');
});

test('conversation detail PATCH should reject blank titles after trimming', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'title 不能为空');
});

test('conversation detail PATCH should reject invalid message items inside messages array', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [42] }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'messages 包含非法消息项');
});

test('conversation detail PATCH should reject message items with invalid createdAt timestamps', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            id: 'm-1',
            role: 'assistant',
            content: 'bad time',
            createdAt: 'not-a-date',
          },
        ],
      }),
    }),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, 'messages 包含非法消息项');
});

test('conversation detail GET should reject invalid conversation ids', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      from() {
        throw new Error('db should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { GET } = await import('../app/api/conversations/[id]/route');
  const response = await GET(
    new NextRequest('http://localhost/api/conversations/not-a-uuid'),
    { params: Promise.resolve({ id: 'not-a-uuid' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '对话ID格式不合法');
});

test('conversation detail PATCH should reject invalid conversation ids', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc() {
        throw new Error('rpc should not be called');
      },
    },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { PATCH } = await import('../app/api/conversations/[id]/route');
  const response = await PATCH(
    new NextRequest('http://localhost/api/conversations/not-a-uuid', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    }),
    { params: Promise.resolve({ id: 'not-a-uuid' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '对话ID格式不合法');
});

test('conversation detail DELETE should return 404 when rpc reports missing conversation', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const deleteModule = require('../lib/chat/conversation-delete') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalDeleteConversationGraph = deleteModule.deleteConversationGraph;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {},
  });
  deleteModule.deleteConversationGraph = async () => ({
    error: null,
    notFound: true,
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    deleteModule.deleteConversationGraph = originalDeleteConversationGraph;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { DELETE } = await import('../app/api/conversations/[id]/route');
  const response = await DELETE(
    new NextRequest('http://localhost/api/conversations/11111111-1111-4111-8111-111111111111', {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error, '对话不存在');
});

test('conversation detail DELETE should reject invalid conversation ids', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');
  const originalRequireUserContext = apiUtilsModule.requireUserContext;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {},
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { DELETE } = await import('../app/api/conversations/[id]/route');
  const response = await DELETE(
    new NextRequest('http://localhost/api/conversations/not-a-uuid', {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: 'not-a-uuid' }) },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, '对话ID格式不合法');
});

test('conversation detail route should fail loudly when message storage cannot be loaded', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const conversationMessagesModule = require('../lib/server/conversation-messages') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalLoadAllConversationMessages = conversationMessagesModule.loadAllConversationMessages;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      from(table: string) {
        assert.equal(table, 'conversations_with_archive_status');
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: VALID_CONVERSATION_ID,
                          user_id: 'user-1',
                          title: 'Test',
                          personality: 'general',
                          created_at: '2026-03-18T00:00:00.000Z',
                          updated_at: '2026-03-18T00:00:00.000Z',
                          source_type: 'chat',
                          source_data: null,
                          is_archived: false,
                          archived_kb_ids: [],
                        },
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  });

  conversationMessagesModule.loadAllConversationMessages = async () => ({
    messages: [],
    error: { code: '42P01', message: 'relation "conversation_messages" does not exist' },
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    conversationMessagesModule.loadAllConversationMessages = originalLoadAllConversationMessages;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { GET } = await import('../app/api/conversations/[id]/route');
  const response = await GET(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}`),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) }
  );

  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, '加载对话失败');
});

test('conversation detail route returns analysis snapshot without loading full messages', async (t) => {
  const apiUtilsModule = require('../lib/api-utils') as any;
  const conversationMessagesModule = require('../lib/server/conversation-messages') as any;
  const routePath = require.resolve('../app/api/conversations/[id]/route');

  const originalRequireUserContext = apiUtilsModule.requireUserContext;
  const originalLoadAllConversationMessages = conversationMessagesModule.loadAllConversationMessages;
  const originalLoadConversationAnalysisMessage = conversationMessagesModule.loadConversationAnalysisMessage;
  let loadedFullMessages = false;

  apiUtilsModule.requireUserContext = async () => ({
    user: { id: 'user-1' },
    supabase: {
      from(table: string) {
        assert.equal(table, 'conversations_with_archive_status');
        return {
          select(columns: string) {
            assert.match(columns, /source_data/u);
            return {
              eq() {
                return {
                  eq() {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: VALID_CONVERSATION_ID,
                          user_id: 'user-1',
                          source_data: {
                            model_id: 'glm-4',
                            reasoning_text: 'source reasoning',
                            reasoning: true,
                          },
                        },
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  });

  conversationMessagesModule.loadAllConversationMessages = async () => {
    loadedFullMessages = true;
    return { messages: [], error: null };
  };
  conversationMessagesModule.loadConversationAnalysisMessage = async () => ({
    message: {
      id: 'm1',
      role: 'assistant',
      content: 'saved analysis',
      createdAt: '2026-03-18T00:00:00.000Z',
    },
    error: null,
  });

  t.after(() => {
    apiUtilsModule.requireUserContext = originalRequireUserContext;
    conversationMessagesModule.loadAllConversationMessages = originalLoadAllConversationMessages;
    conversationMessagesModule.loadConversationAnalysisMessage = originalLoadConversationAnalysisMessage;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { GET } = await import('../app/api/conversations/[id]/route');
  const response = await GET(
    new NextRequest(`http://localhost/api/conversations/${VALID_CONVERSATION_ID}?snapshot=analysis`),
    { params: Promise.resolve({ id: VALID_CONVERSATION_ID }) }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(loadedFullMessages, false);
  assert.deepEqual(body.snapshot, {
    analysis: 'saved analysis',
    reasoning: 'source reasoning',
    modelId: 'glm-4',
    reasoningEnabled: true,
  });
});

test('conversations GET should forward chartId filter to source_data query', async (t) => {
  const apiUtils = require('../lib/api-utils') as {
    requireUserContext: typeof import('../lib/api-utils').requireUserContext;
  };
  const routePath = require.resolve('../app/api/conversations/route');
  const originalRequireUserContext = apiUtils.requireUserContext;
  const filters: Array<{ column: string; value: unknown }> = [];

  apiUtils.requireUserContext = (async () => ({
    user: { id: 'user-1' },
    supabase: {
      from(table: string) {
        assert.equal(table, 'conversations_with_archive_status');
        const query = {
          select() {
            return query;
          },
          eq(column: string, value: unknown) {
            filters.push({ column, value });
            return query;
          },
          order() {
            return query;
          },
          range: async () => ({
            data: [],
            error: null,
          }),
        };
        return query;
      },
    },
  })) as unknown as typeof apiUtils.requireUserContext;

  t.after(() => {
    apiUtils.requireUserContext = originalRequireUserContext;
    delete require.cache[routePath];
  });

  delete require.cache[routePath];
  const { GET } = await import('../app/api/conversations/route');
  const response = await GET(new NextRequest('http://localhost/api/conversations?includeArchived=true&sourceType=bazi_wuxing&chartId=chart-1&limit=1'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(filters, [
    { column: 'user_id', value: 'user-1' },
    { column: 'source_type', value: 'bazi_wuxing' },
    { column: 'source_data->>chart_id', value: 'chart-1' },
  ]);
  assert.deepEqual(payload.conversations, []);
});
