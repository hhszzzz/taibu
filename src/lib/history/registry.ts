import { getModelName } from '@/lib/ai/ai-config';
import { PERSONALITY_BASICS, type MBTIType } from '@/lib/divination/mbti';

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
  summarySelect: string;
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
    summarySelect: 'id, spread_id, question, cards, conversation_id, created_at, conversation:conversations(source_data)',
    useTimestamp: true,
  },
  liuyao: {
    replay: { mode: 'input-recompute', legacyFallback: 'field-defaults' },
    label: '六爻历史',
    tableName: 'liuyao_divinations',
    historyPath: '/liuyao/history',
    detailPath: '/liuyao/result',
    sessionKey: 'liuyao_result',
    summarySelect: 'id, hexagram_code, changed_hexagram_code, changed_lines, question, conversation_id, created_at, conversation:conversations(source_data)',
  },
  mbti: {
    replay: { mode: 'stored-fields', legacyFallback: 'field-defaults' },
    label: 'MBTI历史',
    tableName: 'mbti_readings',
    historyPath: '/mbti/history',
    detailPath: '/mbti/result',
    sessionKey: 'mbti_result',
    summarySelect: 'id, mbti_type, scores, percentages, conversation_id, created_at, conversation:conversations(source_data)',
  },
  hepan: {
    replay: { mode: 'saved-result', legacyFallback: 'input-recompute' },
    label: '合盘历史',
    tableName: 'hepan_charts',
    historyPath: '/hepan/history',
    detailPath: '/hepan/result',
    sessionKey: 'hepan_result',
    summarySelect: 'id, type, person1_name, person2_name, compatibility_score, conversation_id, created_at, conversation:conversations(source_data)',
  },
  palm: {
    replay: { mode: 'stored-fields', legacyFallback: 'field-defaults' },
    label: '手相历史',
    tableName: 'palm_readings',
    historyPath: '/palm/history',
    detailPath: '/palm/result',
    sessionKey: 'palm_result',
    summarySelect: 'id, analysis_type, hand_type, conversation_id, created_at, conversation:conversations(source_data)',
  },
  face: {
    replay: { mode: 'stored-fields', legacyFallback: 'field-defaults' },
    label: '面相历史',
    tableName: 'face_readings',
    historyPath: '/face/history',
    detailPath: '/face/result',
    sessionKey: 'face_result',
    summarySelect: 'id, analysis_type, conversation_id, created_at, conversation:conversations(source_data)',
  },
  qimen: {
    replay: { mode: 'input-recompute', legacyFallback: 'field-defaults' },
    label: '奇门历史',
    tableName: 'qimen_charts',
    historyPath: '/qimen/history',
    detailPath: '/qimen/result',
    sessionKey: 'qimen_result',
    summarySelect: 'id, dun_type, ju_number, question, conversation_id, created_at, conversation:conversations(source_data)',
  },
  daliuren: {
    replay: { mode: 'input-recompute', legacyFallback: 'field-defaults' },
    label: '六壬历史',
    tableName: 'daliuren_divinations',
    historyPath: '/daliuren/history',
    detailPath: '/daliuren/result',
    sessionKey: 'daliuren_params',
    summarySelect: 'id, day_ganzhi, result_data, question, conversation_id, created_at, conversation:conversations(source_data)',
    useTimestamp: true,
  },
  meihua: {
    replay: { mode: 'saved-result', legacyFallback: 'input-recompute' },
    label: '梅花历史',
    tableName: 'meihua_divinations',
    historyPath: '/meihua/history',
    detailPath: '/meihua/result',
    sessionKey: 'meihua_result',
    summarySelect: 'id, question, method, cast_datetime, main_hexagram, changed_hexagram, input_data, result_data, conversation_id, created_at, conversation:conversations(source_data)',
  },
  xiaoliuren: {
    replay: { mode: 'saved-result', legacyFallback: 'unavailable' },
    label: '小六壬历史',
    tableName: 'xiaoliuren_divinations',
    historyPath: '/xiaoliuren/history',
    detailPath: '/xiaoliuren/result',
    sessionKey: 'xiaoliuren_result',
    summarySelect: 'id, question, solar_datetime, lunar_month, lunar_day, is_leap_month, shichen, final_status, input_data, result_data, conversation_id, created_at, conversation:conversations(source_data)',
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
  return modelId ? getModelName(modelId) : undefined;
}

function truncateTitle(title: string) {
  return title.length > 18 ? `${title.slice(0, 18)}...` : title;
}

export async function buildHistorySummary(
  type: HistoryType,
  row: Record<string, unknown>,
): Promise<HistorySummaryItem> {
  const modelName = getModelNameFromConversation(row);

  if (type === 'hepan') {
    const hepanType = row.type as string;
    const title = hepanType === 'love'
      ? '情侣合盘'
      : hepanType === 'business'
        ? '商业合盘'
        : hepanType === 'family'
          ? '亲子合盘'
          : '合盘分析';
    return {
      id: String(row.id),
      title,
      question: `${row.person1_name || ''} & ${row.person2_name || ''}`,
      createdAt: String(row.created_at || ''),
      subType: hepanType,
      modelName,
      metric: typeof row.compatibility_score === 'number' ? `${row.compatibility_score}%` : undefined,
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
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
      id: String(row.id),
      title: mbtiType,
      question: personalityTitle,
      createdAt: String(row.created_at || ''),
      modelName,
      badges: percentages ? [
        `E${percentages.EI?.E ?? 50}% / I${percentages.EI?.I ?? 50}%`,
        `S${percentages.SN?.S ?? 50}% / N${percentages.SN?.N ?? 50}%`,
        `T${percentages.TF?.T ?? 50}% / F${percentages.TF?.F ?? 50}%`,
        `J${percentages.JP?.J ?? 50}% / P${percentages.JP?.P ?? 50}%`,
      ] : undefined,
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'tarot') {
    const spreadNames: Record<string, string> = {
      single: '单牌',
      'three-card': '三牌阵',
      love: '爱情牌阵',
      'celtic-cross': '凯尔特十字',
    };
    const spreadId = row.spread_id as string;
    return {
      id: String(row.id),
      title: spreadNames[spreadId] || spreadId || '塔罗占卜',
      question: typeof row.question === 'string' && row.question.trim() ? row.question.trim() : undefined,
      createdAt: String(row.created_at || ''),
      modelName,
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
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'liuyao') {
    const { findHexagram } = await import('@/lib/divination/liuyao');
    const hexagram = findHexagram(String(row.hexagram_code || ''));
    const changedHexagram = row.changed_hexagram_code
      ? findHexagram(String(row.changed_hexagram_code))
      : undefined;
    return {
      id: String(row.id),
      title: hexagram?.name || '未知卦',
      changedTitle: changedHexagram?.name,
      question: typeof row.question === 'string' && row.question.trim() ? row.question.trim() : undefined,
      createdAt: String(row.created_at || ''),
      modelName,
      metric: Array.isArray(row.changed_lines) && row.changed_lines.length > 0
        ? `变爻：${(row.changed_lines as number[]).map((line) => `第${line}爻`).join('、')}`
        : undefined,
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'palm') {
    const analysisNames: Record<string, string> = {
      full: '综合分析',
      lifeline: '生命线',
      headline: '智慧线',
      heartline: '感情线',
      fateline: '事业线',
      marriage: '婚姻线',
    };
    const handNames: Record<string, string> = { left: '左手', right: '右手' };
    const title = `${handNames[String(row.hand_type || '')] || ''}${analysisNames[String(row.analysis_type || '')] || '手相分析'}`;
    return {
      id: String(row.id),
      title: truncateTitle(title),
      createdAt: String(row.created_at || ''),
      modelName,
      badges: [
        handNames[String(row.hand_type || '')] || '',
        analysisNames[String(row.analysis_type || '')] || '手相分析',
      ].filter((value): value is string => value.length > 0),
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'face') {
    const analysisNames: Record<string, string> = {
      full: '综合分析',
      forehead: '天庭分析',
      eyes: '眼相分析',
      nose: '鼻相分析',
      mouth: '口相分析',
      career: '事业运势',
      love: '感情运势',
      wealth: '财运分析',
    };
    return {
      id: String(row.id),
      title: truncateTitle(analysisNames[String(row.analysis_type || '')] || '面相分析'),
      createdAt: String(row.created_at || ''),
      modelName,
      badges: [analysisNames[String(row.analysis_type || '')] || '面相分析'],
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'qimen') {
    const dunText = row.dun_type === 'yang' ? '阳遁' : '阴遁';
    return {
      id: String(row.id),
      title: `${dunText}${row.ju_number}局`,
      question: typeof row.question === 'string' && row.question.trim() ? row.question.trim() : undefined,
      createdAt: String(row.created_at || ''),
      modelName,
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'daliuren') {
    const resultData = row.result_data as Record<string, unknown> | null;
    const keName = typeof resultData?.keName === 'string' ? resultData.keName : `${row.day_ganzhi as string}日`;
    return {
      id: String(row.id),
      title: truncateTitle(keName),
      question: typeof row.question === 'string' && row.question.trim() ? row.question.trim() : undefined,
      createdAt: String(row.created_at || ''),
      modelName,
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'meihua') {
    const changedHexagram = typeof row.changed_hexagram === 'string' && row.changed_hexagram.trim()
      ? row.changed_hexagram.trim()
      : undefined;
    return {
      id: String(row.id),
      title: truncateTitle(String(row.main_hexagram || '梅花易数')),
      changedTitle: changedHexagram,
      question: typeof row.question === 'string' && row.question.trim() ? row.question.trim() : undefined,
      createdAt: String(row.created_at || ''),
      modelName,
      badges: typeof row.method === 'string' ? [row.method] : undefined,
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  if (type === 'xiaoliuren') {
    return {
      id: String(row.id),
      title: truncateTitle(String(row.final_status || '小六壬')),
      question: typeof row.question === 'string' && row.question.trim() ? row.question.trim() : undefined,
      createdAt: String(row.created_at || ''),
      modelName,
      badges: [
        row.is_leap_month ? `闰${row.lunar_month}月` : `${row.lunar_month}月`,
        `${row.lunar_day}日`,
        typeof row.shichen === 'string' ? row.shichen : '',
      ].filter((value): value is string => Boolean(value)),
      conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    };
  }

  return {
    id: String(row.id),
    title: '未知记录',
    createdAt: String(row.created_at || ''),
    modelName,
  };
}

export async function buildHistoryRestorePayload(
  type: HistoryType,
  row: Record<string, unknown>,
  defaultTimeZone: string,
): Promise<HistoryRestorePayload> {
  const config = HISTORY_CONFIG[type];

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
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
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
        conversationId: row.conversation_id || null,
      },
    };
  }

  if (type === 'mbti') {
    return {
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
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
        conversationId: row.conversation_id || null,
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
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
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
        conversationId: row.conversation_id || null,
      },
    };
  }

  if (type === 'hepan') {
    if (row.result_data && typeof row.result_data === 'object') {
      return {
        sessionKey: config.sessionKey,
        detailPath: config.detailPath,
        sessionData: {
          ...(row.result_data as Record<string, unknown>),
          chartId: row.id,
          conversationId: row.conversation_id || null,
        },
      };
    }

    const { analyzeCompatibility } = await import('@/lib/divination/hepan');
    const birth1 = row.person1_birth as { year: number; month: number; day: number; hour: number };
    const birth2 = row.person2_birth as { year: number; month: number; day: number; hour: number };
    const result = analyzeCompatibility(
      { name: String(row.person1_name || ''), ...birth1 },
      { name: String(row.person2_name || ''), ...birth2 },
      row.type as 'love' | 'business' | 'family',
    );
    return {
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
      sessionData: {
        ...result,
        chartId: row.id,
        conversationId: row.conversation_id || null,
      },
    };
  }

  if (type === 'palm') {
    return {
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
      sessionData: {
        readingId: row.id,
        analysisType: row.analysis_type,
        handType: row.hand_type,
        createdAt: row.created_at,
        conversationId: row.conversation_id || null,
      },
    };
  }

  if (type === 'face') {
    return {
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
      sessionData: {
        readingId: row.id,
        analysisType: row.analysis_type,
        createdAt: row.created_at,
        conversationId: row.conversation_id || null,
      },
    };
  }

  if (type === 'qimen') {
    const { fromStoredQimenZhiFuJiGong } = await import('@/lib/divination/qimen');
    return {
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
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
        conversationId: row.conversation_id || null,
      },
    };
  }

  if (type === 'meihua') {
    return {
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
      sessionData: {
        input: row.input_data && typeof row.input_data === 'object' ? row.input_data : undefined,
        resultData: row.result_data && typeof row.result_data === 'object' ? row.result_data : undefined,
        divinationId: row.id,
        conversationId: row.conversation_id || undefined,
      },
    };
  }

  if (type === 'xiaoliuren') {
    return {
      sessionKey: config.sessionKey,
      detailPath: config.detailPath,
      sessionData: {
        resultData: row.result_data && typeof row.result_data === 'object' ? row.result_data : undefined,
        divinationId: row.id,
        conversationId: row.conversation_id || undefined,
      },
    };
  }

  const settings = (row.settings as Record<string, unknown>) || {};
  return {
    sessionKey: config.sessionKey,
    detailPath: config.detailPath,
    useTimestamp: config.useTimestamp,
    sessionData: {
      date: row.solar_date,
      hour: settings.hour ?? 0,
      minute: settings.minute ?? 0,
      timezone: settings.timezone ?? defaultTimeZone,
      question: row.question || undefined,
      divinationId: row.id,
      conversationId: row.conversation_id || undefined,
    },
  };
}
