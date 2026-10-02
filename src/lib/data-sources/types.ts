export const MING_RECORD_SOURCE_TYPE = 'ming_record';

export const DATA_SOURCE_TYPES = [
    'bazi_chart',
    'ziwei_chart',
    'tarot_reading',
    'liuyao_divination',
    'mbti_reading',
    'hepan_chart',
    'face_reading',
    'palm_reading',
    MING_RECORD_SOURCE_TYPE,
    'daily_fortune',
    'monthly_fortune',
    'qimen_chart',
    'daliuren_divination',
    'meihua_divination',
    'xiaoliuren_divination',
] as const;

export type DataSourceType = typeof DATA_SOURCE_TYPES[number];
export type DataSourceTypeInput = DataSourceType | 'record';

export function isDataSourceType(value: unknown): value is DataSourceType {
    return typeof value === 'string' && DATA_SOURCE_TYPES.includes(value as DataSourceType);
}

export function canonicalizeDataSourceType(value: DataSourceTypeInput): DataSourceType {
    return value === 'record' ? MING_RECORD_SOURCE_TYPE : value;
}

export interface DataSourceSummary {
    id: string;
    type: DataSourceType;
    name: string;
    preview: string;
    createdAt: string;
    hepanType?: 'love' | 'business' | 'family';
}

export type DataSourceLoadError = { type: DataSourceType; message: string };
