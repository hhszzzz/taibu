export type PlaceResolutionReason =
    | 'disabled'
    | 'not_found'
    | 'precision_too_low'
    | 'invalid_location';

export interface PlaceResolution {
    resolved: boolean;
    provider: 'amap';
    query: string;
    longitude?: number;
    latitude?: number;
    formattedAddress?: string;
    adcode?: string;
    level?: string;
    reason?: PlaceResolutionReason;
}

export function normalizePlaceQuery(place: string): string {
    return place.trim().replace(/[,\s，]+/gu, '');
}

export function parseLongitude(value: string | number | null | undefined): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= -180 && value <= 180 ? value : undefined;
    }
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= -180 && parsed <= 180 ? parsed : undefined;
}

/** 只到省级/国家级的解析结果不用于真太阳时。 */
const INSUFFICIENT_LEVELS = new Set([
    'province',
    '省',
    '自治区',
    '特别行政区',
    '国家',
]);

export function isAmapPrecisionSufficient(level?: string): boolean {
    const normalized = level?.trim().toLowerCase();
    if (!normalized) return false;
    return !INSUFFICIENT_LEVELS.has(normalized);
}

export function buildPlaceResolutionFallbackMessage(reason?: PlaceResolutionReason): string {
    switch (reason) {
        case 'precision_too_low':
            return '出生地点精度不足，本次不采用真太阳时，请至少选择到城市或区县。';
        case 'not_found':
            return '未解析到出生地点，本次不采用真太阳时。';
        case 'disabled':
            return '地理编码服务未配置，本次不采用真太阳时。';
        case 'invalid_location':
            return '出生地点坐标无效，本次不采用真太阳时。';
        default:
            return '出生地点解析失败，本次不采用真太阳时。';
    }
}
