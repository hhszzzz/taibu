import test from 'node:test';
import assert from 'node:assert/strict';

import type { ConversationListItem } from '../types';
import {
  formatConversationMenuTitle,
  getConversationDisplayParts,
} from '../lib/chat/conversation-title-display';

function createConversation(overrides: Partial<ConversationListItem>): ConversationListItem {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: '默认标题',
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
    sourceType: 'chat',
    questionPreview: null,
    isArchived: false,
    archivedKbIds: [],
    ...overrides,
  };
}

test('formatConversationMenuTitle keeps source-specific title normalization centralized', () => {
  assert.equal(
    formatConversationMenuTitle(createConversation({
      sourceType: 'liuyao',
      title: '求财 - 雷火丰 -> 地山谦',
    })),
    '雷火丰 变 地山谦',
  );

  assert.equal(
    formatConversationMenuTitle(createConversation({
      sourceType: 'bazi_personality',
      title: '张三 - 人格分析',
    })),
    '人格分析',
  );
});

test('getConversationDisplayParts preserves item-specific subtitle and changed-title behavior', () => {
  assert.deepEqual(
    getConversationDisplayParts(createConversation({
      sourceType: 'liuyao',
      title: '求职 - 雷火丰 -> 地山谦',
      questionPreview: '最近能拿到 offer 吗？',
    })),
    {
      mainTitle: '雷火丰',
      subTitle: '最近能拿到 offer 吗？',
      changedTitle: '地山谦',
    },
  );

  assert.deepEqual(
    getConversationDisplayParts(createConversation({
      sourceType: 'hepan',
      title: '甲 & 乙 - 情侣合盘',
    })),
    {
      mainTitle: '情侣合盘',
      subTitle: '甲 & 乙',
      changedTitle: null,
    },
  );
});
