import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Lunar } from 'lunar-javascript';

import * as mcpCore from 'taibu-core';
import { buildListToolsPayload, buildToolSuccessPayload, executeTool } from 'taibu-core/mcp';

function toIsoLocal(solar, hour = 12, minute = 0, second = 0) {
  return `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

function runMeihuaUnderTimeZone(timeZone) {
  const script = `
    import { calculateMeihua } from 'taibu-core';
    const result = await calculateMeihua({
      question: 'tz',
      method: 'time',
      date: '2026-04-04T10:30:00',
    });
    console.log(JSON.stringify({
      main: result.mainHexagram.name,
      changed: result.changedHexagram?.name,
      moving: result.movingLine,
      hour: result.ganZhiTime.hour.gan + result.ganZhiTime.hour.zhi,
    }));
  `;

  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: timeZone },
      encoding: 'utf8',
    }).trim(),
  );
}

test('meihua time casting should reproduce 观梅占的成卦形态', async () => {
  const solar = Lunar.fromYmdHms(2024, 12, 17, 16, 0, 0).getSolar();
  const result = await mcpCore.calculateMeihua({
    question: '观梅占测试',
    method: 'time',
    date: toIsoLocal(solar, 16, 0, 0),
  });

  assert.equal(result.mainHexagram.name, '泽火革');
  assert.equal(result.changedHexagram?.name, '泽山咸');
  assert.equal(result.movingLine, 1);
  assert.equal(result.bodyTrigram.name, '兑');
  assert.equal(result.useTrigram.name, '离');
  assert.equal(result.bodyUseRelation.relation, '用克体');
});

test('meihua time casting labels its method in simplified Chinese in JSON and text', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '起卦方式文案',
    method: 'time',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.methodLabel, '年月日时起卦');
  assert.equal(mcpCore.toMeihuaJson(result).起卦信息.方法, '年月日时起卦');
  assert.match(mcpCore.toMeihuaText(result), /- 方法: 年月日时起卦/u);
  assert.doesNotMatch(mcpCore.toMeihuaText(result), /時/u);
});

test('meihua time casting should reproduce 牡丹占的成卦形态', async () => {
  const solar = Lunar.fromYmdHms(2029, 7, 25, 8, 0, 0).getSolar();
  const result = await mcpCore.calculateMeihua({
    question: '牡丹占测试',
    method: 'time',
    date: toIsoLocal(solar, 8, 0, 0),
  });

  assert.equal(result.mainHexagram.name, '泽山咸');
  assert.equal(result.changedHexagram?.name, '雷山小过');
  assert.equal(result.movingLine, 5);
  assert.equal(result.bodyTrigram.name, '艮');
  assert.equal(result.useTrigram.name, '兑');
});

test('meihua text_split count should still follow 少上多下 when caller explicitly requests count mode', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '字占测试',
    method: 'text_split',
    text: '合同能成否',
    textSplitMode: 'count',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedNumbers?.upper, 2);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 3);
  assert.equal(result.castMeta.resolvedNumbers?.hour, 6);
  assert.equal(result.castMeta.resolvedMode, 'count');
  assert.equal(result.movingLine, 5);
  assert.equal(result.mainHexagram.name, '泽火革');
  assert.match(result.warnings.join('\n'), /经典平上去入法/u);
});

test('meihua text_split auto should prefer classical tone casting for 4-10 pure Han characters', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '今日动静如何',
    method: 'text_split',
    text: '今日动静如何',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedMode, 'tone');
  assert.equal(result.castMeta.resolvedNumbers?.upper, 8);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 5);
  assert.equal(result.movingLine, 1);
  assert.equal(result.mainHexagram.name, '地风升');
  assert.equal(result.changedHexagram?.name, '地天泰');
});

test('meihua text_split auto should keep context-resolved tone casting for polyphonic characters', async () => {
  const deShi = await mcpCore.calculateMeihua({
    question: '得失之间',
    method: 'text_split',
    text: '得失之间',
    date: '2026-04-04T10:30:00',
  });
  const changNv = await mcpCore.calculateMeihua({
    question: '长女少男',
    method: 'text_split',
    text: '长女少男',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(deShi.castMeta.resolvedMode, 'tone');
  assert.equal(deShi.castMeta.resolvedNumbers?.upper, 8);
  assert.equal(deShi.castMeta.resolvedNumbers?.lower, 2);
  assert.equal(deShi.warnings.length, 0);

  assert.equal(changNv.castMeta.resolvedMode, 'tone');
  assert.equal(changNv.castMeta.resolvedNumbers?.upper, 3);
  assert.equal(changNv.castMeta.resolvedNumbers?.lower, 3);
  assert.equal(changNv.warnings.length, 0);
});

test('meihua should stay stable across process time zones for the same wall-clock datetime input', () => {
  const utcResult = runMeihuaUnderTimeZone('UTC');
  const shanghaiResult = runMeihuaUnderTimeZone('Asia/Shanghai');

  assert.deepEqual(utcResult, shanghaiResult);
});

test('meihua should reject datetime strings with timezone offsets to avoid misleading wall-clock casts', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: 'offset',
      method: 'time',
      date: '2026-04-04T10:30:00+08:00',
    }),
    /不支持时区偏移/u,
  );
});

test('meihua text_split auto should reject single-character input with a clear guidance message', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '单字占测试',
      method: 'text_split',
      text: '天',
      date: '2026-04-04T10:30:00',
    }),
    /单字占.*stroke.*笔画/u,
  );
});

test('meihua text_split stroke should allow direct stroke counts without redundant text', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '笔画起卦',
    method: 'text_split',
    textSplitMode: 'stroke',
    leftStrokeCount: 3,
    rightStrokeCount: 5,
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedMode, 'stroke');
  assert.equal(result.castMeta.resolvedNumbers?.upper, 3);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 5);
});

test('meihua text_split stroke should reject multi-character text when text is provided', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '笔画起卦',
      method: 'text_split',
      textSplitMode: 'stroke',
      text: '天地',
      leftStrokeCount: 3,
      rightStrokeCount: 5,
      date: '2026-04-04T10:30:00',
    }),
    /stroke 模式.*单个字/u,
  );
});

test('meihua text_split auto should prefer sentence-pair casting when text already contains two clauses', async () => {
  const autoResult = await mcpCore.calculateMeihua({
    question: '句占自动识别',
    method: 'text_split',
    text: '一二三。四五六七八。',
    date: '2026-04-04T10:30:00',
  });
  const explicitResult = await mcpCore.calculateMeihua({
    question: '句占自动识别',
    method: 'text_split',
    text: '一二三。四五六七八。',
    sentences: ['一二三', '四五六七八'],
    date: '2026-04-04T10:30:00',
  });

  assert.equal(autoResult.castMeta.resolvedMode, 'sentence_pair');
  assert.equal(autoResult.castMeta.resolvedNumbers?.upper, 3);
  assert.equal(autoResult.castMeta.resolvedNumbers?.lower, 5);
  assert.equal(autoResult.mainHexagram.name, explicitResult.mainHexagram.name);
});

test('meihua text_split auto should not treat commas as sentence-pair delimiters and may still use classical tone casting', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '逗号不应触发句占',
    method: 'text_split',
    text: '甲,乙丙丁',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedMode, 'tone');
  assert.equal(result.castMeta.resolvedNumbers?.upper, 6);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 3);
});

test('meihua text_split auto should fall back to count mode for mixed-script 4-10 text with an explicit warning', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '混合文本回退',
    method: 'text_split',
    text: '甲乙1丙丁',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedMode, 'count');
  assert.equal(result.castMeta.resolvedNumbers?.upper, 2);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 3);
  assert.match(result.warnings.join('\n'), /回退为字数占/u);
});

test('meihua text_split auto should reject multi-clause intent casting unless the caller explicitly chooses first or last', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '多句来意占',
      method: 'text_split',
      text: '甲乙。丙丁。戊己辛。',
      date: '2026-04-04T10:30:00',
    }),
    /multiSentenceStrategy=first\/last/u,
  );
});

test('meihua text_split auto should follow classical intent-taking when caller explicitly chooses the first clause', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '多句自动回退',
    method: 'text_split',
    text: '甲乙。丙丁。戊己辛。',
    multiSentenceStrategy: 'first',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedMode, 'count');
  assert.equal(result.castMeta.resolvedNumbers?.upper, 1);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 1);
  assert.match(result.warnings.join('\n'), /多于两句.*取首句/u);
  assert.doesNotMatch(result.warnings.join('\n'), /回退到字数占/u);
});

test('meihua text_split auto should allow choosing the last clause when more than two clauses exist', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '多句末句占',
    method: 'text_split',
    text: '甲乙。丙丁。戊己辛。',
    multiSentenceStrategy: 'last',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedMode, 'count');
  assert.equal(result.castMeta.resolvedNumbers?.upper, 1);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 2);
  assert.match(result.warnings.join('\n'), /多于两句.*取末句/u);
});

test('meihua text_split sentence_pair should reject more than two clauses instead of truncating them silently', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '显式句占',
      method: 'text_split',
      textSplitMode: 'sentence_pair',
      text: '甲乙。丙丁戊。己庚辛壬。',
      date: '2026-04-04T10:30:00',
    }),
    /必须且只能提供两句/u,
  );
});

test('meihua text_split sentence_pair should accept sentences-only input without redundant text', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '显式句占',
    method: 'text_split',
    textSplitMode: 'sentence_pair',
    sentences: ['甲乙', '丙丁戊'],
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.resolvedMode, 'sentence_pair');
  assert.equal(result.castMeta.resolvedNumbers?.upper, 2);
  assert.equal(result.castMeta.resolvedNumbers?.lower, 3);
});

test('meihua text_split sentence_pair should reject blank clauses instead of coercing them to zero', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '空白句占',
      method: 'text_split',
      textSplitMode: 'sentence_pair',
      sentences: ['   ', '甲乙'],
      date: '2026-04-04T10:30:00',
    }),
    /两句文本都必须包含可计数字符/u,
  );

  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '空白句占',
      method: 'text_split',
      textSplitMode: 'sentence_pair',
      sentences: ['甲乙', '   '],
      date: '2026-04-04T10:30:00',
    }),
    /两句文本都必须包含可计数字符/u,
  );
});

test('meihua text_split sentence_pair should reject non-string sentence items with a clear error', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '坏句占',
      method: 'text_split',
      textSplitMode: 'sentence_pair',
      sentences: [123, '甲乙'],
      date: '2026-04-04T10:30:00',
    }),
    /sentences\[0\].*字符串/u,
  );
});

test('meihua text_split should reject unknown textSplitMode values instead of silently coercing them', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '坏模式',
      method: 'text_split',
      text: '甲乙丙丁',
      textSplitMode: 'oops',
      date: '2026-04-04T10:30:00',
    }),
    /textSplitMode/u,
  );
});

test('meihua measure should distinguish 丈尺 and 尺寸 moving-line rules', async () => {
  const zhangChi = await mcpCore.calculateMeihua({
    question: '丈尺测试',
    method: 'measure',
    measureKind: '丈尺',
    majorValue: 2,
    minorValue: 3,
    date: '2026-04-04T00:30:00',
  });
  const chiCun = await mcpCore.calculateMeihua({
    question: '尺寸测试',
    method: 'measure',
    measureKind: '尺寸',
    majorValue: 2,
    minorValue: 3,
    date: '2026-04-04T00:30:00',
  });

  assert.equal(zhangChi.movingLine, 5);
  assert.equal(chiCun.movingLine, 6);
  assert.equal(zhangChi.castMeta.resolvedNumbers?.hour, undefined);
  assert.equal(chiCun.castMeta.resolvedNumbers?.hour, 1);
});

test('meihua measure should reject legacy measureKind aliases instead of silently accepting them', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: 'legacy-measure',
      method: 'measure',
      measureKind: 'zhang_chi',
      majorValue: 2,
      minorValue: 3,
      date: '2026-04-04T10:30:00',
    }),
    /measureKind/u,
  );
});

test('meihua measure should reject unknown measureKind values instead of silently coercing them', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: 'measure',
      method: 'measure',
      measureKind: 'oops',
      majorValue: 2,
      minorValue: 3,
      date: '2026-04-04T10:30:00',
    }),
    /measureKind/u,
  );
});

test('meihua measure should reject omitted measureKind instead of defaulting to 尺寸', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: 'measure',
      method: 'measure',
      majorValue: 2,
      minorValue: 3,
      date: '2026-04-04T00:30:00',
    }),
    /measureKind/u,
  );
});

test('meihua classifier_pair should resolve textual cues into trigrams and moving line', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '方位类象测试',
    method: 'classifier_pair',
    upperCue: '老人',
    lowerCue: '南',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.mainHexagram.upperTrigram.name, '乾');
  assert.equal(result.mainHexagram.lowerTrigram.name, '离');
  assert.equal(result.movingLine, 4);
});

test('meihua classifier_pair should reject legacy classifier aliases instead of silently accepting them', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: 'legacy-classifier',
      method: 'classifier_pair',
      upperClassifier: '老人',
      lowerClassifier: '南',
      date: '2026-04-04T10:30:00',
    }),
    /upperCue.*lowerCue/u,
  );
});

test('meihua classifier_pair should support color cues when category is provided', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '颜色类象测试',
    method: 'classifier_pair',
    upperCue: '红',
    upperCueCategory: 'color',
    lowerCue: '白',
    lowerCueCategory: 'color',
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.mainHexagram.upperTrigram.name, '离');
  assert.equal(result.mainHexagram.lowerTrigram.name, '兑');
});

test('meihua classifier_pair should cover standard classical classifiers from 八卦万物属类', async () => {
  const cases = [
    ['官贵', '乾'],
    ['老妇', '坤'],
    ['雉', '离'],
    ['黍稷', '坤'],
    ['巫', '兑'],
    ['水果', '乾'],
    ['镜', '乾'],
    ['竹', '震'],
    ['百草', '巽'],
    ['盗', '坎'],
    ['布帛', '坤'],
    ['鼠', '艮'],
    ['奴仆', '兑'],
    ['花纹人', '离'],
    ['蒺藜', '坎'],
  ];

  for (const [cue, trigram] of cases) {
    const result = await mcpCore.calculateMeihua({
      question: `${cue}类象测试`,
      method: 'classifier_pair',
      upperCue: cue,
      lowerCue: '南',
      date: '2026-04-04T10:30:00',
    });
    assert.equal(result.mainHexagram.upperTrigram.name, trigram);
  }
});

test('meihua count_with_time should distinguish item and sound rules', async () => {
  const itemResult = await mcpCore.calculateMeihua({
    question: '物数测试',
    method: 'count_with_time',
    count: 7,
    countCategory: 'item',
    date: '2026-04-04T05:00:00',
  });
  const soundResult = await mcpCore.calculateMeihua({
    question: '声音测试',
    method: 'count_with_time',
    count: 7,
    countCategory: 'sound',
    date: '2026-04-04T05:00:00',
  });

  assert.equal(itemResult.mainHexagram.upperTrigram.name, '艮');
  assert.equal(itemResult.mainHexagram.lowerTrigram.name, '震');
  assert.equal(itemResult.castMeta.resolvedNumbers?.lower, 4);
  assert.equal(itemResult.movingLine, 5);

  assert.equal(soundResult.mainHexagram.upperTrigram.name, '艮');
  assert.equal(soundResult.mainHexagram.lowerTrigram.name, '离');
  assert.equal(soundResult.castMeta.resolvedNumbers?.lower, 3);
  assert.equal(soundResult.movingLine, 5);
  assert.deepEqual(itemResult.castMeta.inputSummary, ['物数=7', '时辰数=4']);
  assert.deepEqual(soundResult.castMeta.inputSummary, ['声音数=7', '时辰数=4']);
});

test('meihua count_with_time should reject unknown countCategory values instead of silently coercing them', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '坏类别',
      method: 'count_with_time',
      count: 7,
      countCategory: 'oops',
      date: '2026-04-04T10:30:00',
    }),
    /countCategory/u,
  );
});

test('meihua count_with_time should reject omitted countCategory instead of silently defaulting to item', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '缺类别',
      method: 'count_with_time',
      count: 7,
      date: '2026-04-04T10:30:00',
    }),
    /countCategory/u,
  );
});

test('meihua should reject non-string date input with a clear error', async () => {
  assert.throws(
    () => mcpCore.calculateMeihua({
      question: '坏时间',
      method: 'time',
      date: 123,
    }),
    /date.*字符串/u,
  );
});

test('meihua should apply 乾坤无互 and derive nuclear hexagram from the changed hexagram', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '乾坤无互测试',
    method: 'select',
    hexagramName: '乾为天',
    movingLine: 2,
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.mainHexagram.name, '乾为天');
  assert.equal(result.changedHexagram?.name, '天火同人');
  assert.equal(result.nuclearHexagram?.name, '天风姤');
  assert.equal(result.bodyMutualTrigram?.name, '乾');
  assert.equal(result.useMutualTrigram?.name, '巽');
});

test('meihua judgement should surface 先凶后吉 with 用党多 basis when the changed phase turns favorable', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '先凶后吉测试',
    method: 'select',
    hexagramName: '000010',
    movingLine: 1,
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.judgement.outcome, '吉');
  assert.equal(result.judgement.summary, '先凶后吉，初段多阻，后势转开。');
  assert.match(result.judgement.basis.join('\n'), /用党多则体势衰/u);
  assert.match(result.judgement.basis.join('\n'), /用卦凶而变卦吉/u);
});

test('meihua judgement should surface 先吉后凶 with 体党多 basis when the changed phase turns unfavorable', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '先吉后凶测试',
    method: 'select',
    hexagramName: '000010',
    movingLine: 4,
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.judgement.outcome, '凶');
  assert.equal(result.judgement.summary, '先吉后凶，初看有利，后势转阻。');
  assert.match(result.judgement.basis.join('\n'), /体党多而体势盛/u);
  assert.match(result.judgement.basis.join('\n'), /用卦吉而变卦凶/u);
});

test('meihua number_pair should remain available as extended modern casting and surface warning', async () => {
  const result = await mcpCore.calculateMeihua({
    question: '报数测试',
    method: 'number_pair',
    numbers: [3, 8],
    date: '2026-04-04T10:30:00',
  });

  assert.equal(result.castMeta.methodFamily, 'extended');
  assert.match(result.warnings[0], /扩展法/u);
  assert.equal(result.mainHexagram.upperTrigram.name, '离');
  assert.equal(result.mainHexagram.lowerTrigram.name, '坤');
  assert.equal(result.movingLine, 5);
});

test('meihua tool output should stay on meihua semantics instead of liuyao vocabulary', async () => {
  const rawResult = await executeTool('meihua', {
    question: '输出契约测试',
    method: 'number_pair',
    numbers: [3, 8],
    date: '2026-04-04T10:30:00',
  });
  const payload = buildToolSuccessPayload('meihua', rawResult);

  assert.equal(payload.structuredContent.卦盘.体卦.卦名, '坤');
  assert.equal(payload.structuredContent.卦盘.用卦.卦名, '离');
  assert.equal(payload.structuredContent.起卦信息.实际子方式, 'number_pair');
  assert.equal(payload.structuredContent.起卦信息.方法, '两数报数法');
  assert.equal(payload.structuredContent.卦盘.扩展参考, undefined);
  assert.equal(payload.structuredContent.判断参考, undefined);
  assert.equal(payload.structuredContent.克应分析, undefined);
  assert.equal(payload.structuredContent.六爻, undefined);
  assert.equal(payload.structuredContent.用神分析, undefined);
  assert.match(payload.content[0].text, /# 梅花易数主证据/u);
  assert.match(payload.content[0].text, /## 阶段推演/u);
  assert.doesNotMatch(payload.content[0].text, /## 判断参考|结果:|总结:/u);
  assert.doesNotMatch(payload.content[0].text, /错卦|综卦/u);
  assert.doesNotMatch(payload.content[0].text, /六亲|六神|伏神|世应/u);
});

test('meihua default classical output should keep text/json visibility aligned for method family metadata', () => {
  const result = mcpCore.calculateMeihua({
    question: '默认 classical 对齐',
    method: 'time',
    date: '2026-04-04T10:30:00',
  });

  const json = mcpCore.toMeihuaJson(result);
  const text = mcpCore.toMeihuaText(result);

  assert.equal(json.起卦信息.方法系, undefined);
  assert.equal(json.起卦信息.实际子方式, undefined);
  assert.doesNotMatch(text, /方法系/u);
  assert.doesNotMatch(text, /实际子方式/u);
});

test('meihua canonical json should resolve stage expressions by stage name instead of array order', () => {
  const result = mcpCore.calculateMeihua({
    question: '阶段顺序审查',
    method: 'time',
    date: '2026-04-04T10:30:00',
  });

  const shuffled = {
    ...result,
    interactionReadings: [...result.interactionReadings].reverse(),
  };

  const json = mcpCore.toMeihuaJson(shuffled);

  assert.equal(json.阶段推演[0]?.阶段, '初段');
  assert.match(json.阶段推演[0]?.表达式 ?? '', /用卦\(坤土\) 生 体卦\(兑金\)/u);
  assert.equal(json.阶段推演[1]?.阶段, '中段');
  assert.match(json.阶段推演[1]?.表达式 ?? '', /体互\(巽木\)/u);
  assert.match(json.阶段推演[1]?.表达式 ?? '', /用互\(艮土\)/u);
  assert.equal(json.阶段推演[2]?.阶段, '后段');
  assert.match(json.阶段推演[2]?.表达式 ?? '', /变卦整卦\(泽水困\/金\)/u);
});

test('meihua full detail should expose extended references and judgement reference', async () => {
  const rawResult = await executeTool('meihua', {
    question: 'full 输出测试',
    method: 'time',
    date: '2026-04-04T10:30:00',
  });
  const payload = buildToolSuccessPayload('meihua', rawResult, { detailLevel: 'full' });

  assert.ok(payload.structuredContent.卦盘.扩展参考, 'full structured content should include extended reference');
  assert.ok(payload.structuredContent.判断参考, 'full structured content should include judgement reference');
  assert.match(payload.content[0].text, /## 扩展参考/u);
  assert.match(payload.content[0].text, /## 判断参考/u);
});

test('meihua canonical output should preserve date and selected text for multi-clause intent casting', async () => {
  const rawResult = await executeTool('meihua', {
    question: '审计',
    method: 'text_split',
    text: '甲乙。丙丁。戊己辛。',
    multiSentenceStrategy: 'last',
    date: '2026-04-04T10:30:00',
  });
  const markdownPayload = buildToolSuccessPayload('meihua', rawResult);
  const jsonPayload = buildToolSuccessPayload('meihua', rawResult);

  assert.equal(jsonPayload.structuredContent.起卦信息.起卦时间, '2026-04-04T10:30:00');
  assert.equal(jsonPayload.structuredContent.起卦信息.原始文本, '甲乙。丙丁。戊己辛。');
  assert.deepEqual(jsonPayload.structuredContent.起卦信息.分句, ['甲乙', '丙丁', '戊己辛']);
  assert.equal(jsonPayload.structuredContent.起卦信息.取用文本, '戊己辛');
  assert.equal(jsonPayload.structuredContent.起卦信息.取句方式, '末句');
  assert.equal(jsonPayload.structuredContent.起卦信息.原始输入.日期, '2026-04-04T10:30:00');
  assert.equal(jsonPayload.structuredContent.起卦信息.原始输入.文本, '甲乙。丙丁。戊己辛。');
  assert.deepEqual(jsonPayload.structuredContent.起卦信息.原始输入.分句, ['甲乙', '丙丁', '戊己辛']);
  assert.equal(jsonPayload.structuredContent.起卦信息.原始输入.取用文本, '戊己辛');
  assert.equal(jsonPayload.structuredContent.起卦信息.原始输入.取句方式, '末句');
  assert.match(markdownPayload.content[0].text, /时间: 2026-04-04 10:30:00/u);
  assert.match(markdownPayload.content[0].text, /原始文本: 甲乙。丙丁。戊己辛。/u);
  assert.match(markdownPayload.content[0].text, /取用文本: 戊己辛/u);
  assert.match(markdownPayload.content[0].text, /取句方式: 末句/u);
});

test('meihua canonical output should preserve structured raw inputs for non-text casting methods', async () => {
  const classifierRaw = await executeTool('meihua', {
    question: 'cue',
    method: 'classifier_pair',
    upperCue: '老人',
    upperCueCategory: 'person',
    lowerCue: '南',
    lowerCueCategory: 'direction',
    date: '2026-04-04T10:30:00',
  });
  const countRaw = await executeTool('meihua', {
    question: 'count',
    method: 'count_with_time',
    count: 7,
    countCategory: 'sound',
    date: '2026-04-04T05:00:00',
  });
  const measureRaw = await executeTool('meihua', {
    question: 'measure',
    method: 'measure',
    measureKind: '丈尺',
    majorValue: 2,
    minorValue: 3,
    date: '2026-04-04T10:30:00',
  });

  const classifierPayload = buildToolSuccessPayload('meihua', classifierRaw);
  const countPayload = buildToolSuccessPayload('meihua', countRaw);
  const measurePayload = buildToolSuccessPayload('meihua', measureRaw);

  assert.equal(classifierPayload.structuredContent.起卦信息.原始输入.上卦类象, '老人');
  assert.equal(classifierPayload.structuredContent.起卦信息.原始输入.上卦类象类别, 'person');
  assert.equal(classifierPayload.structuredContent.起卦信息.原始输入.下卦类象, '南');
  assert.equal(classifierPayload.structuredContent.起卦信息.原始输入.下卦类象类别, 'direction');

  assert.equal(countPayload.structuredContent.起卦信息.原始输入.数量, 7);
  assert.equal(countPayload.structuredContent.起卦信息.原始输入.数量类别, 'sound');

  assert.equal(measurePayload.structuredContent.起卦信息.原始输入.量法, '丈尺');
  assert.equal(measurePayload.structuredContent.起卦信息.原始输入.大单位, 2);
  assert.equal(measurePayload.structuredContent.起卦信息.原始输入.小单位, 3);
});

test('meihua canonical output should preserve stroke split counts in structured raw input', async () => {
  const rawResult = await executeTool('meihua', {
    question: 'stroke',
    method: 'text_split',
    textSplitMode: 'stroke',
    text: '天',
    leftStrokeCount: 4,
    rightStrokeCount: 2,
    date: '2026-04-04T10:30:00',
  });
  const payload = buildToolSuccessPayload('meihua', rawResult);

  assert.equal(payload.structuredContent.起卦信息.原始输入.文本, '天');
  assert.equal(payload.structuredContent.起卦信息.原始输入.左半笔画, 4);
  assert.equal(payload.structuredContent.起卦信息.原始输入.右半笔画, 2);
});

test('meihua tool schema should expose method-specific requirements and multi-sentence strategy', () => {
  const payload = buildListToolsPayload();
  const meihua = payload.tools.find((tool) => tool.name === 'meihua');

  assert.ok(meihua);
  assert.deepEqual(meihua.inputSchema.properties.multiSentenceStrategy.enum, ['first', 'last']);
  assert.deepEqual(meihua.inputSchema.properties.measureKind.enum, ['丈尺', '尺寸']);
  assert.equal(
    meihua.inputSchema.properties.multiSentenceStrategy.description,
    '多句文本的取句方式（first=首句，last=末句）',
  );
  assert.ok(Array.isArray(meihua.inputSchema.allOf));

  const serializedRules = JSON.stringify(meihua.inputSchema.allOf);
  assert.match(serializedRules, /measureKind/u);
  assert.match(serializedRules, /leftStrokeCount/u);
  assert.match(serializedRules, /upperCue/u);
  assert.match(serializedRules, /hexagramName/u);
  assert.doesNotMatch(JSON.stringify(meihua.inputSchema.properties), /zhang_chi|chi_cun|upperClassifier|lowerClassifier/u);
});
