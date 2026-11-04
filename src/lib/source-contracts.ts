import { DATA_SOURCE_TYPES, type DataSourceType } from '@/lib/data-sources/types';

export const CONVERSATION_SOURCE_TYPES = [
  'chat',
  'bazi_wuxing',
  'bazi_personality',
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
  'ziwei',
] as const;

export type ConversationSourceType = typeof CONVERSATION_SOURCE_TYPES[number];

export type FeatureUsageBucket =
  | 'chat'
  | 'bazi'
  | 'ziwei'
  | 'liuyao'
  | 'tarot'
  | 'palm'
  | 'face'
  | 'mbti'
  | 'hepan'
  | 'fortune'
  | 'qimen'
  | 'daliuren'
  | 'meihua'
  | 'xiaoliuren';

type SourceContractMeta = {
  featureUsageBucket: FeatureUsageBucket;
  questionField?: string;
};

const SOURCE_META: Record<ConversationSourceType, SourceContractMeta> = {
  chat: { featureUsageBucket: 'chat' },
  bazi_wuxing: { featureUsageBucket: 'bazi' },
  bazi_personality: { featureUsageBucket: 'bazi' },
  tarot: { featureUsageBucket: 'tarot', questionField: 'question' },
  liuyao: { featureUsageBucket: 'liuyao', questionField: 'question' },
  mbti: { featureUsageBucket: 'mbti' },
  hepan: { featureUsageBucket: 'hepan' },
  palm: { featureUsageBucket: 'palm' },
  face: { featureUsageBucket: 'face' },
  qimen: { featureUsageBucket: 'qimen', questionField: 'question' },
  daliuren: { featureUsageBucket: 'daliuren', questionField: 'question' },
  meihua: { featureUsageBucket: 'meihua', questionField: 'question' },
  xiaoliuren: { featureUsageBucket: 'xiaoliuren', questionField: 'question' },
  ziwei: { featureUsageBucket: 'ziwei' },
};

const CONVERSATION_SOURCE_TYPE_SET = new Set<string>(CONVERSATION_SOURCE_TYPES);

export const ARCHIVED_SOURCE_TYPES = [...DATA_SOURCE_TYPES] as DataSourceType[];

export function isConversationSourceType(value: unknown): value is ConversationSourceType {
  return typeof value === 'string' && CONVERSATION_SOURCE_TYPE_SET.has(value);
}

export function normalizeConversationSourceType(value?: string | null): ConversationSourceType {
  return isConversationSourceType(value) ? value : 'chat';
}

export function toFeatureUsageBucket(sourceType?: string | null): FeatureUsageBucket {
  return SOURCE_META[normalizeConversationSourceType(sourceType)].featureUsageBucket;
}

// ===== Analysis source types (merged from ai/source-contract.ts) =====

export const ANALYSIS_SOURCE_TYPES = [...CONVERSATION_SOURCE_TYPES];

export type AnalysisSourceType = ConversationSourceType;

export type CommonAnalysisSourceData = {
  schema_version?: 1;
  question?: string | null;
  model_id?: string | null;
  reasoning?: boolean | null;
  reasoning_text?: string | null;
  [key: string]: unknown;
};

export type AnalysisSourceDataMap = {
  chat: CommonAnalysisSourceData;
  bazi_wuxing: CommonAnalysisSourceData & {
    chart_id?: string | null;
    chart_name?: string | null;
    chart_summary?: string | null;
    case_profile_id?: string | null;
    case_profile_updated_at?: string | null;
    case_prompt_snapshot?: string | null;
  };
  bazi_personality: CommonAnalysisSourceData & {
    chart_id?: string | null;
    chart_name?: string | null;
    chart_summary?: string | null;
    case_profile_id?: string | null;
    case_profile_updated_at?: string | null;
    case_prompt_snapshot?: string | null;
  };
  tarot: CommonAnalysisSourceData & {
    cards?: unknown[];
    spread_id?: string | null;
  };
  liuyao: CommonAnalysisSourceData;
  mbti: CommonAnalysisSourceData;
  hepan: CommonAnalysisSourceData;
  palm: CommonAnalysisSourceData;
  face: CommonAnalysisSourceData;
  qimen: CommonAnalysisSourceData & {
    dun_type?: string | null;
    ju_number?: number | null;
    pan_type_label?: string | null;
    ju_method_label?: string | null;
    four_pillars?: unknown;
  };
  daliuren: CommonAnalysisSourceData & {
    ke_name?: string | null;
    day_ganzhi?: string | null;
    hour_ganzhi?: string | null;
    yue_jiang?: string | null;
  };
  meihua: CommonAnalysisSourceData & {
    method?: string | null;
    main_hexagram?: string | null;
    changed_hexagram?: string | null;
    moving_line?: number | null;
  };
  xiaoliuren: CommonAnalysisSourceData & {
    lunar_month?: number | null;
    lunar_day?: number | null;
    shichen?: string | null;
    final_status?: string | null;
  };
  ziwei: CommonAnalysisSourceData & {
    chart_id?: string | null;
    chart_name?: string | null;
    chart_summary?: string | null;
  };
};

export type AnalysisSourceData<T extends AnalysisSourceType = AnalysisSourceType> =
  AnalysisSourceDataMap[T];

export function normalizeAnalysisSourceType(value?: string | null): AnalysisSourceType {
  return normalizeConversationSourceType(value);
}

export function normalizeAnalysisSourceData<T extends AnalysisSourceType>(
  _sourceType: T,
  sourceData: AnalysisSourceData<T>,
): AnalysisSourceData<T> {
  return {
    schema_version: 1,
    ...sourceData,
  };
}

export function getSourceDataModelId(sourceData?: Record<string, unknown> | null): string | null {
  return typeof sourceData?.model_id === 'string' && sourceData.model_id.length > 0
    ? sourceData.model_id
    : null;
}

export function getSourceDataReasoning(sourceData?: Record<string, unknown> | null): string | null {
  return typeof sourceData?.reasoning_text === 'string' && sourceData.reasoning_text.length > 0
    ? sourceData.reasoning_text
    : null;
}
