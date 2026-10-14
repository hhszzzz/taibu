import { withRulesText } from '../../shared/calculation-rules.js';
import {
  traditionalYaoName
} from '../liuyao/calculate.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  MeihuaHexagramInfo,
  MeihuaInteractionReading,
  MeihuaTrigramInfo,
  MeihuaOutput
} from './types.js';
import type {
  MeihuaCanonicalTextOptions
} from '../shared/text-options.js';

function formatWallClockLabel(value: string): string {
  return value.replace('T', ' ');
}

function formatGanZhiLabel(result: MeihuaOutput): string {
  return `${result.ganZhiTime.year.gan}${result.ganZhiTime.year.zhi}年 ${result.ganZhiTime.month.gan}${result.ganZhiTime.month.zhi}月 ${result.ganZhiTime.day.gan}${result.ganZhiTime.day.zhi}日 ${result.ganZhiTime.hour.gan}${result.ganZhiTime.hour.zhi}时`;
}

function formatTrigramRole(label: string, trigram: MeihuaTrigramInfo): string {
  return `${label}(${trigram.name}${trigram.element})`;
}

function formatHexagramLine(
  label: string,
  hexagram: MeihuaHexagramInfo,
  options: { movingLineLabel?: string; note?: string; },
): string {
  const extras = [options.note, options.movingLineLabel].filter((item): item is string => Boolean(item));
  const suffix = extras.length > 0 ? `，${extras.join('，')}` : '';
  return `- ${label}: ${hexagram.name}（上${hexagram.upperTrigram.name}${hexagram.upperTrigram.element} / 下${hexagram.lowerTrigram.name}${hexagram.lowerTrigram.element}${suffix}）`;
}

type RelationTarget = { label: string; name?: string; element: string; separator?: string; };

export function buildRelationExpression(
  relation: MeihuaInteractionReading['relation'],
  body: { label: string; trigram: MeihuaTrigramInfo; },
  other: RelationTarget,
): string {
  const bodyRef = formatTrigramRole(body.label, body.trigram);
  const otherRef = other.name
    ? `${other.label}(${other.name}${other.separator ?? ''}${other.element})`
    : `${other.label}(${other.element})`;

  switch (relation) {
    case '比和':
      return `${bodyRef} 与 ${otherRef} 比和`;
    case '用生体':
      return `${otherRef} 生 ${bodyRef}`;
    case '体生用':
      return `${bodyRef} 生 ${otherRef}`;
    case '体克用':
      return `${bodyRef} 克 ${otherRef}`;
    case '用克体':
      return `${otherRef} 克 ${bodyRef}`;
    default:
      return `${bodyRef} 与 ${otherRef}`;
  }
}

/** 后段变卦一端：取用卦变出的经卦；旧版结果没有 changedTrigram，按当时「变卦整卦」的口径原样复现。 */
export function buildChangedStageTarget(result: MeihuaOutput, changedHexagram: MeihuaHexagramInfo): RelationTarget {
  return result.changedTrigram
    ? { label: '变卦', name: result.changedTrigram.name, element: result.changedTrigram.element }
    : { label: '变卦整卦', name: changedHexagram.name, element: changedHexagram.element, separator: '/' };
}

function buildStageExpressions(result: MeihuaOutput): string[] {
  const body = { label: '体卦', trigram: result.bodyTrigram };
  const useStage = result.interactionReadings.find((item) => item.stage === 'use');
  const bodyMutualStage = result.interactionReadings.find((item) => item.stage === 'body_mutual');
  const useMutualStage = result.interactionReadings.find((item) => item.stage === 'use_mutual');
  const changedStage = result.interactionReadings.find((item) => item.stage === 'changed');
  const lines: string[] = [];

  if (useStage) {
    lines.push(`- 初段 / 本卦: ${buildRelationExpression(useStage.relation, body, {
      label: '用卦',
      name: result.useTrigram.name,
      element: result.useTrigram.element,
    })}`);
  }

  if (bodyMutualStage && result.bodyMutualTrigram && useMutualStage && result.useMutualTrigram) {
    const bodyMutualExpr = buildRelationExpression(bodyMutualStage.relation, body, {
      label: '体互',
      name: result.bodyMutualTrigram.name,
      element: result.bodyMutualTrigram.element,
    });
    const useMutualExpr = buildRelationExpression(useMutualStage.relation, body, {
      label: '用互',
      name: result.useMutualTrigram.name,
      element: result.useMutualTrigram.element,
    });
    lines.push(`- 中段 / 互卦: ${bodyMutualExpr}；${useMutualExpr}`);
  }

  if (changedStage && result.changedHexagram) {
    lines.push(`- 后段 / 变卦: ${buildRelationExpression(changedStage.relation, body, buildChangedStageTarget(result, result.changedHexagram))}`);
  }

  return lines;
}

export const renderMeihuaCanonicalText = withRulesText(renderMeihuaCanonicalTextBase);
function renderMeihuaCanonicalTextBase(result: MeihuaOutput, options: MeihuaCanonicalTextOptions = {}): string {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const lines: string[] = ['# 梅花易数主证据', '', '## 起卦与环境'];
  const showResolvedMode = !!(result.castMeta.resolvedMode && (
    result.castMeta.methodFamily === 'extended'
    || result.castMeta.resolvedMode !== result.castMeta.method
  ));
  const movingLineLabel = traditionalYaoName(result.movingLine, Number.parseInt(result.mainHexagram.code[result.movingLine - 1] ?? '0', 10));

  lines.push(`- 问题: ${result.question}`);
  if (result.castMeta.inputSnapshot?.date) {
    lines.push(`- 时间: ${formatWallClockLabel(result.castMeta.inputSnapshot.date)}（${formatGanZhiLabel(result)}）`);
  } else {
    lines.push(`- 干支: ${formatGanZhiLabel(result)}`);
  }
  lines.push(`- 方法: ${result.castMeta.methodLabel}`);
  if (detailLevel === 'full' || result.castMeta.methodFamily === 'extended') {
    lines.push(`- 方法系: ${result.castMeta.methodFamily === 'classical' ? '经典' : '扩展'}`);
  }
  if (showResolvedMode) {
    lines.push(`- 实际子方式: ${result.castMeta.resolvedMode}`);
  }
  if (result.castMeta.inputSnapshot?.text) lines.push(`- 原始文本: ${result.castMeta.inputSnapshot.text}`);
  if (result.castMeta.inputSnapshot?.sentences?.length) lines.push(`- 分句: ${result.castMeta.inputSnapshot.sentences.join(' / ')}`);
  if (result.castMeta.inputSnapshot?.selectedText) lines.push(`- 取用文本: ${result.castMeta.inputSnapshot.selectedText}`);
  if (result.castMeta.inputSnapshot?.multiSentenceStrategy) lines.push(`- 取句方式: ${result.castMeta.inputSnapshot.multiSentenceStrategy === 'first' ? '首句' : '末句'}`);
  lines.push(`- 月令环境: 体卦${result.seasonalState.body} / 用卦${result.seasonalState.use}`);
  for (const warning of result.warnings) {
    lines.push(`- 提示: ${warning}`);
  }

  lines.push('');
  lines.push('## 卦象演变');
  lines.push(formatHexagramLine('本卦', result.mainHexagram, {}));
  if (result.mainHexagram.guaCi) lines.push(`- 本卦卦辞: ${result.mainHexagram.guaCi}`);
  if (detailLevel === 'full' && result.mainHexagram.xiangCi) lines.push(`- 本卦象辞: ${result.mainHexagram.xiangCi}`);
  if (result.nuclearHexagram) {
    lines.push(formatHexagramLine('互卦', result.nuclearHexagram, {}));
    if (detailLevel === 'full' && result.nuclearHexagram.guaCi) lines.push(`- 互卦卦辞: ${result.nuclearHexagram.guaCi}`);
    if (detailLevel === 'full' && result.nuclearHexagram.xiangCi) lines.push(`- 互卦象辞: ${result.nuclearHexagram.xiangCi}`);
  }
  if (result.changedHexagram) {
    lines.push(formatHexagramLine('变卦', result.changedHexagram, {
      movingLineLabel,
      note: result.changedTrigram
        ? `用卦${result.useTrigram.name}变${result.changedTrigram.name}${result.changedTrigram.element}`
        : `整卦五行=${result.changedHexagram.element}`,
    }));
    if (result.changedHexagram.guaCi) lines.push(`- 变卦卦辞: ${result.changedHexagram.guaCi}`);
    if (detailLevel === 'full' && result.changedHexagram.xiangCi) lines.push(`- 变卦象辞: ${result.changedHexagram.xiangCi}`);
  }

  lines.push('');
  lines.push('## 体用主轴');
  lines.push(`- 体卦: ${result.bodyTrigram.name}${result.bodyTrigram.element}`);
  lines.push(`- 用卦: ${result.useTrigram.name}${result.useTrigram.element}`);
  lines.push(`- 当前关系: ${buildRelationExpression(result.bodyUseRelation.relation, {
    label: '体卦',
    trigram: result.bodyTrigram,
  }, {
    label: '用卦',
    name: result.useTrigram.name,
    element: result.useTrigram.element,
  })}`);
  if (detailLevel === 'full') {
    if (result.seasonalState.bodyMutual) lines.push(`- 体互月令: ${result.seasonalState.bodyMutual}`);
    if (result.seasonalState.useMutual) lines.push(`- 用互月令: ${result.seasonalState.useMutual}`);
    if (result.seasonalState.changed) lines.push(`- 变卦月令: ${result.seasonalState.changed}`);
  }

  lines.push('');
  lines.push('## 阶段推演');
  lines.push(...buildStageExpressions(result));

  if (detailLevel === 'full' && (result.oppositeHexagram || result.reversedHexagram)) {
    lines.push('');
    lines.push('## 扩展参考');
    if (result.oppositeHexagram) lines.push(`- 错卦: ${result.oppositeHexagram.name}`);
    if (result.reversedHexagram) lines.push(`- 综卦: ${result.reversedHexagram.name}`);
  }

  if (detailLevel === 'full') {
    lines.push('');
    lines.push('## 判断参考');
    lines.push(`- 结果: ${result.judgement.outcome}`);
    lines.push(`- 总结: ${result.judgement.summary}`);
    for (const basis of result.judgement.basis) {
      lines.push(`- 依据: ${basis}`);
    }
  }

  return lines.join('\n').trimEnd();
}
