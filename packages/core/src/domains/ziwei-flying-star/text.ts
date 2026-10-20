import {
  mapZiweiFlyingStarQueryType
} from '../../shared/render-utils.js';
import type {
  FlyingStarResult,
  ZiweiFlyingStarOutput
} from './types.js';
import type {
  MutagedPlaceInfo,
  SurroundedPalaceInfo,
} from '../shared/types.js';

function formatZiweiFlyingStarResult(r: FlyingStarResult, lines: string[]): void {
  const formatPalace = (name: string | null | undefined) => {
    if (!name) return '无';
    return name.endsWith('宫') ? name : `${name}宫`;
  };

  if (r.type === 'fliesTo') {
    if (r.queryTarget?.fromPalace && r.queryTarget?.toPalace && r.queryTarget?.mutagens?.length) {
      lines.push(`- 判断目标: ${formatPalace(r.queryTarget.fromPalace)} -> ${formatPalace(r.queryTarget.toPalace)} [${r.queryTarget.mutagens.join('、')}]`);
    }
    lines.push(`- 结果: ${r.result ? '是' : '否'}`);
    if (r.actualFlights?.length) {
      for (const item of r.actualFlights) {
        const starSuffix = item.starName ? ` [${item.starName}星]` : '';
        lines.push(`- 实际落点: 化[${item.mutagen}] 飞入 -> ${formatPalace(item.targetPalace)}${starSuffix}`);
      }
    }
    return;
  }

  if (r.type === 'selfMutaged') {
    if (r.queryTarget?.palace && r.queryTarget?.mutagens?.length) {
      lines.push(`- 判断目标: ${formatPalace(r.queryTarget.palace)} [${r.queryTarget.mutagens.join('、')}]`);
    }
    lines.push(`- 结果: ${r.result ? '是' : '否'}`);
    return;
  }

  if (r.type === 'mutagedPlaces') {
    if (r.queryTarget?.palace) lines.push(`- 查询宫位: ${formatPalace(r.queryTarget.palace)}`);
    if (r.sourcePalaceGanZhi) lines.push(`- 本宫干支: ${r.sourcePalaceGanZhi}`);
    const places = r.actualFlights || (r.result as MutagedPlaceInfo[]).map((item) => ({ mutagen: item.mutagen, targetPalace: item.targetPalace, starName: null }));
    if (places.length === 0) {
      lines.push('- 结果: 无');
      return;
    }
    for (const p of places) {
      const starSuffix = p.starName ? ` [${p.starName}星]` : '';
      lines.push(`- 化${p.mutagen}: ${formatPalace(p.targetPalace)}${starSuffix}`);
    }
    return;
  }

  if (r.type === 'surroundedPalaces') {
    const s = r.result as SurroundedPalaceInfo;
    // 本宫就是查询宫位，只在没有查询宫位时写出
    lines.push(r.queryTarget?.palace ? `- 查询宫位: ${formatPalace(r.queryTarget.palace)}` : `- 本宫: ${formatPalace(s.target.name)}`);
    lines.push(`- 对宫: ${formatPalace(s.opposite.name)}`);
    lines.push(`- 三合宫 1: ${formatPalace(s.wealth.name)}`);
    lines.push(`- 三合宫 2: ${formatPalace(s.career.name)}`);
  }
}

export function renderZiweiFlyingStarCanonicalText(result: ZiweiFlyingStarOutput): string {
  const lines: string[] = ['# 紫微飞星'];

  for (const r of result.results) {
    lines.push('');
    lines.push(`## 查询 ${r.queryIndex + 1}`);
    lines.push(`- 查询类型: ${mapZiweiFlyingStarQueryType(r.type)}`);
    formatZiweiFlyingStarResult(r, lines);
  }

  return lines.join('\n');
}
