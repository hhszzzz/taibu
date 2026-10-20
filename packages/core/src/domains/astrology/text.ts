import type { AstrologyCanonicalTextOptions } from '../shared/text-options.js';
import type { AstrologyAspect, AstrologyFactor, AstrologyOutput } from './types.js';
import { buildAstrologyRenderModel } from './render-model.js';

function formatFactorSummary(item: AstrologyFactor, isApproximate: boolean): string {
  const parts = [
    item.sign.label,
    item.position.withinSign,
    !isApproximate && typeof item.house === 'number' ? `第${item.house}宫` : null,
    item.retrograde ? '逆行' : null,
  ].filter(Boolean);
  return parts.join(' / ');
}

function formatCompactAspect(item: AstrologyAspect, currentFactorKey: string): string {
  const target = item.from.key === currentFactorKey ? item.to.label : item.from.label;
  return `${item.label} ${target}(${item.orb.toFixed(2)}°)`;
}

function aspectLine(item: AstrologyAspect): string {
  return `- ${item.from.label} ${item.label} ${item.to.label}（容许度 ${item.orb.toFixed(2)}° / 实际夹角 ${item.actualAngle.toFixed(2)}°）`;
}

export function renderAstrologyCanonicalText(
  result: AstrologyOutput,
  options: AstrologyCanonicalTextOptions = {},
): string {
  const model = buildAstrologyRenderModel(result, options);
  const { detailLevel, isApproximate } = model;

  const lines: string[] = [
    '# 西方占星主证据',
    '',
    '## 基础坐标',
    `- 计算模式: ${model.basicInfo.calculationModeLabel}`,
    ...(model.basicInfo.calculationNote ? [`- 说明: ${model.basicInfo.calculationNote}`] : []),
    ...(model.basicInfo.birthPlace ? [`- 出生地: ${model.basicInfo.birthPlace}`] : []),
    `- 坐标: ${model.basicInfo.coordinatesLabel}`,
    `- 本命时区: ${model.basicInfo.natalTimeZoneLabel}`,
    `- 本命时刻: ${model.basicInfo.natalDateTime}`,
    `- 流运时刻: ${model.basicInfo.transitDateTime}`,
    `- 黄道体系: ${model.basicInfo.zodiacLabel}`,
    `- 宫制: ${model.basicInfo.houseSystemLabel}`,
    '',
    '## 命盘锚点',
    `- 太阳: ${formatFactorSummary(model.anchors.sun, isApproximate)}`,
    `- 月亮: ${formatFactorSummary(model.anchors.moon, isApproximate)}`,
    `- 上升: ${model.anchors.ascendant ? formatFactorSummary(model.anchors.ascendant, isApproximate) : '未计算（需经纬度）'}`,
    `- 天顶: ${model.anchors.midheaven ? formatFactorSummary(model.anchors.midheaven, isApproximate) : '未计算（需经纬度）'}`,
    '',
    '## 本命主星',
    ...model.natalBodies.map((entry) => `- ${entry.factor.label}: ${formatFactorSummary(entry.factor, isApproximate)} | 关键相位: ${
      entry.aspects.length > 0
        ? entry.aspects.map((aspect) => formatCompactAspect(aspect, entry.factor.key)).join(', ')
        : '无紧密主要相位'
    }`),
    '',
    '## 当前流运触发',
    ...(model.transitTriggers.length > 0
      ? model.transitTriggers.map((entry) => `- ${entry.factor.label}: ${formatFactorSummary(entry.factor, isApproximate)} | 触发: ${entry.aspects.map((aspect) => formatCompactAspect(aspect, entry.factor.key)).join(', ')}`)
      : ['- 无主要慢行星紧密触发']),
  ];

  if (detailLevel === 'more' || detailLevel === 'full') {
    lines.push('');
    lines.push('## 附加点与交点');
    for (const pair of model.pointPairs) {
      const pieces = [`- ${pair.label}: 本命 ${formatFactorSummary(pair.natal, isApproximate)}`];
      if (pair.transit) {
        pieces.push(`流运 ${formatFactorSummary(pair.transit, isApproximate)}`);
      }
      lines.push(pieces.join('；'));
    }
    if (model.houses.length > 0) {
      lines.push('');
      lines.push('## 宫位宫头');
      for (const house of model.houses) {
        lines.push(`- ${house.label}: ${house.sign.label} / ${house.start.withinSign}`);
      }
    }
  }

  if (detailLevel === 'full') {
    lines.push('');
    lines.push('## 完整相位矩阵');
    lines.push('');
    lines.push('### 本命完整相位');
    lines.push(...(model.fullNatalAspects.length > 0 ? model.fullNatalAspects.map(aspectLine) : ['- 无']));
    lines.push('');
    lines.push('### 流运完整相位');
    lines.push(...(model.fullTransitAspects.length > 0 ? model.fullTransitAspects.map(aspectLine) : ['- 无']));
    lines.push('');
    lines.push('## 黄道分界');
    for (const cusp of model.zodiacCusps) {
      lines.push(`- ${cusp.sign.label}: ${cusp.start.absolute} / ${cusp.start.withinSign}`);
    }
  }

  return lines.join('\n');
}
