import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('chat settings entries live in the chat header and reuse shared settings center icons', () => {
  const headerSource = readFileSync(resolve(process.cwd(), 'src/components/chat/ChatHeader.tsx'), 'utf8');
  const chatPageSource = readFileSync(resolve(process.cwd(), 'src/app/chat/page.tsx'), 'utf8');

  // 右上角菜单只保留知识库与导出/记录视图；新建对话、个性化与列宽设置已移除。
  assert.match(headerSource, /<SettingsCenterLink tab="knowledge-base"/u);
  assert.equal(headerSource.includes('tab="personalization"'), false);
  assert.equal(headerSource.includes('新建对话'), false);
  assert.equal(headerSource.includes('阅读列宽'), false);
  assert.match(headerSource, /导出选项/u);
  assert.match(headerSource, /对话记录视图/u);

  // /chat shows no site header at any width, so the page feeds no entries to its menu.
  assert.equal(chatPageSource.includes('useHeaderMenu'), false);
  assert.equal(chatPageSource.includes('MessageCircleHeart'), false);
});
