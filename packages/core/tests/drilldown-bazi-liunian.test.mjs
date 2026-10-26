import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, listToolDefinitions, renderToolResult } from 'taibu-core/mcp';

const BIRTH = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 };

async function scan(selector) {
  return renderToolResult('bazi_liunian_scan', await executeTool('bazi_liunian_scan', { ...BIRTH, ...selector })).structuredContent;
}
const describe = (rows) => rows.map((row) => `${row.类型}:${row.位置.map((p) => `${p.柱}${p.字}`).join('·')}`);

test('bazi_liunian_scan requires a year range on top of the bazi input', () => {
  const tool = listToolDefinitions().find((item) => item.name === 'bazi_liunian_scan');
  assert.deepEqual(tool.inputSchema.required, ['gender', 'birthYear', 'birthMonth', 'birthDay', 'fromYear', 'toYear']);
  assert.ok(tool.inputSchema.examples.every((example) => example.fromYear && example.toYear && example.birthYear));
});

test('each year lists its pillar, luck period and the relations it brings', async () => {
  const json = await scan({ fromYear: 2026, toYear: 2029 });
  assert.deepEqual(json.扫描范围, { 起始年: 2026, 结束年: 2029, 列出年数: 4 });
  assert.deepEqual(json.原局四柱.map((p) => p.干支), ['己巳', '丁丑', '庚辰', '辛巳']);
  assert.deepEqual(json.逐年.map((year) => `${year.流年}${year.干支}${year.大运}`), [
    '2026丙午癸酉（第4步大运）', '2027丁未癸酉（第4步大运）', '2028戊申癸酉（第4步大运）', '2029己酉癸酉（第4步大运）',
  ]);
  const [y2026, y2027, y2028, y2029] = json.逐年;
  // 丑午相害、丑未相冲、丑戌未恃势之刑：《三命通会·论刑》《论冲击》
  assert.deepEqual(describe(y2026.原局关系), ['天干五合:时柱辛·流年丙', '相害:月柱丑·流年午']);
  assert.ok(describe(y2027.原局关系).includes('六冲:月柱丑·流年未'));
  assert.deepEqual(describe(y2027.大运关系), ['天干相冲:大运癸·流年丁']);
  // 巳申合而刑、刑而破
  assert.deepEqual(y2028.太岁关系, ['合太岁', '刑太岁', '破太岁']);
  assert.ok(describe(y2028.大运关系).includes('天干五合:大运癸·流年戊'));
  assert.ok(describe(y2029.大运关系).includes('相刑:大运酉·流年酉'), '酉自刑由大运与流年同见');
  // 每条关系都有流年参与；大运与原局的固定关系不逐年重复
  assert.ok(json.逐年.every((year) => [...year.原局关系, ...year.大运关系].every((row) => row.位置.some((p) => p.柱 === '流年'))));
  assert.ok(json.逐年.every((year) => year.原局关系.every((row) => row.位置.every((p) => p.柱 !== '大运'))));
});

test('the scan agrees with bazi_relations for the same year', async () => {
  const year = (await scan({ fromYear: 2031, toYear: 2031 })).逐年[0];
  const relations = renderToolResult('bazi_relations', await executeTool('bazi_relations', { ...BIRTH, year: 2031 })).structuredContent;
  const withFlow = relations.叠加关系.filter((row) => row.位置.some((p) => p.柱 === '流年'));
  assert.deepEqual([...year.原局关系, ...year.大运关系].map((row) => row.说明).sort(), withFlow.map((row) => row.说明).sort());
});

const cells = (row) => row.位置.map((p) => `${p.柱}${p.部位}`);

test('types keeps only years with those relations, marks same-character relations and counts the rest', async () => {
  const clashes = await scan({ fromYear: 2024, toYear: 2053, types: ['六冲'] });
  assert.deepEqual(clashes.筛选, { 类型: ['六冲'] });
  assert.equal(clashes.扫描范围.列出年数, clashes.逐年.length);
  assert.ok(clashes.逐年.length > 0 && clashes.逐年.every((year) => [...year.原局关系, ...year.大运关系].length > 0
    && [...year.原局关系, ...year.大运关系].every((row) => row.类型 === '六冲')));
  // 2027 丑未冲：同一个丑、未上的恃势之刑作为牵连列出
  const y2027 = clashes.逐年.find((year) => year.流年 === 2027);
  assert.deepEqual(describe(y2027.同字牵连), ['相刑:流年未·月柱丑']);
  for (const year of clashes.逐年) {
    const kept = new Set([...year.原局关系, ...year.大运关系].flatMap(cells));
    assert.ok((year.同字牵连 ?? []).every((row) => row.类型 !== '六冲' && cells(row).some((cell) => kept.has(cell))));
  }
  assert.ok(clashes.未列出.条数 > 0 && clashes.未列出.按类型.every((item) => item.类型 !== '六冲'));
  assert.match(clashes.未列出.提示, /bazi_relations/);
});

test('pillars keeps relations touching the listed pillar; 太岁 and 值太岁 years follow 年柱 only', async () => {
  const dayPillar = await scan({ fromYear: 2024, toYear: 2033, pillars: ['日柱'] });
  assert.deepEqual(dayPillar.逐年.map((year) => year.流年), [2024, 2025, 2029, 2030, 2032, 2033]);
  assert.ok(dayPillar.逐年.every((year) => [...year.原局关系, ...year.大运关系].every((row) => row.位置.some((p) => p.柱 === '日柱'))));
  assert.ok(dayPillar.逐年.every((year) => year.太岁关系 === undefined));
  const yearPillar = await scan({ fromYear: 2024, toYear: 2053, pillars: ['年柱'] });
  // 2049 己巳：没有其他关系，只有值太岁与流年伏吟年柱，仍然列出
  const y2049 = yearPillar.逐年.find((year) => year.流年 === 2049);
  assert.deepEqual([y2049.原局关系, y2049.太岁关系, y2049.岁运提示], [[], ['值太岁'], ['流年伏吟年柱（同为己巳）']]);
  const text = renderToolResult('bazi_liunian_scan', await executeTool('bazi_liunian_scan', { ...BIRTH, fromYear: 2024, toYear: 2033, pillars: ['日柱'] })).content[0].text;
  assert.match(text, /筛选：涉及 日柱，列出 6 年/);
  assert.match(text, /- 牵连：六合｜大运地支酉·流年地支辰｜酉辰六合化金/);
  assert.match(text, /## 未列出\n\n- 另有 21 条/);
});

test('years before 起运 use 小运', async () => {
  const json = await scan({ fromYear: 1990, toYear: 1993 });
  assert.match(json.逐年[0].小运, /虚岁1/);
  assert.match(json.逐年.at(-1).大运, /第1步大运/);
});

test('ranges are bounded, ordered and start no earlier than birth', async () => {
  for (const selector of [
    { fromYear: 2024, toYear: 2054 },
    { fromYear: 2030, toYear: 2029 },
    { fromYear: 1980, toYear: 1995 },
    { fromYear: 2024, toYear: 2030, types: ['拱合'] },
    { fromYear: 2024, toYear: 2030, pillars: ['流年'] },
    { fromYear: 2024 },
  ]) {
    await assert.rejects(executeTool('bazi_liunian_scan', { ...BIRTH, ...selector }), JSON.stringify(selector));
  }
  assert.equal((await scan({ fromYear: 2024, toYear: 2053 })).逐年.length, 30);
});
