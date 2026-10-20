import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildToolSuccessPayload, executeTool } from '../dist/mcp/index.js';

/**
 * 关系引擎重构（0cb975f4）的金标：200 个种子化出生在重构前的 dist 上生成，
 * 重构后 bazi / bazi_dayun 的规范文本与结构化 JSON 必须逐字节一致。
 * 有意改动输出时按 fixture 的 revisions 记录：先确认新输出去掉所记改动后仍与旧哈希逐一相等，再整体重算。
 * 固定样本只存 sha256；重建方法见测试名与 docs/requirements-audit.md。
 */
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/bazi-golden-hashes.json', import.meta.url)), 'utf8'));

const hash = payload => createHash('sha256')
  .update(payload.content.map(part => part.text).join('\n'))
  .update('\u0000')
  .update(JSON.stringify(payload.structuredContent))
  .digest('hex');

test('bazi and bazi_dayun stay byte-identical to the pre-refactor engine on 200 seeded births', async () => {
  assert.equal(fixture.cases.length, 200);
  for (const expected of fixture.cases) {
    const args = {
      gender: expected.gender,
      birthYear: expected.birthYear,
      birthMonth: expected.birthMonth,
      birthDay: expected.birthDay,
      birthHour: expected.birthHour,
    };
    for (const name of ['bazi', 'bazi_dayun']) {
      const raw = await executeTool(name, args);
      assert.equal(hash(buildToolSuccessPayload(name, raw)), expected[name].default, `${name} default ${JSON.stringify(args)}`);
      assert.equal(hash(buildToolSuccessPayload(name, raw, { detailLevel: 'full' })), expected[name].full, `${name} full ${JSON.stringify(args)}`);
    }
  }
});
