import test from 'node:test';
import assert from 'node:assert/strict';

import * as mcpCore from 'taibu-core';

test('mcp liuyao uses fixed najia for 天风姤 and should not treat second yao as 妻财', async () => {
  const result = await mcpCore.calculateLiuyao({
    question: '问财运',
    yongShenTargets: ['妻财'],
    method: 'select',
    hexagramName: '天风姤',
    date: '2026-02-10T12:00:00',
  });

  const naJiaList = result.fullYaos.map((yao) => yao.naJia);
  assert.deepEqual(naJiaList, ['丑', '亥', '酉', '午', '申', '戌']);
  assert.equal(result.fullYaos[1]?.liuQin, '子孙');
});

test('mcp liuyao should reject empty question instead of producing formal interpretation context', async () => {
  await assert.rejects(
    () => mcpCore.calculateLiuyao({
      question: '',
      yongShenTargets: [],
      method: 'select',
      hexagramName: '乾为天',
      date: '2026-02-10T12:00:00',
    }),
    /请先明确问题后再解卦/u
  );
});

test('liuyao 相破 does not hide 日生 and is not called 日破', async () => {
  // 2024-02-15 丙寅月 己酉日：坎为水上爻子水在寅月休，酉金生子水
  const kan = await mcpCore.calculateLiuyao({ question: '问近况', yongShenTargets: ['兄弟'], method: 'select', hexagramName: '坎为水', date: '2024-02-15T10:00:00' });
  const zi = kan.fullYaos.find((yao) => yao.naJia === '子');
  assert.equal(zi.influence.dayAction, 'sheng');
  assert.equal(zi.influence.description, '日生');
  assert.equal(zi.strength.isStrong, true);
  assert.deepEqual(zi.strength.evidence, ['月令休', '日生']);

  // 2024-02-18 壬子日：子酉相破而无生克，写作「日相破」
  const gou = await mcpCore.calculateLiuyao({ question: '问近况', yongShenTargets: ['妻财'], method: 'select', hexagramName: '天风姤', date: '2024-02-18T10:00:00' });
  const you = gou.fullYaos.find((yao) => yao.naJia === '酉');
  assert.equal(you.influence.dayAction, 'po');
  assert.equal(you.influence.description, '日相破');
  assert.equal(you.strength.specialStatus, 'none');
});

test('liuyao labels a month-broken line 月破 rather than 日破', async () => {
  // 2024-02-16 丙寅月 庚戌日：申金被月建寅冲为月破，辰土休囚被日辰戌冲为日破
  const result = await mcpCore.calculateLiuyao({ question: '问近况', yongShenTargets: ['父母'], method: 'select', hexagramName: '坎为水', date: '2024-02-16T10:00:00' });
  const shen = result.fullYaos.find((yao) => yao.naJia === '申');
  const chen = result.fullYaos.find((yao) => yao.naJia === '辰');
  assert.equal(shen.strength.specialStatus, 'yuePo');
  assert.equal(shen.movementState, 'day_break');
  assert.equal(shen.movementLabel, '月破');
  assert.equal(chen.strength.specialStatus, 'riPo');
  assert.equal(chen.movementLabel, '日破');

  const lines = mcpCore.toLiuyaoCanonicalJson(result).六爻;
  assert.equal(lines.find((line) => line.纳甲 === '申').动静, '月破');
  assert.equal(lines.find((line) => line.纳甲 === '辰').动静, '日破');
  const boardLines = mcpCore.toLiuyaoJson(result, { detailLevel: 'full' }).六爻全盘.爻列表;
  assert.equal(boardLines.find((line) => line.本爻.纳甲 === '申').动静, '月破');
  const text = mcpCore.toLiuyaoText(result, { detailLevel: 'full' });
  assert.match(text, /\| 父母 申金 \| 囚 \| 月破 \|/u);
  assert.match(text, /\| 官鬼 辰土 \| 死 \| 日破 \|/u);
});
