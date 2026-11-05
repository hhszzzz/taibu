import { PERSONALITY_BASICS, type MBTIType } from '@/lib/divination/mbti';
import { FACE_ANALYSIS_TYPES } from '@/lib/divination/face';
import { PALM_ANALYSIS_TYPES } from '@/lib/divination/palm';

export const HISTORY_TYPES = [
  'tarot',
  'liuyao',
  'mbti',
  'hepan',
  'palm',
  'face',
  'qimen',
  'daliuren',
  'meihua',
  'xiaoliuren',
] as const;

export type HistoryType = typeof HISTORY_TYPES[number];

export type HistorySummaryItem = {
  id: string;
  title: string;
  changedTitle?: string;
  question?: string;
  createdAt: string;
  subType?: string;
  modelName?: string;
  badges?: string[];
  metric?: string;
  conversationId?: string | null;
};

export type HistoryRestorePayload = {
  sessionKey: string;
  detailPath: string;
  useTimestamp?: boolean;
  sessionData: Record<string, unknown>;
};

export type HistoryReplayMode = 'saved-result' | 'input-recompute' | 'stored-fields';

export type HistoryReplayPolicy = {
  mode: HistoryReplayMode;
  legacyFallback: 'input-recompute' | 'field-defaults' | 'unavailable';
};

// This describes history-to-result-page replay, not data providers or AI model sources.
// Old rows have no inferred engine/version, and metadata never rewrites saved data.
type HistoryConfig = {
  label: string;
  tableName: string;
  historyPath: string;
  detailPath: string;
  sessionKey: string;
  summaryColumns: readonly string[];
  replay: HistoryReplayPolicy;
  useTimestamp?: boolean;
};

export const HISTORY_CONFIG: Record<HistoryType, HistoryConfig> = {
  tarot: {
    replay: { mode: 'saved-result', legacyFallback: 'field-defaults' },
    label: '塔罗历史',
    tableName: 'tarot_readings',
    historyPath: '/tarot/history',
    detailPath: '/tarot/result',
    sessionKey: 'tarot_result',
    summaryColumns: ['id', 'spread_id', 'question', 'cards', 'conversation_id', 'created_at'],
    useTimestamp: true,
  },
  liuyao: {
    replay: { mode: 'input-recompute', legacyFallback: 'field-defaults' },
    label: '六爻历史',
    tableName: 'liuyao_divinations',
    historyPath: '/liuyao/history',
    detailPath: '/liuyao/result',
    sessionKey: 'liuyao_result',
    summaryColumns: ['id', 'hexagram_code', 'changed_hexagram_code', 'changed_lines', 'question', 'conversation_id', 'created_at'],
  },
  mbti: {
    replay: { mode: 'stored-fields', legacyFallback: 'field-defaults' },
    label: 'MBTI历史',
    tableName: 'mbti_readings',
    historyPath: '/mbti/history',
    detailPath: '/mbti/result',
    sessionKey: 'mbti_result',
    summaryColumns: ['id', 'mbti_type', 'percentages', 'conversation_id', 'created_at'],
  },
  hepan: {
    replay: { mode: 'saved-result', legacyFallback: 'input-recompute' },
    label: '合盘历史',
    tableName: 'hepan_charts',
    historyPath: '/hepan/history',
    detailPath: '/hepan/result',
    sessionKey: 'hepan_result',
    summaryColumns: ['id', 'type', 'person1_name', 'person2_name', 'compatibility_score', 'conversation_id', 'created_at'],
  },
  palm: {
    replay: { mode: 'stored-fields', legacyFallback: 'field-defaults' },
    label: '手相历史',
    tableName: 'palm_readings',
    historyPath: '/palm/history',
    detailPath: '/palm/result',
    sessionKey: 'palm_result',
    summaryColumns: ['id', 'analysis_type', 'hand_type', 'conversation_id', 'created_at'],
  },
  face: {
    replay: { mode: 'stored-fields', legacyFallback: 'field-defaults' },
    label: '面相历史',
    tableName: 'face_readings',
    historyPath: '/face/history',
    detailPath: '/face/result',
    sessionKey: 'face_result',
    summaryColumns: ['id', 'analysis_type', 'conversation_id', 'created_at'],
  },
  qimen: {
    replay: { mode: 'input-recompute', legacyFallback: 'field-defaults' },
    label: '奇门历史',
    tableName: 'qimen_charts',
    historyPath: '/qimen/history',
    detailPath: '/qimen/result',
    sessionKey: 'qimen_result',
    summaryColumns: ['id', 'dun_type', 'ju_number', 'question', 'conversation_id', 'created_at'],
  },
  daliuren: {
    replay: { mode: 'input-recompute', legacyFallback: 'field-defaults' },
    label: '六壬历史',
    tableName: 'daliuren_divinations',
    historyPath: '/daliuren/history',
    detailPath: '/daliuren/result',
    sessionKey: 'daliuren_params',
    summaryColumns: ['id', 'day_ganzhi', 'result_data', 'question', 'conversation_id', 'created_at'],
    useTimestamp: true,
  },
  meihua: {
    replay: { mode: 'saved-result', legacyFallback: 'input-recompute' },
    label: '梅花历史',
    tableName: 'meihua_divinations',
    historyPath: '/meihua/history',
    detailPath: '/meihua/result',
    sessionKey: 'meihua_result',
    summaryColumns: ['id', 'question', 'method', 'main_hexagram', 'changed_hexagram', 'conversation_id', 'created_at'],
  },
  xiaoliuren: {
    replay: { mode: 'saved-result', legacyFallback: 'unavailable' },
    label: '小六壬历史',
    tableName: 'xiaoliuren_divinations',
    historyPath: '/xiaoliuren/history',
    detailPath: '/xiaoliuren/result',
    sessionKey: 'xiaoliuren_result',
    summaryColumns: ['id', 'question', 'lunar_month', 'lunar_day', 'is_leap_month', 'shichen', 'final_status', 'conversation_id', 'created_at'],
  },
};

const HISTORY_TYPE_SET = new Set<string>(HISTORY_TYPES);

export function isHistoryType(value: unknown): value is HistoryType {
  return typeof value === 'string' && HISTORY_TYPE_SET.has(value);
}

/**
 * Observe replay without altering its payload or validating legacy rows more strictly.
 * Qimen/Liuyao reconstruct inputs even when result_data exists. Meihua can fall back
 * to input_data; Xiaoliuren cannot. Missing results are not assigned a fake version.
 */
export function getHistoryReplayMode(
  type: HistoryType,
  row: Record<string, unknown>,
): HistoryReplayMode | 'legacy-input-recompute' | 'unavailable' {
  if (type === 'hepan' || type === 'meihua' || type === 'xiaoliuren') {
    if (row.result_data && typeof row.result_data === 'object') return 'saved-result';
    if (type === 'hepan') return 'legacy-input-recompute';
    if (type === 'meihua' && row.input_data && typeof row.input_data === 'object') {
      return 'legacy-input-recompute';
    }
    return 'unavailable';
  }
  return HISTORY_CONFIG[type].replay.mode;
}

function getModelNameFromConversation(row: Record<string, unknown>): string | undefined {
  const sourceData = (row.conversation as { source_data?: Record<string, unknown> } | null)?.source_data;
  const modelId = typeof sourceData?.model_id === 'string' ? sourceData.model_id : null;
  return modelId ?? undefined;
}

function truncateTitle(title: string) {
  return title.length > 18 ? `${title.slice(0, 18)}...` : title;
}

function trimmedText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const HEPAN_TITLES: Record<string, string> = {
  love: '情侣合盘',
  business: '商业合盘',
  family: '亲子合盘',
};

const TAROT_SPREAD_NAMES: Record<string, string> = {
  single: '单牌',
  'three-card': '三牌阵',
  love: '爱情牌阵',
  'celtic-cross': '凯尔特十字',
};

const PALM_HAND_NAMES: Record<string, string> = { left: '左手', right: '右手' };

/** A registered analysis type's display name, shared by the palm and face history rows. */
const analysisName = (types: readonly { id: string; name: string }[], id: string) =>
  types.find(item => item.id === id)?.name;

export async function buildHistorySummary(
  type: HistoryType,
  row: Record<string, unknown>,
): Promise<HistorySummaryItem> {
  const base = {
    id: String(row.id),
    createdAt: String(row.created_at || ''),
    modelName: getModelNameFromConversation(row),
    conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
  };

  if (type === 'hepan') {
    const hepanType = row.type as string;
    return {
      ...base,
      title: HEPAN_TITLES[hepanType] || '合盘分析',
      question: `${row.person1_name || ''} & ${row.person2_name || ''}`,
      subType: hepanType,
      metric: typeof row.compatibility_score === 'number' ? `${row.compatibility_score}%` : undefined,
    };
  }

  if (type === 'mbti') {
    const mbtiType = String(row.mbti_type || '未知') as MBTIType;
    const personalityTitle = PERSONALITY_BASICS[mbtiType]?.title || `${mbtiType} 人格`;
    const percentages = row.percentages as {
      EI?: { E?: number; I?: number };
      SN?: { S?: number; N?: number };
      TF?: { T?: number; F?: number };
      JP?: { J?: number; P?: number };
    } | null | undefined;
    return {
      ...base,
      title: mbtiType,
      question: personalityTitle,
      badges: percentages ? [
        `E${percentages.EI?.E ?? 50}% / I${percentages.EI?.I ?? 50}%`,
        `S${percentages.SN?.S ?? 50}% / N${percentages.SN?.N ?? 50}%`,
        `T${percentages.TF?.T ?? 50}% / F${percentages.TF?.F ?? 50}%`,
        `J${percentages.JP?.J ?? 50}% / P${percentages.JP?.P ?? 50}%`,
      ] : undefined,
    };
  }

  if (type === 'tarot') {
    const spreadId = row.spread_id as string;
    return {
      ...base,
      title: TAROT_SPREAD_NAMES[spreadId] || spreadId || '塔罗占卜',
      question: trimmedText(row.question),
      badges: Array.isArray(row.cards)
        ? row.cards
          .slice(0, 3)
          .map((card) => {
            const label = ((card as { card?: { nameChinese?: string } }).card?.nameChinese || '').trim();
            const orientation = (card as { orientation?: string }).orientation;
            if (!label) return '';
            return orientation === 'reversed' ? `${label} (逆)` : label;
          })
          .filter((value): value is string => value.length > 0)
        : undefined,
    };
  }

  if (type === 'liuyao') {
    const { findHexagram } = await import('@/lib/divination/liuyao');
    const hexagram = findHexagram(String(row.hexagram_code || ''));
    const changedHexagram = row.changed_hexagram_code
      ? findHexagram(String(row.changed_hexagram_code))
      : undefined;
    return {
      ...base,
      title: hexagram?.name || '未知卦',
      changedTitle: changedHexagram?.name,
      question: trimmedText(row.question),
      metric: Array.isArray(row.changed_lines) && row.changed_lines.length > 0
        ? `变爻：${(row.changed_lines as number[]).map((line) => `第${line}爻`).join('、')}`
        : undefined,
    };
  }

  if (type === 'palm') {
    const hand = PALM_HAND_NAMES[String(row.hand_type || '')] || '';
    const analysis = analysisName(PALM_ANALYSIS_TYPES, String(row.analysis_type || '')) || '手相分析';
    return {
      ...base,
      title: truncateTitle(`${hand}${analysis}`),
      badges: [hand, analysis].filter((value): value is string => value.length > 0),
    };
  }

  if (type === 'face') {
    const analysis = analysisName(FACE_ANALYSIS_TYPES, String(row.analysis_type || '')) || '面相分析';
    return {
      ...base,
      title: truncateTitle(analysis),
      badges: [analysis],
    };
  }

  if (type === 'qimen') {
    const dunText = row.dun_type === 'yang' ? '阳遁' : '阴遁';
    return {
      ...base,
      title: `${dunText}${row.ju_number}局`,
      question: trimmedText(row.question),
    };
  }

  if (type === 'daliuren') {
    const resultData = row.result_data as Record<string, unknown> | null;
    const keName = typeof resultData?.keName === 'string' ? resultData.keName : `${row.day_ganzhi as string}日`;
    return {
      ...base,
      title: truncateTitle(keName),
      question: trimmedText(row.question),
    };
  }

  if (type === 'meihua') {
    const changedHexagram = trimmedText(row.changed_hexagram);
    return {
      ...base,
      title: truncateTitle(String(row.main_hexagram || '梅花易数')),
      changedTitle: changedHexagram,
      question: trimmedText(row.question),
      badges: typeof row.method === 'string' ? [row.method] : undefined,
    };
  }

  if (type === 'xiaoliuren') {
    return {
      ...base,
      title: truncateTitle(String(row.final_status || '小六壬')),
      question: trimmedText(row.question),
      badges: [
        row.is_leap_month ? `闰${row.lunar_month}月` : `${row.lunar_month}月`,
        `${row.lunar_day}日`,
        typeof row.shichen === 'string' ? row.shichen : '',
      ].filter((value): value is string => Boolean(value)),
    };
  }

  return {
    ...base,
    title: '未知记录',
  };
}

export async function buildHistoryRestorePayload(
  type: HistoryType,
  row: Record<string, unknown>,
  defaultTimeZone: string,
): Promise<HistoryRestorePayload> {
  const config = HISTORY_CONFIG[type];
  const base = { sessionKey: config.sessionKey, detailPath: config.detailPath };
  const conversationId = row.conversation_id || null;

  if (type === 'liuyao') {
    const { findHexagram } = await import('@/lib/divination/liuyao');
    const hexagramCode = String(row.hexagram_code || '');
    const changedLines = Array.isArray(row.changed_lines) ? row.changed_lines as number[] : [];
    const yaos = hexagramCode.split('').map((char, index) => ({
      type: Number.parseInt(char, 10) as 0 | 1,
      change: changedLines.includes(index + 1) ? 'changing' as const : 'stable' as const,
      position: index + 1,
    }));

    return {
      ...base,
      sessionData: {
        question: row.question,
        yaos,
        hexagram: findHexagram(hexagramCode),
        changedHexagram: row.changed_hexagram_code ? findHexagram(String(row.changed_hexagram_code)) : undefined,
        changedLines,
        yongShenTargets: Array.isArray(row.yongshen_targets)
          ? (row.yongshen_targets as string[]).filter((item): item is '父母' | '兄弟' | '子孙' | '妻财' | '官鬼' =>
            ['父母', '兄弟', '子孙', '妻财', '官鬼'].includes(item))
          : [],
        divinationId: row.id,
        createdAt: row.created_at,
        conversationId,
      },
    };
  }

  if (type === 'mbti') {
    return {
      ...base,
      sessionData: {
        type: row.mbti_type,
        scores: row.scores || { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 },
        percentages: row.percentages || {
          EI: { E: 50, I: 50 },
          SN: { S: 50, N: 50 },
          TF: { T: 50, F: 50 },
          JP: { J: 50, P: 50 },
        },
        readingId: row.id,
        conversationId,
      },
    };
  }

  if (type === 'tarot') {
    const { TAROT_SPREADS } = await import('@/lib/divination/tarot');
    const spreadId = String(row.spread_id || '');
    const metadata = row.metadata && typeof row.metadata === 'object'
      ? row.metadata as Record<string, unknown>
      : {};
    return {
      ...base,
      useTimestamp: config.useTimestamp,
      sessionData: {
        spread: TAROT_SPREADS.find((item) => item.id === spreadId),
        spreadId,
        cards: Array.isArray(row.cards) ? row.cards : [],
        question: row.question || '',
        birthDate: typeof metadata.birthDate === 'string' ? metadata.birthDate : '',
        numerology: metadata.numerology || null,
        seed: typeof metadata.seed === 'string' ? metadata.seed : null,
        readingId: row.id,
        createdAt: row.created_at,
        conversationId,
      },
    };
  }

  if (type === 'hepan') {
    if (row.result_data && typeof row.result_data === 'object') {
      return {
        ...base,
        sessionData: {
          ...(row.result_data as Record<string, unknown>),
          chartId: row.id,
          conversationId,
        },
      };
    }

    const { analyzeCompatibility } = await import('@/lib/divination/hepan');
    const birth1 = row.person1_birth as Omit<import('@/lib/divination/hepan').BirthInfo, 'name'>;
    const birth2 = row.person2_birth as Omit<import('@/lib/divination/hepan').BirthInfo, 'name'>;
    const result = analyzeCompatibility(
      { name: String(row.person1_name || ''), ...birth1 },
      { name: String(row.person2_name || ''), ...birth2 },
      row.type as 'love' | 'business' | 'family',
    );
    return {
      ...base,
      sessionData: {
        ...result,
        chartId: row.id,
        conversationId,
      },
    };
  }

  if (type === 'palm') {
    return {
      ...base,
      sessionData: {
        readingId: row.id,
        analysisType: row.analysis_type,
        handType: row.hand_type,
        createdAt: row.created_at,
        conversationId,
      },
    };
  }

  if (type === 'face') {
    return {
      ...base,
      sessionData: {
        readingId: row.id,
        analysisType: row.analysis_type,
        createdAt: row.created_at,
        conversationId,
      },
    };
  }

  if (type === 'qimen') {
    const { fromStoredQimenZhiFuJiGong } = await import('@/lib/divination/qimen');
    return {
      ...base,
      sessionData: {
        year: row.year,
        month: row.month,
        day: row.day,
        hour: row.hour,
        minute: row.minute,
        timezone: row.timezone || defaultTimeZone,
        question: row.question,
        panType: row.pan_type || 'zhuan',
        juMethod: row.ju_method || 'chaibu',
        zhiFuJiGong: fromStoredQimenZhiFuJiGong(
          typeof row.zhi_fu_ji_gong === 'string' ? row.zhi_fu_ji_gong : null,
        ),
        createdAt: row.created_at,
        chartId: row.id,
        conversationId,
      },
    };
  }

  if (type === 'meihua') {
    return {
      ...base,
      sessionData: {
        input: row.input_data && typeof row.input_data === 'object' ? row.input_data : undefined,
        resultData: row.result_data && typeof row.result_data === 'object' ? row.result_data : undefined,
        divinationId: row.id,
        conversationId: conversationId || undefined,
      },
    };
  }

  if (type === 'xiaoliuren') {
    return {
      ...base,
      sessionData: {
        resultData: row.result_data && typeof row.result_data === 'object' ? row.result_data : undefined,
        divinationId: row.id,
        conversationId: conversationId || undefined,
      },
    };
  }

  const settings = (row.settings as Record<string, unknown>) || {};
  return {
    ...base,
    useTimestamp: config.useTimestamp,
    sessionData: {
      date: row.solar_date,
      hour: settings.hour ?? 0,
      minute: settings.minute ?? 0,
      timezone: settings.timezone ?? defaultTimeZone,
      question: row.question || undefined,
      divinationId: row.id,
      conversationId: conversationId || undefined,
    },
  };
}
