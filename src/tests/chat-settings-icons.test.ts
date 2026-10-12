import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('chat settings entries live in the chat header and reuse shared settings center icons', () => {
  const headerSource = readFileSync(resolve(process.cwd(), 'src/components/chat/ChatHeader.tsx'), 'utf8');
  const chatPageSource = readFileSync(resolve(process.cwd(), 'src/app/chat/page.tsx'), 'utf8');

  assert.equal(headerSource.includes("import { SETTINGS_CENTER_TAB_ICONS } from '@/components/settings/settings-center-icons'"), true);
  assert.equal(headerSource.includes('const PersonalizationIcon = SETTINGS_CENTER_TAB_ICONS.personalization'), true);
  assert.match(headerSource, /<PersonalizationIcon\b/u);
  assert.equal(headerSource.includes('MessageCircleHeart'), false);
  assert.match(headerSource, /<SettingsCenterLink tab="personalization"/u);
  assert.match(headerSource, /<SettingsCenterLink tab="knowledge-base"/u);

  // /chat shows no site header at any width, so the page feeds no entries to its menu.
  assert.equal(chatPageSource.includes('useHeaderMenu'), false);
  assert.equal(chatPageSource.includes('MessageCircleHeart'), false);
});
