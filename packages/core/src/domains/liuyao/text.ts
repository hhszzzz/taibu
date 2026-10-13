import { withRulesText } from '../../shared/calculation-rules.js';
import {
  formatGuaLevelLines,
  KONG_WANG_LABELS,
  sortYaosDescending,
  traditionalYaoName,
  WANG_SHUAI_LABELS,
  YONG_SHEN_STATUS_LABELS,
} from './calculate.js';
import {
  buildShenSystemMap,
  mapLiuyaoRelationLabel
} from '../../shared/render-utils.js';
import type {
  ShenSystemInfo
} from '../shared/types.js';
import type {
  LiuyaoOutput,
} from './types.js';

function formatShenSystemParts(system: ShenSystemInfo | undefined): string[] {
  const parts: string[] = [];
  if (system?.yuanShen) parts.push(`原神=${system.yuanShen.liuQin}（${system.yuanShen.wuXing}）`);
  if (system?.jiShen) parts.push(`忌神=${system.jiShen.liuQin}（${system.jiShen.wuXing}）`);
  if (system?.chouShen) parts.push(`仇神=${system.chouShen.liuQin}（${system.chouShen.wuXing}）`);
  return parts;
}

export const renderLiuyaoCanonicalText = withRulesText(renderLiuyaoCanonicalTextBase);

function renderLiuyaoCanonicalTextBase(result: LiuyaoOutput): string {
  const lines: string[] = ['# 六爻分析', '', '## 卦象信息'];
  if (result.question) lines.push(`- 问题: ${result.question}`);
  lines.push(`- 本卦: ${result.hexagramName}（${result.hexagramGong || '?'}宫·${result.hexagramElement || '?'}）`);
  if (result.guaCi) lines.push(`- 卦辞: ${result.guaCi}`);
  if (result.xiangCi) lines.push(`- 象辞: ${result.xiangCi}`);
  if (result.changedHexagramName) {
    lines.push(`- 变卦: ${result.changedHexagramName}（${result.changedHexagramGong || ''}宫·${result.changedHexagramElement || ''}）`);
    if (result.changedGuaCi) lines.push(`- 变卦卦辞: ${result.changedGuaCi}`);
    if (result.changedXiangCi) lines.push(`- 变卦象辞: ${result.changedXiangCi}`);
    for (const yao of (result.fullYaos || []).filter((item) => item.isChanging && item.yaoCi)) {
      lines.push(`- ${traditionalYaoName(yao.position, yao.type)}爻辞: ${yao.yaoCi}`);
    }
  } else {
    lines.push('- 变卦: 无');
  }
  if (result.nuclearHexagram) {
    lines.push(`- 互卦: ${result.nuclearHexagram.name}`);
    if (result.nuclearHexagram.guaCi) lines.push(`- 互卦卦辞: ${result.nuclearHexagram.guaCi}`);
    if (result.nuclearHexagram.xiangCi) lines.push(`- 互卦象辞: ${result.nuclearHexagram.xiangCi}`);
  }
  if (result.oppositeHexagram) {
    lines.push(`- 错卦: ${result.oppositeHexagram.name}`);
    if (result.oppositeHexagram.guaCi) lines.push(`- 错卦卦辞: ${result.oppositeHexagram.guaCi}`);
    if (result.oppositeHexagram.xiangCi) lines.push(`- 错卦象辞: ${result.oppositeHexagram.xiangCi}`);
  }
  if (result.reversedHexagram) {
    lines.push(`- 综卦: ${result.reversedHexagram.name}`);
    if (result.reversedHexagram.guaCi) lines.push(`- 综卦卦辞: ${result.reversedHexagram.guaCi}`);
    if (result.reversedHexagram.xiangCi) lines.push(`- 综卦象辞: ${result.reversedHexagram.xiangCi}`);
  }
  if (result.guaShen) {
    const guaShenYao = (result.fullYaos || []).find((y) => y.position === result.guaShen!.linePosition);
    const posLabel = typeof result.guaShen.linePosition === 'number'
      ? (guaShenYao ? `${traditionalYaoName(result.guaShen.linePosition, guaShenYao.type)}爻` : `${result.guaShen.linePosition}爻`)
      : '';
    const extra = [posLabel, result.guaShen.absent ? '飞伏' : ''].filter(Boolean).join('，');
    lines.push(`- 卦身: ${result.guaShen.branch}${extra ? `（${extra}）` : ''}`);
  } else {
    lines.push('- 卦身: 无');
  }
  lines.push('');
  const gz = result.ganZhiTime;
  lines.push('| 柱 | 干支 | 空亡 |');
  lines.push('|------|------|------|');
  lines.push(`| 年 | ${gz.year.gan}${gz.year.zhi} | ${result.kongWangByPillar.year.kongDizhi.join(' ')} |`);
  lines.push(`| 月 | ${gz.month.gan}${gz.month.zhi} | ${result.kongWangByPillar.month.kongDizhi.join(' ')} |`);
  lines.push(`| 日 | ${gz.day.gan}${gz.day.zhi} | ${result.kongWang.kongDizhi.join(' ')} |`);
  lines.push(`| 时 | ${gz.hour.gan}${gz.hour.zhi} | ${result.kongWangByPillar.hour.kongDizhi.join(' ')} |`);
  lines.push('');
  lines.push('## 六爻排盘');
  lines.push('');
  const sortedYaos = sortYaosDescending(result.fullYaos || []);
  const globalShenShaSet = new Set(result.globalShenSha || []);
  const hasKongCol = sortedYaos.some((y) => y.kongWangState && y.kongWangState !== 'not_kong');
  const hasChangShengCol = sortedYaos.some((y) => y.changSheng?.stage);
  const hasShenShaCol = sortedYaos.some((y) => y.shenSha?.some((s) => !globalShenShaSet.has(s)));
  const hasBianChuCol = sortedYaos.some((y) => y.isChanging && y.changedYao);
  const hasFuShenCol = sortedYaos.some((y) => y.fuShen);
  const yaoHeader: string[] = ['爻位', '六亲', '六神', '纳甲', '动静'];
  if (hasKongCol) yaoHeader.push('空亡');
  // 十二长生只取实际作用的生旺墓绝，按日辰论（见 calculate.ts judgeDay）
  if (hasChangShengCol) yaoHeader.push('日辰长生');
  if (hasShenShaCol) yaoHeader.push('神煞');
  if (hasBianChuCol) yaoHeader.push('变出');
  if (hasFuShenCol) yaoHeader.push('伏神');
  lines.push(`| ${yaoHeader.join(' | ')} |`);
  lines.push(`|${yaoHeader.map(() => '------').join('|')}|`);
  for (const yao of sortedYaos) {
    const shiYing = yao.isShiYao ? '·世' : yao.isYingYao ? '·应' : '';
    const cells: string[] = [
      `${traditionalYaoName(yao.position, yao.type)}${shiYing}`,
      yao.liuQin,
      yao.liuShen,
      `${yao.naJia}${yao.wuXing}(${WANG_SHUAI_LABELS[yao.strength.wangShuai]})`,
      yao.movementLabel,
    ];
    if (hasKongCol) {
      const kl = yao.kongWangState && yao.kongWangState !== 'not_kong' ? KONG_WANG_LABELS[yao.kongWangState] : '';
      cells.push(kl || '-');
    }
    if (hasChangShengCol) cells.push(yao.changSheng?.stage || '-');
    if (hasShenShaCol) {
      const local = yao.shenSha?.filter((s) => !globalShenShaSet.has(s)) || [];
      cells.push(local.length ? local.join('、') : '-');
    }
    if (hasBianChuCol) {
      if (yao.isChanging && yao.changedYao) {
        const rel = yao.changedYao.relation ? `(${yao.changedYao.relation})` : '';
        cells.push(`→${yao.changedYao.liuQin}${yao.changedYao.naJia}${yao.changedYao.wuXing}${rel}`);
      } else {
        cells.push('-');
      }
    }
    if (hasFuShenCol) {
      if (yao.fuShen) {
        const rel = yao.fuShen.relation ? `(${yao.fuShen.relation})` : '';
        cells.push(`${yao.fuShen.liuQin}${yao.fuShen.naJia}${yao.fuShen.wuXing}${rel}`);
      } else {
        cells.push('-');
      }
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');

  if (result.yongShen.length > 0) {
    lines.push('## 用神分析');
    lines.push('');
    const yaoNameMap = new Map<number, string>();
    for (const yao of sortedYaos) yaoNameMap.set(yao.position, traditionalYaoName(yao.position, yao.type));
    const posLabel = (pos?: number) => (pos ? `${yaoNameMap.get(pos) || pos}爻` : '');
    const shenSystemMap = buildShenSystemMap(result.shenSystemByYongShen || []);
    const timeRecMap = new Map<string, typeof result.timeRecommendations>();
    for (const item of result.timeRecommendations || []) {
      const list = timeRecMap.get(item.targetLiuQin) || [];
      list.push(item);
      timeRecMap.set(item.targetLiuQin, list);
    }
    for (const group of result.yongShen) {
      const statusSuffix = group.selectionStatus !== 'resolved' ? `（${YONG_SHEN_STATUS_LABELS[group.selectionStatus] || group.selectionStatus}）` : '';
      lines.push(`### ${group.targetLiuQin}${statusSuffix}`);
      const selected = group.selected;
      const selectedExtra = [
        selected.changedNaJia ? `变出=${selected.changedNaJia}` : null,
        selected.huaType ? `化变=${selected.huaType}` : null,
      ].filter(Boolean).join('，');
      const posStr = posLabel(selected.position);
      const mainPrefix = posStr || selected.liuQin;
      lines.push(`- ${mainPrefix}${selected.naJia ? ` ${selected.naJia}` : ''}${selectedExtra ? `（${selectedExtra}）` : ''}，${selected.strengthLabel}，${selected.movementLabel}`);
      if (group.selectionNote && group.selectionStatus !== 'resolved') lines.push(`- 说明: ${group.selectionNote}`);
      if (selected.evidence?.length) lines.push(`- 依据: ${selected.evidence.join('、')}`);
      if (group.candidates?.length) {
        lines.push(`- 并看: ${group.candidates.map((candidate) => {
          const candidateExtra = [
            candidate.changedNaJia ? `变出=${candidate.changedNaJia}` : null,
            candidate.huaType ? `化变=${candidate.huaType}` : null,
          ].filter(Boolean).join('，');
          const cPos = posLabel(candidate.position);
          const cPrefix = cPos || candidate.liuQin;
          return `${cPrefix}${candidate.naJia ? ` ${candidate.naJia}` : ''}${candidateExtra ? `（${candidateExtra}）` : ''}${candidate.evidence?.length ? `：${candidate.evidence.join('、')}` : ''}`;
        }).join('；')}`);
      }
      const system = shenSystemMap.get(group.targetLiuQin);
      const shenParts = formatShenSystemParts(system);
      if (shenParts.length > 0) lines.push(`- 神系: ${shenParts.join('，')}`);
      const recs = timeRecMap.get(group.targetLiuQin);
      if (recs?.length) {
        for (const item of recs) {
          lines.push(`- 应期: ${item.trigger}${item.basis?.length ? `（${item.basis.join('、')}）` : ''}，${item.description}`);
        }
      }
      lines.push('');
    }
  }

  const guaLevelParts = formatGuaLevelLines(result).map((line) => `- ${line}`);
  if (guaLevelParts.length > 0) {
    lines.push('## 卦级分析');
    lines.push('');
    lines.push(...guaLevelParts);
    lines.push('');
  }

  if (result.warnings?.length) {
    lines.push('## 凶吉警告');
    lines.push('');
    for (const warning of result.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  return lines.join('\n');
}

function buildLiuyaoSafeTextPosition(
  position: number | undefined,
  fullYaos: LiuyaoOutput['fullYaos'],
): string | undefined {
  if (!position) return undefined;
  const attached = fullYaos.find((yao) => yao.position === position);
  return attached ? `${traditionalYaoName(position, attached.type)}爻` : `${position}爻`;
}

function buildLiuyaoSafeInteractionText(result: LiuyaoOutput): string[] {
  const lines: string[] = [];
  const sourceIndex = new Map<string, string>();
  for (const yao of result.fullYaos || []) {
    const positionLabel = buildLiuyaoSafeTextPosition(yao.position, result.fullYaos) || `${yao.position}爻`;
    if (yao.isChanging) {
      sourceIndex.set(`moving:${yao.naJia}`, `${yao.naJia}(动爻 ${positionLabel})`);
    }
    if (yao.changedYao) {
      sourceIndex.set(`changed:${yao.changedYao.naJia}`, `${yao.changedYao.naJia}(变爻 ${positionLabel})`);
    }
  }
  sourceIndex.set(`month:${result.ganZhiTime.month.zhi}`, `${result.ganZhiTime.month.zhi}(月建)`);
  sourceIndex.set(`day:${result.ganZhiTime.day.zhi}`, `${result.ganZhiTime.day.zhi}(日建)`);

  if (result.sanHeAnalysis?.banHe?.length) {
    for (const item of result.sanHeAnalysis.banHe) {
      const participants = item.branches.map((branch) =>
        sourceIndex.get(`changed:${branch}`)
        || sourceIndex.get(`moving:${branch}`)
        || sourceIndex.get(`month:${branch}`)
        || sourceIndex.get(`day:${branch}`)
        || branch,
      );
      lines.push(`- 半合: ${participants.join(' + ')} -> ${item.result}`);
    }
  }

  if (result.sanHeAnalysis?.fullSanHeList?.length) {
    for (const item of result.sanHeAnalysis.fullSanHeList) {
      const positions = item.positions?.map((position) => buildLiuyaoSafeTextPosition(position, result.fullYaos) || `${position}爻`) || [];
      lines.push(`- 三合: ${item.name} -> ${item.result}${positions.length ? ` (${positions.join('、')})` : ''}`);
    }
  }

  if (result.chongHeTransition?.type === 'chong_to_he') {
    lines.push('- 转换: 冲转合');
  } else if (result.chongHeTransition?.type === 'he_to_chong') {
    lines.push('- 转换: 合转冲');
  }

  if (result.guaFanFuYin?.isFuYin) lines.push('- 共振: 伏吟');
  if (result.guaFanFuYin?.isFanYin) lines.push('- 共振: 反吟');

  return lines;
}

export const renderLiuyaoText = withRulesText(renderLiuyaoTextBase);

function renderLiuyaoTextBase(
  result: LiuyaoOutput,
  options?: { detailLevel?: 'default' | 'more' | 'full'; },
): string {
  const requested = options?.detailLevel;
  const detailLevel= requested === 'more'
    ? 'more'
    : requested === 'full'
      ? 'full'
      : 'default';

  const lines: string[] = ['# 六爻盘面', '', '## 卦盘总览'];
  if (result.question) lines.push(`- 问题: ${result.question}`);
  lines.push(`- 本卦: ${result.hexagramName}（${result.hexagramGong || '?'}宫·${result.hexagramElement || '?'}）`);
  if (result.guaCi) {
    lines.push(`- 本卦卦辞: ${result.guaCi}`);
  }
  if (result.changedHexagramName) {
    const changedMeta = result.changedHexagramGong || result.changedHexagramElement
      ? `（${result.changedHexagramGong || ''}宫·${result.changedHexagramElement || ''}）`
      : '';
    lines.push(`- 变卦: ${result.changedHexagramName}${changedMeta}`);
    if (result.changedGuaCi) {
      lines.push(`- 变卦卦辞: ${result.changedGuaCi}`);
    }
  }
  const changing = (result.fullYaos || [])
    .filter((item) => item.isChanging)
    .map((yao) => traditionalYaoName(yao.position, yao.type));
  if (changing.length > 0) {
    lines.push(`- 动爻: ${changing.join('、')}`);
  }
  for (const yao of (result.fullYaos || []).filter((item) => item.isChanging && item.yaoCi)) {
    lines.push(`- ${traditionalYaoName(yao.position, yao.type)}爻辞: ${yao.yaoCi}`);
  }

  if (detailLevel === 'more' || detailLevel === 'full') {
    if (result.guaShen) {
      const guaShenPos = result.guaShen.linePosition ? buildLiuyaoSafeTextPosition(result.guaShen.linePosition, result.fullYaos) : '';
      lines.push(`- 卦身: ${result.guaShen.branch}${guaShenPos ? `（${guaShenPos}）` : ''}`);
    }
    if (result.nuclearHexagram) lines.push(`- 互卦: ${result.nuclearHexagram.name}`);
    if (result.oppositeHexagram) lines.push(`- 错卦: ${result.oppositeHexagram.name}`);
    if (result.reversedHexagram) lines.push(`- 综卦: ${result.reversedHexagram.name}`);
    if (result.globalShenSha?.length) lines.push(`- 全局神煞: ${result.globalShenSha.join('、')}`);
    lines.push('');
  }

  const gz = result.ganZhiTime;
  lines.push('## 时间信息');
  lines.push('| 柱 | 干支 | 空亡 |');
  lines.push('|------|------|------|');
  lines.push(`| 年 | ${gz.year.gan}${gz.year.zhi} | ${result.kongWangByPillar.year.kongDizhi.join(' ')} |`);
  lines.push(`| 月 | ${gz.month.gan}${gz.month.zhi} | ${result.kongWangByPillar.month.kongDizhi.join(' ')} |`);
  lines.push(`| 日 | ${gz.day.gan}${gz.day.zhi} | ${result.kongWang.kongDizhi.join(' ')} |`);
  lines.push(`| 时 | ${gz.hour.gan}${gz.hour.zhi} | ${result.kongWangByPillar.hour.kongDizhi.join(' ')} |`);
  lines.push('');

  const boardLines = sortYaosDescending(result.fullYaos || []);
  if (boardLines.length > 0) {
    lines.push('## 六爻排盘');
    const header = ['爻位', '六神'];
    if (detailLevel === 'more' || detailLevel === 'full') header.push('神煞');
    header.push('伏神', '本卦六亲/干支');
    if (detailLevel === 'full') header.push('旺衰', '动静', '空亡');
    header.push('变出');
    if (detailLevel === 'full') header.push('化变');
    header.push('世应');
    lines.push(`| ${header.join(' | ')} |`);
    lines.push(`|${header.map(() => '------').join('|')}|`);
    for (const yao of boardLines) {
      const fuShen = yao.fuShen ? `${yao.fuShen.liuQin} ${yao.fuShen.naJia}${yao.fuShen.wuXing}` : '-';
      const mainLine = `${yao.liuQin} ${yao.naJia}${yao.wuXing}`;
      const changedTo = yao.changedYao ? `${yao.changedYao.liuQin} ${yao.changedYao.naJia}${yao.changedYao.wuXing}` : '-';
      const shiYing = yao.isShiYao ? '世' : yao.isYingYao ? '应' : '-';
      const row = [traditionalYaoName(yao.position, yao.type), yao.liuShen];
      if (detailLevel === 'more' || detailLevel === 'full') row.push(yao.shenSha?.length ? yao.shenSha.join('、') : '-');
      row.push(fuShen, mainLine);
      if (detailLevel === 'full') {
        row.push(
          WANG_SHUAI_LABELS[yao.strength.wangShuai],
          yao.movementLabel,
          yao.kongWangState && yao.kongWangState !== 'not_kong' ? (KONG_WANG_LABELS[yao.kongWangState] || yao.kongWangState) : '-',
        );
      }
      row.push(changedTo);
      if (detailLevel === 'full') row.push(mapLiuyaoRelationLabel(yao.changedYao?.relation) || '-');
      row.push(shiYing);
      lines.push(`| ${row.join(' | ')} |`);
    }
    lines.push('');
  }

  const interactions = buildLiuyaoSafeInteractionText(result);
  if (interactions.length > 0) {
    lines.push('## 卦象关系', '');
    lines.push(...interactions);
    if (detailLevel === 'full') {
      if (result.liuChongGuaInfo) lines.push(`- 六冲卦: ${result.liuChongGuaInfo.isLiuChongGua ? '是' : '否'}`);
      if (result.liuHeGuaInfo) lines.push(`- 六合卦: ${result.liuHeGuaInfo.isLiuHeGua ? '是' : '否'}`);
      if (result.chongHeTransition?.type && result.chongHeTransition.type !== 'none') {
        lines.push(`- 冲合转换: ${result.chongHeTransition.type === 'chong_to_he' ? '冲转合' : '合转冲'}`);
      }
      const resonanceFlags = [
        ...(result.guaFanFuYin?.isFanYin ? ['反吟'] : []),
        ...(result.guaFanFuYin?.isFuYin ? ['伏吟'] : []),
      ];
      if (resonanceFlags.length > 0) {
        lines.push(`- 反吟伏吟: ${resonanceFlags.join('、')}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
