import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readChatRecordView,
  readChatRecordViewDefault,
  writeChatRecordView,
  writeChatRecordViewDefault,
} from '../lib/chat/chat-record-view';

function setupWindow(t: { after: (fn: () => void) => void }) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: () => true,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
      },
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete (globalThis as { window?: unknown }).window;
  });
  return storage;
}

test('record view defaults to 普通 without a stored preference', (t) => {
  setupWindow(t);
  assert.equal(readChatRecordView('u1'), 'normal');
  assert.equal(readChatRecordViewDefault('u1'), 'normal');
});

test('a conversation override wins over the default and stays scoped to that conversation', (t) => {
  setupWindow(t);
  writeChatRecordViewDefault('u1', 'normal');
  writeChatRecordView('u1', 'detailed', 'c1');

  assert.equal(readChatRecordView('u1', 'c1'), 'detailed');
  assert.equal(readChatRecordView('u1', 'c2'), 'normal');
  assert.equal(readChatRecordViewDefault('u1'), 'normal');
});

test('「将详细设为默认」changes new conversations without rewriting existing overrides', (t) => {
  setupWindow(t);
  writeChatRecordView('u1', 'normal', 'c1');
  writeChatRecordViewDefault('u1', 'detailed');

  assert.equal(readChatRecordView('u1', 'c1'), 'normal');
  assert.equal(readChatRecordView('u1', 'c2'), 'detailed');
  assert.equal(readChatRecordViewDefault('u1'), 'detailed');
});

test('invalid stored values fall back to 普通', (t) => {
  const storage = setupWindow(t);
  storage.set('taibu:chat-record-view:u1', 'verbose');
  storage.set('taibu:chat-record-view:u1:c1', 'loud');

  assert.equal(readChatRecordViewDefault('u1'), 'normal');
  assert.equal(readChatRecordView('u1', 'c1'), 'normal');
});
