import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listToolDefinitions } from 'taibu-core/mcp';

const coreRoot = resolve(process.cwd(), 'packages/core');
const packageJson = JSON.parse(readFileSync(resolve(coreRoot, 'package.json'), 'utf8'));
const readme = readFileSync(resolve(coreRoot, 'README.md'), 'utf8');
const rootIndex = readFileSync(resolve(coreRoot, 'src/index.ts'), 'utf8');
const typesIndex = readFileSync(resolve(coreRoot, 'src/types.ts'), 'utf8');
const jsonTypesIndex = readFileSync(resolve(coreRoot, 'src/json-types.ts'), 'utf8');
const mcpTools = readFileSync(resolve(coreRoot, 'src/mcp/tools.ts'), 'utf8');

const expectedDomains = [
  { domain: 'astrology', tool: 'astrology' },
  { domain: 'bazi', tool: 'bazi' },
  { domain: 'bazi-dayun', tool: 'bazi_dayun' },
  { domain: 'bazi-pillars-resolve', tool: 'bazi_pillars_resolve' },
  { domain: 'almanac', tool: 'almanac' },
  { domain: 'liuyao', tool: 'liuyao' },
  { domain: 'meihua', tool: 'meihua' },
  { domain: 'qimen', tool: 'qimen' },
  { domain: 'tarot', tool: 'tarot' },
  { domain: 'taiyi', tool: 'taiyi' },
  { domain: 'daliuren', tool: 'daliuren' },
  { domain: 'xiaoliuren', tool: 'xiaoliuren' },
  { domain: 'ziwei', tool: 'ziwei' },
  { domain: 'ziwei-horoscope', tool: 'ziwei_horoscope' },
  { domain: 'ziwei-flying-star', tool: 'ziwei_flying_star' },
];

test('public core domains should stay aligned across exports, docs, and MCP registry', () => {
  const toolNames = new Set(listToolDefinitions().map((item) => item.name));

  for (const { domain, tool } of expectedDomains) {
    assert.match(rootIndex, new RegExp(`domains/${domain}/index\\.js`), `${domain} should be exported from src/index.ts`);
    assert.match(typesIndex, new RegExp(`domains/${domain}/types\\.js`), `${domain} should be exported from src/types.ts`);
    assert.match(jsonTypesIndex, new RegExp(`domains/${domain}/json-types\\.js`), `${domain} should be exported from src/json-types.ts`);
    assert.ok(packageJson.exports[`./${domain}`], `${domain} should have a package.json subpath export`);
    assert.match(readme, new RegExp(`taibu-core/${domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${domain} should be documented in README domain list`);
    assert.match(mcpTools, new RegExp(`domains/${domain}/tool\\.js`), `${domain} should be registered in src/mcp/tools.ts`);
    assert.equal(toolNames.has(tool), true, `${tool} should be exposed via MCP`);
    assert.match(readme, new RegExp(`\\|\\s+\\\`${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\`\\s+\\|`), `${tool} should be documented in README tool list`);
  }
});

test('root core entry should expose canonical json/text option types for newly added domains', () => {
  for (const typeName of [
    'AstrologyAspectJSON',
    'AstrologyCanonicalJSON',
    'AstrologyCanonicalTextOptions',
    'AstrologyFactorJSON',
    'AstrologyHouseJSON',
    'TaiyiCanonicalJSON',
    'TaiyiCanonicalTextOptions',
    'XiaoliurenCanonicalJSON',
  ]) {
    assert.match(rootIndex, new RegExp(`\\b${typeName}\\b`), `${typeName} should be exported from src/index.ts`);
  }
});

test('MCP tool titles should be present and derived from the canonical description prefix', () => {
  const definitions = listToolDefinitions();
  assert.equal(definitions.length, expectedDomains.length);
  assert.equal(definitions.find((tool) => tool.name === 'bazi')?.title, '八字命盘');
  assert.equal(definitions.find((tool) => tool.name === 'xiaoliuren')?.title, '小六壬占测');
  assert.ok(definitions.every((tool) => typeof tool.title === 'string' && tool.title.length > 0));
});

test('tool schemas should encode runtime defaults and conditional requirements structurally', () => {
  const toolMap = new Map(listToolDefinitions().map((item) => [item.name, item]));
  const almanac = toolMap.get('almanac');
  const astrology = toolMap.get('astrology');
  const liuyao = toolMap.get('liuyao');
  const qimen = toolMap.get('qimen');
  const taiyi = toolMap.get('taiyi');
  const tarot = toolMap.get('tarot');
  const ziweiHoroscope = toolMap.get('ziwei_horoscope');

  assert.match(almanac?.inputSchema?.properties?.date?.description ?? '', /省略时取当前日期/u);

  assert.equal(astrology?.inputSchema?.properties?.birthMinute?.default, 0);
  assert.equal(astrology?.inputSchema?.properties?.houseSystem?.default, 'placidus');
  assert.match(astrology?.inputSchema?.properties?.transitDateTime?.description ?? '', /省略时取当前时刻/u);

  assert.equal(liuyao?.inputSchema?.properties?.method?.default, 'auto');
  assert.ok(Array.isArray(liuyao?.inputSchema?.allOf));
  assert.match(JSON.stringify(liuyao?.inputSchema?.allOf), /"method":\{"const":"number"\}/u);
  assert.match(JSON.stringify(liuyao?.inputSchema?.allOf), /"required":\["numbers"\]/u);
  assert.match(JSON.stringify(liuyao?.inputSchema?.allOf), /"method":\{"const":"select"\}/u);
  assert.match(JSON.stringify(liuyao?.inputSchema?.allOf), /"required":\["hexagramName"\]/u);

  assert.equal(qimen?.inputSchema?.properties?.minute?.default, 0);
  assert.equal(qimen?.inputSchema?.properties?.timezone?.default, 'Asia/Shanghai');
  assert.equal(qimen?.inputSchema?.properties?.panType?.default, 'zhuan');
  assert.equal(qimen?.inputSchema?.properties?.juMethod?.default, 'chaibu');
  assert.equal(qimen?.inputSchema?.properties?.zhiFuJiGong?.default, 'ji_wugong');

  assert.equal(taiyi?.inputSchema?.properties?.hour?.default, 12);
  assert.equal(taiyi?.inputSchema?.properties?.minute?.default, 0);
  assert.equal(taiyi?.inputSchema?.properties?.timezone?.default, 'Asia/Shanghai');
  assert.ok(Array.isArray(taiyi?.inputSchema?.allOf));
  assert.match(JSON.stringify(taiyi?.inputSchema?.allOf), /"mode":\{"const":"hour"\}/u);
  assert.match(JSON.stringify(taiyi?.inputSchema?.allOf), /"required":\["hour"\]/u);
  assert.match(JSON.stringify(taiyi?.inputSchema?.allOf), /"mode":\{"const":"minute"\}/u);
  assert.match(JSON.stringify(taiyi?.inputSchema?.allOf), /"required":\["hour","minute"\]/u);

  assert.equal(tarot?.inputSchema?.properties?.spreadType?.default, 'single');
  assert.equal(tarot?.inputSchema?.properties?.allowReversed?.default, true);

  assert.equal(ziweiHoroscope?.inputSchema?.properties?.birthMinute?.default, 0);
  assert.equal(ziweiHoroscope?.inputSchema?.properties?.calendarType?.default, 'solar');
  assert.equal(ziweiHoroscope?.inputSchema?.properties?.isLeapMonth?.default, false);
  assert.match(ziweiHoroscope?.inputSchema?.properties?.targetDate?.description ?? '', /省略时取当前日期/u);
});
