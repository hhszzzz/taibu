import {
    getDimensionConfig,
    isDimensionKey,
    type FortuneDimensionKey,
} from '@/lib/visualization/dimensions';

export type VisualizationChartStyle = 'modern' | 'classic-chinese' | 'dark';

export interface VisualizationSettings {
    selectedDimensions?: FortuneDimensionKey[];
    dayunDisplayCount?: number;
    chartStyle?: VisualizationChartStyle;
}

const CHART_STYLE_SET = new Set<VisualizationChartStyle>(['modern', 'classic-chinese', 'dark']);

// localStorage key constants — co-located so read/write stay in sync
const LS_KEY_DIMENSIONS = 'fortuneDimensions';
const LS_KEY_DAYUN_PERIODS = 'dayunPeriods';
const LS_KEY_CHART_STYLE = 'chartStyle';

export function isVisualizationChartStyle(value: unknown): value is VisualizationChartStyle {
    return typeof value === 'string' && CHART_STYLE_SET.has(value as VisualizationChartStyle);
}

export function normalizeVisualizationSettings(raw: unknown): VisualizationSettings | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }

    const input = raw as {
        selectedDimensions?: unknown;
        dayunDisplayCount?: unknown;
        chartStyle?: unknown;
    };

    const result: VisualizationSettings = {};

    if (Array.isArray(input.selectedDimensions)) {
        const selectedDimensions = Array.from(new Set(
            input.selectedDimensions.filter((value): value is FortuneDimensionKey => (
                typeof value === 'string' && isDimensionKey(value)
            )),
        ));
        if (selectedDimensions.length > 0) {
            result.selectedDimensions = selectedDimensions;
        }
    }

    if (
        typeof input.dayunDisplayCount === 'number'
        && Number.isInteger(input.dayunDisplayCount)
        && input.dayunDisplayCount >= 3
        && input.dayunDisplayCount <= 10
    ) {
        result.dayunDisplayCount = input.dayunDisplayCount;
    }

    if (isVisualizationChartStyle(input.chartStyle)) {
        result.chartStyle = input.chartStyle;
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

export function readLocalVisualizationSettings(storage: Pick<Storage, 'getItem'>): VisualizationSettings | undefined {
    try {
        const rawDimensions = storage.getItem(LS_KEY_DIMENSIONS);
        const rawPeriods = storage.getItem(LS_KEY_DAYUN_PERIODS);
        const rawStyle = storage.getItem(LS_KEY_CHART_STYLE);

        return normalizeVisualizationSettings({
            selectedDimensions: rawDimensions ? JSON.parse(rawDimensions) : undefined,
            dayunDisplayCount: rawPeriods ? Number.parseInt(rawPeriods, 10) : undefined,
            chartStyle: rawStyle ?? undefined,
        });
    } catch {
        return undefined;
    }
}

export type VisualizationPreferenceLocalInput = {
    selectedDimensions: FortuneDimensionKey[];
    dayunDisplayCount: number;
    chartStyle: VisualizationChartStyle;
};

export function persistLocalVisualizationSettings(
    storage: Pick<Storage, 'setItem'>,
    input: VisualizationPreferenceLocalInput,
) {
    storage.setItem(LS_KEY_DIMENSIONS, JSON.stringify(input.selectedDimensions));
    storage.setItem(LS_KEY_DAYUN_PERIODS, String(input.dayunDisplayCount));
    storage.setItem(LS_KEY_CHART_STYLE, input.chartStyle);
}

/** 用户把运势可视化设为「无」时，客户端也不再上报旧偏好。 */
export function clearLocalVisualizationSettings(storage: Pick<Storage, 'removeItem'>) {
    storage.removeItem(LS_KEY_DIMENSIONS);
    storage.removeItem(LS_KEY_DAYUN_PERIODS);
    storage.removeItem(LS_KEY_CHART_STYLE);
}

export function formatVisualizationDimensions(dimensions: FortuneDimensionKey[]) {
    return dimensions.map((key) => getDimensionConfig(key).label).join('、');
}

export function formatChartStyleLabel(style: VisualizationChartStyle) {
    if (style === 'classic-chinese') return '古典中文图表风格';
    if (style === 'dark') return '深色高对比图表风格';
    return '现代信息图表风格';
}
