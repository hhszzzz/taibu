import { withRulesJSON } from '../../shared/calculation-rules.js';
import type {
  MeihuaCanonicalJSON
} from './json-types.js';
import {
  traditionalYaoName
} from '../liuyao/calculate.js';
import {
  normalizeDetailLevelBinary
} from '../../shared/render-utils.js';
import type {
  MeihuaHexagramInfo,
  MeihuaInteractionReading,
  MeihuaOutput
} from './types.js';
import { buildChangedStageTarget, buildRelationExpression } from './text.js';
import type {
  MeihuaCanonicalTextOptions
} from '../shared/text-options.js';

function buildHexagramTrack(
  hexagram: MeihuaHexagramInfo,
  options: { detailLevel: 'default' | 'full'; includeGuaCi: boolean; },
) {
  return {
    卦名: hexagram.name,
    上卦: hexagram.upperTrigram.name,
    下卦: hexagram.lowerTrigram.name,
    上卦五行: hexagram.upperTrigram.element,
    下卦五行: hexagram.lowerTrigram.element,
    整卦五行: hexagram.element,
    ...(options.includeGuaCi && hexagram.guaCi ? { 卦辞: hexagram.guaCi } : {}),
    ...(options.detailLevel === 'full' && hexagram.xiangCi ? { 象辞: hexagram.xiangCi } : {}),
  };
}

function findInteractionReading(result: MeihuaOutput, stage: MeihuaInteractionReading['stage']) {
  return result.interactionReadings.find((item) => item.stage === stage);
}

export const renderMeihuaCanonicalJSON = withRulesJSON(renderMeihuaCanonicalJSONBase);
function renderMeihuaCanonicalJSONBase(
  result: MeihuaOutput,
  options: MeihuaCanonicalTextOptions = {},
): MeihuaCanonicalJSON {
  const detailLevel = normalizeDetailLevelBinary(options.detailLevel);
  const showMethodFamily = detailLevel === 'full' || result.castMeta.methodFamily === 'extended';
  const showResolvedMode = !!(result.castMeta.resolvedMode && (
    result.castMeta.methodFamily === 'extended'
    || result.castMeta.resolvedMode !== result.castMeta.method
  ));
  const bodyPosition = result.movingLine <= 3 ? '上卦' : '下卦';
  const usePosition = result.movingLine <= 3 ? '下卦' : '上卦';
  const inputSnapshot = result.castMeta.inputSnapshot;
  const useStage = findInteractionReading(result, 'use');
  const bodyMutualStage = findInteractionReading(result, 'body_mutual');
  const useMutualStage = findInteractionReading(result, 'use_mutual');
  const changedStage = findInteractionReading(result, 'changed');
  const sentenceStrategyLabel = inputSnapshot?.multiSentenceStrategy === 'first'
    ? '首句'
    : inputSnapshot?.multiSentenceStrategy === 'last'
      ? '末句'
      : undefined;
  const rawInput: MeihuaCanonicalJSON['起卦信息']['原始输入'] = inputSnapshot
    ? {
      日期: inputSnapshot.date,
      ...(typeof inputSnapshot.count === 'number' ? { 数量: inputSnapshot.count } : {}),
      ...(inputSnapshot.countCategory ? { 数量类别: inputSnapshot.countCategory } : {}),
      ...(inputSnapshot.text ? { 文本: inputSnapshot.text } : {}),
      ...(inputSnapshot.sentences?.length ? { 分句: [...inputSnapshot.sentences] } : {}),
      ...(inputSnapshot.selectedText ? { 取用文本: inputSnapshot.selectedText } : {}),
      ...(sentenceStrategyLabel ? { 取句方式: sentenceStrategyLabel } : {}),
      ...(typeof inputSnapshot.leftStrokeCount === 'number' ? { 左半笔画: inputSnapshot.leftStrokeCount } : {}),
      ...(typeof inputSnapshot.rightStrokeCount === 'number' ? { 右半笔画: inputSnapshot.rightStrokeCount } : {}),
      ...(inputSnapshot.measureKind ? { 量法: inputSnapshot.measureKind } : {}),
      ...(typeof inputSnapshot.majorValue === 'number' ? { 大单位: inputSnapshot.majorValue } : {}),
      ...(typeof inputSnapshot.minorValue === 'number' ? { 小单位: inputSnapshot.minorValue } : {}),
      ...(inputSnapshot.upperCue ? { 上卦类象: inputSnapshot.upperCue } : {}),
      ...(inputSnapshot.upperCueCategory ? { 上卦类象类别: inputSnapshot.upperCueCategory } : {}),
      ...(inputSnapshot.lowerCue ? { 下卦类象: inputSnapshot.lowerCue } : {}),
      ...(inputSnapshot.lowerCueCategory ? { 下卦类象类别: inputSnapshot.lowerCueCategory } : {}),
      ...(inputSnapshot.hexagramName ? { 指定卦名: inputSnapshot.hexagramName } : {}),
      ...(inputSnapshot.upperTrigram ? { 指定上卦: inputSnapshot.upperTrigram } : {}),
      ...(inputSnapshot.lowerTrigram ? { 指定下卦: inputSnapshot.lowerTrigram } : {}),
      ...(typeof inputSnapshot.movingLine === 'number' ? { 指定动爻: inputSnapshot.movingLine } : {}),
      ...(inputSnapshot.numbers?.length ? { 数字序列: [...inputSnapshot.numbers] } : {}),
    }
    : undefined;

  return {
    起卦信息: {
      问题: result.question,
      方法: result.castMeta.methodLabel,
      ...(showMethodFamily ? { 方法系: result.castMeta.methodFamily === 'classical' ? '经典' : '扩展' } : {}),
      ...(showResolvedMode ? { 实际子方式: result.castMeta.resolvedMode } : {}),
      ...(result.castMeta.inputSnapshot?.date ? { 起卦时间: result.castMeta.inputSnapshot.date } : {}),
      ...(result.castMeta.inputSnapshot?.text ? { 原始文本: result.castMeta.inputSnapshot.text } : {}),
      ...(result.castMeta.inputSnapshot?.sentences?.length ? { 分句: [...result.castMeta.inputSnapshot.sentences] } : {}),
      ...(result.castMeta.inputSnapshot?.selectedText ? { 取用文本: result.castMeta.inputSnapshot.selectedText } : {}),
      ...(sentenceStrategyLabel ? { 取句方式: sentenceStrategyLabel } : {}),
      ...(rawInput ? { 原始输入: rawInput } : {}),
      ...(result.warnings.length > 0 ? { 警告: [...result.warnings] } : {}),
    },
    卦盘: {
      本卦: buildHexagramTrack(result.mainHexagram, { detailLevel, includeGuaCi: true }),
      动爻: traditionalYaoName(result.movingLine, Number.parseInt(result.mainHexagram.code[result.movingLine - 1] ?? '0', 10)),
      变卦: result.changedHexagram
        ? buildHexagramTrack(result.changedHexagram, { detailLevel, includeGuaCi: true })
        : {
          卦名: '',
          上卦: '',
          下卦: '',
          上卦五行: '',
          下卦五行: '',
          整卦五行: '',
        },
      ...(result.nuclearHexagram ? { 互卦: buildHexagramTrack(result.nuclearHexagram, { detailLevel, includeGuaCi: detailLevel === 'full' }) } : {}),
      体卦: {
        卦名: result.bodyTrigram.name,
        五行: result.bodyTrigram.element,
        所属: bodyPosition,
      },
      用卦: {
        卦名: result.useTrigram.name,
        五行: result.useTrigram.element,
        所属: usePosition,
      },
      ...(detailLevel === 'full' && (result.oppositeHexagram || result.reversedHexagram)
        ? {
          扩展参考: {
            ...(result.oppositeHexagram ? { 错卦: { 卦名: result.oppositeHexagram.name, 卦辞: result.oppositeHexagram.guaCi, 象辞: result.oppositeHexagram.xiangCi } } : {}),
            ...(result.reversedHexagram ? { 综卦: { 卦名: result.reversedHexagram.name, 卦辞: result.reversedHexagram.guaCi, 象辞: result.reversedHexagram.xiangCi } } : {}),
          },
        }
        : {}),
    },
    干支时间: [
      { 柱: '年', 干支: `${result.ganZhiTime.year.gan}${result.ganZhiTime.year.zhi}` },
      { 柱: '月', 干支: `${result.ganZhiTime.month.gan}${result.ganZhiTime.month.zhi}` },
      { 柱: '日', 干支: `${result.ganZhiTime.day.gan}${result.ganZhiTime.day.zhi}` },
      { 柱: '时', 干支: `${result.ganZhiTime.hour.gan}${result.ganZhiTime.hour.zhi}` },
    ],
    体用分析: {
      关系: result.bodyUseRelation.relation,
      关系表达式: buildRelationExpression(result.bodyUseRelation.relation, {
        label: '体卦',
        trigram: result.bodyTrigram,
      }, {
        label: '用卦',
        name: result.useTrigram.name,
        element: result.useTrigram.element,
      }),
      月令环境: {
        月支: result.seasonalState.monthBranch,
        体卦: result.seasonalState.body,
        用卦: result.seasonalState.use,
        ...(detailLevel === 'full' && result.seasonalState.bodyMutual ? { 体互: result.seasonalState.bodyMutual } : {}),
        ...(detailLevel === 'full' && result.seasonalState.useMutual ? { 用互: result.seasonalState.useMutual } : {}),
        ...(detailLevel === 'full' && result.seasonalState.changed ? { 变卦: result.seasonalState.changed } : {}),
      },
    },
    阶段推演: [
      {
        阶段: '初段',
        落点: '本卦',
        关系: useStage?.relation ?? result.bodyUseRelation.relation,
        表达式: buildRelationExpression(useStage?.relation ?? result.bodyUseRelation.relation, {
          label: '体卦',
          trigram: result.bodyTrigram,
        }, {
          label: '用卦',
          name: result.useTrigram.name,
          element: result.useTrigram.element,
        }),
      },
      ...(result.bodyMutualTrigram && result.useMutualTrigram
        ? [{
          阶段: '中段',
          落点: '互卦',
          关系: `${bodyMutualStage?.relation ?? ''} / ${useMutualStage?.relation ?? ''}`.trim(),
          表达式: [
            buildRelationExpression(bodyMutualStage?.relation ?? '比和', {
              label: '体卦',
              trigram: result.bodyTrigram,
            }, {
              label: '体互',
              name: result.bodyMutualTrigram.name,
              element: result.bodyMutualTrigram.element,
            }),
            buildRelationExpression(useMutualStage?.relation ?? '比和', {
              label: '体卦',
              trigram: result.bodyTrigram,
            }, {
              label: '用互',
              name: result.useMutualTrigram.name,
              element: result.useMutualTrigram.element,
            }),
          ].join('；'),
        }]
        : []),
      ...(result.changedHexagram
        ? [{
          阶段: '后段',
          落点: '变卦',
          关系: changedStage?.relation ?? '',
          表达式: buildRelationExpression(changedStage?.relation ?? '比和', {
            label: '体卦',
            trigram: result.bodyTrigram,
          }, buildChangedStageTarget(result, result.changedHexagram)),
        }]
        : []),
    ],
    ...(detailLevel === 'full'
      ? {
        判断参考: {
          结果: result.judgement.outcome,
          总结: result.judgement.summary,
          依据: [...result.judgement.basis],
        },
      }
      : {}),
  };
}

// ===== 塔罗 =====
