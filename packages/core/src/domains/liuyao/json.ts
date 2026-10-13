import { withRulesJSON } from '../../shared/calculation-rules.js';
import type {
  LiuyaoCanonicalJSON,
  LiuyaoJSON,
  LiuyaoYaoJSON,
} from './json-types.js';
import type {
  LiuyaoCombinationJSON,
  LiuyaoParticipantJSON,
} from '../shared/json-types.js';
import {
  formatGuaLevelLines,
  GUA_SCOPE_LABELS,
  KONG_WANG_LABELS,
  sortYaosDescending,
  traditionalYaoName,
  WANG_SHUAI_LABELS,
  YONG_SHEN_STATUS_LABELS,
} from './calculate.js';
import {
  buildShenSystemMap,
  mapLiuyaoRelationLabel,
  normalizeDetailLevel3Way,
} from '../../shared/render-utils.js';
import type {
  DetailLevel,
  ShenSystemInfo,
} from '../shared/types.js';
import type {
  LiuyaoOutput,
} from './types.js';

function buildShenSystemJSON(
  system: ShenSystemInfo | undefined,
): { yuanShen?: string; jiShen?: string; chouShen?: string; } | undefined {
  if (!system) return undefined;
  const result: { yuanShen?: string; jiShen?: string; chouShen?: string; } = {};
  if (system.yuanShen) result.yuanShen = `${system.yuanShen.liuQin}（${system.yuanShen.wuXing}）`;
  if (system.jiShen) result.jiShen = `${system.jiShen.liuQin}（${system.jiShen.wuXing}）`;
  if (system.chouShen) result.chouShen = `${system.chouShen.liuQin}（${system.chouShen.wuXing}）`;
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildLiuyaoPositionLabel(
  position: number | undefined,
  fullYaos: LiuyaoOutput['fullYaos'],
): string | undefined {
  if (!position) return undefined;
  const attached = fullYaos.find((yao) => yao.position === position);
  return attached ? `${traditionalYaoName(position, attached.type)}爻` : `${position}爻`;
}

function buildLiuyaoInteractionSources(result: LiuyaoOutput): LiuyaoParticipantJSON[] {
  const participants: LiuyaoParticipantJSON[] = [];
  for (const yao of result.fullYaos || []) {
    if (yao.isChanging) {
      participants.push({
        来源: '动爻',
        地支: yao.naJia,
        位置: buildLiuyaoPositionLabel(yao.position, result.fullYaos),
      });
    }
    if (yao.changedYao) {
      participants.push({
        来源: '变爻',
        地支: yao.changedYao.naJia,
        位置: buildLiuyaoPositionLabel(yao.position, result.fullYaos),
      });
    }
  }

  participants.push({ 来源: '月建', 地支: result.ganZhiTime.month.zhi });
  participants.push({ 来源: '日建', 地支: result.ganZhiTime.day.zhi });

  return participants;
}

function buildBanHeParticipants(
  branches: string[],
  sources: LiuyaoParticipantJSON[],
): LiuyaoParticipantJSON[] {
  const priority: Record<LiuyaoParticipantJSON['来源'], number> = {
    变爻: 0,
    动爻: 1,
    月建: 2,
    日建: 3,
  };

  return branches.map((branch) => {
    const matches = sources.filter((source) => source.地支 === branch);
    matches.sort((left, right) => priority[left.来源] - priority[right.来源]);
    return matches[0] || { 来源: '日建', 地支: branch };
  });
}

function buildLiuyaoBoardLines(
  result: LiuyaoOutput,
  detailLevel: DetailLevel,
): LiuyaoJSON['六爻全盘']['爻列表'] {
  return sortYaosDescending(result.fullYaos || []).map((yao) => {
    const line: LiuyaoJSON['六爻全盘']['爻列表'][number] = {
      爻位: traditionalYaoName(yao.position, yao.type),
      六神: yao.liuShen,
      ...(detailLevel !== 'default' && yao.shenSha?.length ? { 神煞: [...yao.shenSha] } : {}),
      本爻: {
        六亲: yao.liuQin,
        纳甲: yao.naJia,
        五行: yao.wuXing,
        ...(detailLevel === 'full' ? { 旺衰: WANG_SHUAI_LABELS[yao.strength.wangShuai] } : {}),
      },
      ...(detailLevel === 'full' ? { 动静: yao.movementLabel } : {}),
      ...(detailLevel === 'full' && yao.kongWangState && yao.kongWangState !== 'not_kong'
        ? { 空亡: KONG_WANG_LABELS[yao.kongWangState] || yao.kongWangState }
        : {}),
    };

    if (yao.fuShen) {
      line.伏神 = {
        六亲: yao.fuShen.liuQin,
        纳甲: yao.fuShen.naJia,
        五行: yao.fuShen.wuXing,
      };
    }

    if (yao.changedYao) {
      line.变爻 = {
        六亲: yao.changedYao.liuQin,
        纳甲: yao.changedYao.naJia,
        五行: yao.changedYao.wuXing,
      };
      if (detailLevel === 'full' && mapLiuyaoRelationLabel(yao.changedYao.relation)) {
        line.化变 = mapLiuyaoRelationLabel(yao.changedYao.relation);
      }
    }

    if (yao.isShiYao) line.世应 = '世';
    else if (yao.isYingYao) line.世应 = '应';

    return line;
  });
}

export const renderLiuyaoCanonicalJSON = withRulesJSON(renderLiuyaoCanonicalJSONBase);

function renderLiuyaoCanonicalJSONBase(result: LiuyaoOutput): LiuyaoCanonicalJSON {
  const hexagramInfo: LiuyaoCanonicalJSON['卦盘'] = {
    本卦: {
      卦名: result.hexagramName,
      卦宫: result.hexagramGong,
      五行: result.hexagramElement,
    },
  };
  if (result.question) hexagramInfo.问题 = result.question;
  if (result.guaCi) hexagramInfo.本卦.卦辞 = result.guaCi;
  if (result.xiangCi) hexagramInfo.本卦.象辞 = result.xiangCi;

  if (result.changedHexagramName) {
    const changed: NonNullable<typeof hexagramInfo.变卦> = {
      卦名: result.changedHexagramName,
    };
    if (result.changedHexagramGong) changed.卦宫 = result.changedHexagramGong;
    if (result.changedHexagramElement) changed.五行 = result.changedHexagramElement;
    if (result.changedGuaCi) changed.卦辞 = result.changedGuaCi;
    if (result.changedXiangCi) changed.象辞 = result.changedXiangCi;
    const changingYaoCi = (result.fullYaos || [])
      .filter((item) => item.isChanging && item.yaoCi)
      .map((yao) => ({ 爻名: traditionalYaoName(yao.position, yao.type), 爻辞: yao.yaoCi! }));
    if (changingYaoCi.length > 0) changed.动爻爻辞 = changingYaoCi;
    hexagramInfo.变卦 = changed;
  }

  if (result.nuclearHexagram) {
    hexagramInfo.互卦 = {
      卦名: result.nuclearHexagram.name,
      卦辞: result.nuclearHexagram.guaCi,
      象辞: result.nuclearHexagram.xiangCi,
    };
  }
  if (result.oppositeHexagram) {
    hexagramInfo.错卦 = {
      卦名: result.oppositeHexagram.name,
      卦辞: result.oppositeHexagram.guaCi,
      象辞: result.oppositeHexagram.xiangCi,
    };
  }
  if (result.reversedHexagram) {
    hexagramInfo.综卦 = {
      卦名: result.reversedHexagram.name,
      卦辞: result.reversedHexagram.guaCi,
      象辞: result.reversedHexagram.xiangCi,
    };
  }

  if (result.guaShen) {
    const guaShenYao = (result.fullYaos || []).find((y) => y.position === result.guaShen!.linePosition);
    const posLabel = typeof result.guaShen.linePosition === 'number'
      ? (guaShenYao ? `${traditionalYaoName(result.guaShen.linePosition, guaShenYao.type)}爻` : `${result.guaShen.linePosition}爻`)
      : undefined;
    hexagramInfo.卦身 = {
      地支: result.guaShen.branch,
    };
    if (posLabel) hexagramInfo.卦身.位置 = posLabel;
    if (result.guaShen.absent) hexagramInfo.卦身.状态 = '飞伏';
  }

  // 干支时间
  const gz = result.ganZhiTime;
  const ganZhiTime = [
    { 柱: '年', 干支: `${gz.year.gan}${gz.year.zhi}`, 空亡: [...result.kongWangByPillar.year.kongDizhi] },
    { 柱: '月', 干支: `${gz.month.gan}${gz.month.zhi}`, 空亡: [...result.kongWangByPillar.month.kongDizhi] },
    { 柱: '日', 干支: `${gz.day.gan}${gz.day.zhi}`, 空亡: [...result.kongWang.kongDizhi] },
    { 柱: '时', 干支: `${gz.hour.gan}${gz.hour.zhi}`, 空亡: [...result.kongWangByPillar.hour.kongDizhi] },
  ];

  // 六爻
  const sortedYaos = sortYaosDescending(result.fullYaos || []);
  const globalShenShaSet = new Set(result.globalShenSha || []);

  const yaos: LiuyaoYaoJSON[] = sortedYaos.map((yao) => {
    const yaoJSON: LiuyaoYaoJSON = {
      爻位: traditionalYaoName(yao.position, yao.type),
      六亲: yao.liuQin,
      六神: yao.liuShen,
      纳甲: yao.naJia,
      五行: yao.wuXing,
      旺衰: WANG_SHUAI_LABELS[yao.strength.wangShuai],
      动静状态: yao.movementState,
      动静: yao.movementLabel,
    };
    if (yao.isShiYao) yaoJSON.世应 = '世';
    else if (yao.isYingYao) yaoJSON.世应 = '应';

    if (yao.kongWangState && yao.kongWangState !== 'not_kong') {
      const kl = KONG_WANG_LABELS[yao.kongWangState];
      if (kl) yaoJSON.空亡 = kl;
    }
    if (yao.changSheng?.stage) yaoJSON.长生 = yao.changSheng.stage;

    const localShenSha = yao.shenSha?.filter((s) => !globalShenShaSet.has(s)) || [];
    if (localShenSha.length > 0) yaoJSON.神煞 = localShenSha;

    if (yao.isChanging && yao.changedYao) {
      yaoJSON.变爻 = {
        六亲: yao.changedYao.liuQin,
        纳甲: yao.changedYao.naJia,
        五行: yao.changedYao.wuXing,
        关系: yao.changedYao.relation,
      };
    }
    if (yao.fuShen) {
      yaoJSON.伏神 = {
        六亲: yao.fuShen.liuQin,
        纳甲: yao.fuShen.naJia,
        五行: yao.fuShen.wuXing,
        关系: yao.fuShen.relation,
      };
    }

    return yaoJSON;
  });

  // 用神分析
  const yaoNameMap = new Map<number, string>();
  for (const yao of sortedYaos) yaoNameMap.set(yao.position, traditionalYaoName(yao.position, yao.type));
  const posLabel = (pos?: number) => (pos ? `${yaoNameMap.get(pos) || pos}爻` : undefined);

  const shenSystemMap = buildShenSystemMap(result.shenSystemByYongShen || []);
  const timeRecMap = new Map<string, typeof result.timeRecommendations>();
  for (const item of result.timeRecommendations || []) {
    const list = timeRecMap.get(item.targetLiuQin) || [];
    list.push(item);
    timeRecMap.set(item.targetLiuQin, list);
  }

  const yongShenAnalysis: LiuyaoCanonicalJSON['用神分析'] = result.yongShen.map((group) => {
    const selected = group.selected;
    const entry: LiuyaoCanonicalJSON['用神分析'][number] = {
      目标六亲: group.targetLiuQin,
      取用状态: YONG_SHEN_STATUS_LABELS[group.selectionStatus] || group.selectionStatus,
      已选用神: {
        六亲: selected.liuQin,
        强弱: selected.strengthLabel,
        动静: selected.movementLabel,
      },
    };
    const selectedPos = posLabel(selected.position);
    if (selectedPos) entry.已选用神.爻位 = selectedPos;
    if (selected.naJia) entry.已选用神.纳甲 = selected.naJia;
    if (selected.changedNaJia) entry.已选用神.变爻纳甲 = selected.changedNaJia;
    if (selected.huaType) entry.已选用神.化变类型 = selected.huaType;
    if (selected.element) entry.已选用神.五行 = selected.element;
    if (selected.source) entry.已选用神.来源 = selected.source;
    if (selected.movementState) entry.已选用神.动静状态 = selected.movementState;
    if (selected.isShiYao) entry.已选用神.是否世爻 = '是';
    if (selected.isYingYao) entry.已选用神.是否应爻 = '是';
    if (selected.kongWangState) entry.已选用神.空亡状态 = selected.kongWangState;
    if (selected.evidence?.length) entry.已选用神.依据 = selected.evidence;

    // 多现时说明写明定主用所据之条与出处
    if (group.selectionNote && (group.selectionStatus !== 'resolved' || (group.candidates?.length ?? 0) > 0)) {
      entry.取用说明 = group.selectionNote;
    }

    if (group.candidates?.length) {
      entry.候选用神 = group.candidates.map((candidate) => {
        const c: NonNullable<typeof entry.候选用神>[number] = {
          六亲: candidate.liuQin,
          强弱: candidate.strengthLabel,
          动静: candidate.movementLabel,
        };
        const cPos = posLabel(candidate.position);
        if (cPos) c.爻位 = cPos;
        if (candidate.naJia) c.纳甲 = candidate.naJia;
        if (candidate.changedNaJia) c.变爻纳甲 = candidate.changedNaJia;
        if (candidate.huaType) c.化变类型 = candidate.huaType;
        if (candidate.element) c.五行 = candidate.element;
        if (candidate.source) c.来源 = candidate.source;
        if (candidate.movementState) c.动静状态 = candidate.movementState;
        if (candidate.isShiYao) c.是否世爻 = '是';
        if (candidate.isYingYao) c.是否应爻 = '是';
        if (candidate.kongWangState) c.空亡状态 = candidate.kongWangState;
        if (candidate.evidence?.length) c.依据 = candidate.evidence;
        return c;
      });
    }

    const shenSystem = buildShenSystemJSON(shenSystemMap.get(group.targetLiuQin));
    if (shenSystem) {
      entry.神煞系统 = {
        ...(shenSystem.yuanShen ? { 原神: shenSystem.yuanShen } : {}),
        ...(shenSystem.jiShen ? { 忌神: shenSystem.jiShen } : {}),
        ...(shenSystem.chouShen ? { 仇神: shenSystem.chouShen } : {}),
      };
    }

    const recs = timeRecMap.get(group.targetLiuQin);
    if (recs?.length) {
      entry.应期提示 = recs.map((item) => ({
        触发: item.trigger,
        依据: item.basis || [],
        说明: item.description,
      }));
    }

    return entry;
  });

  return {
    卦盘: hexagramInfo,
    干支时间: ganZhiTime,
    六爻: yaos,
    用神分析: yongShenAnalysis,
    卦级分析: formatGuaLevelLines(result),
    提示: result.warnings || [],
    全局神煞: result.globalShenSha || [],
  };
}

export const renderLiuyaoJSON = withRulesJSON(renderLiuyaoJSONBase);

function renderLiuyaoJSONBase(
  result: LiuyaoOutput,
  options?: { detailLevel?: DetailLevel; },
): LiuyaoJSON {
  const detailLevel = normalizeDetailLevel3Way(options?.detailLevel);
  const raw = renderLiuyaoCanonicalJSON(result);

  const interactionSources = buildLiuyaoInteractionSources(result);
  const combinations: LiuyaoCombinationJSON[] = [];
  if (result.sanHeAnalysis?.banHe?.length) {
    for (const item of result.sanHeAnalysis.banHe) {
      combinations.push({
        类型: '半合',
        结果五行: item.result,
        参与者: buildBanHeParticipants(item.branches, interactionSources),
      });
    }
  }
  if (result.sanHeAnalysis?.fullSanHeList?.length) {
    for (const item of result.sanHeAnalysis.fullSanHeList) {
      combinations.push({
        类型: '三合',
        结果五行: item.result,
        名称: item.name,
        位置: item.positions?.map((position) => buildLiuyaoPositionLabel(position, result.fullYaos) || `${position}爻`) || [],
      });
    }
  }

  const transitions: LiuyaoJSON['全局互动']['冲合转换'] = [];
  if (result.chongHeTransition && (result.chongHeTransition.type === 'chong_to_he' || result.chongHeTransition.type === 'he_to_chong')) {
    transitions.push({ 类型: result.chongHeTransition.type === 'chong_to_he' ? '冲转合' : '合转冲' });
  }

  const resonances: LiuyaoJSON['全局互动']['反伏信息'] = [];
  const fanFuYin = result.guaFanFuYin;
  if (fanFuYin?.isFanYin) {
    resonances.push({ 类型: '反吟', ...(fanFuYin.fanYinScope ? { 范围: GUA_SCOPE_LABELS[fanFuYin.fanYinScope] } : {}) });
  }
  if (fanFuYin?.isFuYin) {
    resonances.push({ 类型: '伏吟', ...(fanFuYin.fuYinScope ? { 范围: GUA_SCOPE_LABELS[fanFuYin.fuYinScope] } : {}) });
  }

  const payload: LiuyaoJSON = {
    卦盘: {
      ...(result.question ? { 问题: result.question } : {}),
      本卦: {
        卦名: result.hexagramName,
        卦宫: result.hexagramGong,
        五行: result.hexagramElement,
        ...(result.guaCi ? { 卦辞: result.guaCi } : {}),
      },
      ...(result.changedHexagramName
        ? {
          变卦: {
            卦名: result.changedHexagramName,
            ...(result.changedHexagramGong ? { 卦宫: result.changedHexagramGong } : {}),
            ...(result.changedHexagramElement ? { 五行: result.changedHexagramElement } : {}),
            ...(result.changedGuaCi ? { 卦辞: result.changedGuaCi } : {}),
            动爻: (result.fullYaos || [])
              .filter((item) => item.isChanging)
              .map((yao) => traditionalYaoName(yao.position, yao.type)),
            ...(((result.fullYaos || [])
              .filter((item) => item.isChanging && item.yaoCi)
              .map((yao) => ({ 爻名: traditionalYaoName(yao.position, yao.type), 爻辞: yao.yaoCi! }))).length > 0
              ? {
                动爻爻辞: (result.fullYaos || [])
                  .filter((item) => item.isChanging && item.yaoCi)
                  .map((yao) => ({ 爻名: traditionalYaoName(yao.position, yao.type), 爻辞: yao.yaoCi! })),
              }
              : {}),
          },
        }
        : {}),
      干支时间: raw.干支时间,
    },
    六爻全盘: {
      爻列表: buildLiuyaoBoardLines(result, detailLevel),
    },
    全局互动: {
      组合关系: combinations,
      ...(detailLevel === 'full' && transitions.length > 0 ? { 冲合转换: transitions } : {}),
      ...(detailLevel === 'full' && resonances.length > 0 ? { 反伏信息: resonances } : {}),
      ...(detailLevel === 'full' ? { 是否六冲卦: result.liuChongGuaInfo?.isLiuChongGua ? '是' : '否' } : {}),
      ...(detailLevel === 'full' ? { 是否六合卦: result.liuHeGuaInfo?.isLiuHeGua ? '是' : '否' } : {}),
      ...(detailLevel === 'full' && result.chongHeTransition && result.chongHeTransition.type !== 'none'
        ? { 冲合趋势: result.chongHeTransition.type === 'chong_to_he' ? '冲转合' : '合转冲' }
        : {}),
    },
    元信息: {
      细节级别: detailLevel === 'default' ? '默认' : detailLevel === 'more' ? '扩展' : '完整',
    },
  };

  if (detailLevel === 'more' || detailLevel === 'full') {
    if (result.guaShen) {
      payload.卦盘.卦身 = {
        地支: result.guaShen.branch,
        ...(result.guaShen.linePosition ? { 位置: buildLiuyaoPositionLabel(result.guaShen.linePosition, result.fullYaos) } : {}),
        ...(result.guaShen.absent ? { 状态: '飞伏' } : {}),
      };
    }
    if (result.nuclearHexagram || result.oppositeHexagram || result.reversedHexagram) {
      payload.卦盘.衍生卦 = {
        ...(result.nuclearHexagram ? { 互卦: { 卦名: result.nuclearHexagram.name } } : {}),
        ...(result.oppositeHexagram ? { 错卦: { 卦名: result.oppositeHexagram.name } } : {}),
        ...(result.reversedHexagram ? { 综卦: { 卦名: result.reversedHexagram.name } } : {}),
      };
    }
    if (result.globalShenSha?.length) {
      payload.卦盘.全局神煞 = [...result.globalShenSha];
    }
  }

  return payload;
}
