import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_SYSTEM_PROMPT } from '../lib/ai/base-prompt';
import { METHOD_PRINCIPLES } from 'taibu-core/mcp';

const bullets = (text: string) => text.split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2));

test('the chat reading principles stay in step with the skill method principles', () => {
  const chat = bullets(BASE_SYSTEM_PROMPT.split('## 解读通则\n\n')[1]);
  const skill = bullets(METHOD_PRINCIPLES);

  // 普通对话版逐条搬自 SKILL.md，只有涉及工具的条款改写；两侧条数与共同条目必须对得上。
  assert.equal(chat.length, skill.length, '通则条数已变化，请同步两份文本');
  assert.equal(chat.filter((line) => skill.includes(line)).length, 4, '共同条款应逐字一致');
  assert.ok(!BASE_SYSTEM_PROMPT.includes('调用工具'), '普通对话没有工具，不应要求调用');
});
