/**
 * TypeScript type definitions for all 15 chart data structures.
 */

import type { FortuneDimensionKey } from './dimensions';
import type { WuxingElement } from './chart-theme';

export type { WuxingElement } from './chart-theme';

export interface BaseChartData {
  chartType: string;
  title: string;
  subtitle?: string;
}

// --- 1. LifeFortuneTrend ---
export interface LifeFortuneTrendData extends BaseChartData {
  chartType: 'life_fortune_trend';
  data: {
    currentAge: number;
    currentYear: number;
    periods: Array<{
      label: string;
      startAge: number;
      endAge: number;
      startYear: number;
      endYear: number;
      scores: Partial<Record<FortuneDimensionKey, number>>;
      /** 模型只给一个综合分、没有分维度分数时的兜底；渲染器用它画概览。 */
      overall?: number;
      summary: string;
      highlights: string[];
      warnings: string[];
      yearlyScores?: Array<{ year: number; age: number; overall: number }>;
    }>;
    lifeHighlight: {
      bestPeriod: { label: string; ages: string; reason: string };
      currentStatus: string;
      nextTurningPoint: { age: number; direction: 'up' | 'down'; reason: string };
    };
  };
}

// --- 2. FortuneRadar ---
export interface FortuneRadarData extends BaseChartData {
  chartType: 'fortune_radar';
  data: {
    period: string;
    scores: Partial<Record<FortuneDimensionKey, {
      score: number;
      label: string;
      trend: 'up' | 'down' | 'stable';
    }>>;
    previousScores?: Partial<Record<FortuneDimensionKey, number>>;
    overallScore: number;
    overallLabel: string;
    topAdvice: string;
  };
}

// --- 3. FortuneCalendar ---
export interface FortuneCalendarData extends BaseChartData {
  chartType: 'fortune_calendar';
  data: {
    year: number;
    month: number;
    days: Array<{
      date: number;
      overallScore: number;
      level: string;
      highlight: string | null;
    }>;
    monthSummary: {
      bestDays: number[];
      cautionDays: number[];
      luckyDayCount: number;
      normalDayCount: number;
      cautionDayCount: number;
    };
  };
}

// --- 4. WuxingEnergy ---
export interface WuxingElementData {
  strength: number;
  level: string;
  stars: string[];
}

export interface WuxingInteraction {
  /** 兼容模型只写一句话的生克说明；缺省时只显示 impact。 */
  from?: WuxingElement;
  to?: WuxingElement;
  type?: string;
  impact: string;
}

export interface WuxingEnergyData extends BaseChartData {
  chartType: 'wuxing_energy';
  data: {
    elements: Record<WuxingElement, WuxingElementData>;
    favorableElement?: WuxingElement;
    unfavorableElement?: WuxingElement;
    advice: string;
    interactions: WuxingInteraction[];
  };
}

// --- 5. LifeTimeline ---
export interface LifeTimelineMilestone {
  age: number;
  year: number;
  label: string;
  type: 'positive' | 'negative' | 'neutral' | 'turning' | 'peak';
  icon: string;
  summary: string;
  detail: string | null;
}

export interface LifeTimelineData extends BaseChartData {
  chartType: 'life_timeline';
  data: {
    currentAge: number;
    milestones: LifeTimelineMilestone[];
  };
}

// --- 6. CompatibilityGauge ---
export interface CompatibilityGaugeData extends BaseChartData {
  chartType: 'compatibility_gauge';
  data: {
    overallScore: number;
    overallLabel: string;
    dimensions: Array<{
      key: string;
      label: string;
      score: number;
      detail: string;
    }>;
    highlights: string[];
    challenges: string[];
    advice: string;
  };
}

// --- 7. DivinationVerdict ---
export interface DivinationVerdictData extends BaseChartData {
  chartType: 'divination_verdict';
  data: {
    verdict: string;
    verdictScore: number;
    confidence: 'high' | 'medium' | 'low';
    question: string;
    keyFactors: Array<{
      factor: string;
      impact: 'positive' | 'negative' | 'neutral';
      detail: string;
    }>;
    timeline: Array<{
      time: string;
      event: string;
      advice: string;
    }>;
    actionAdvice: string;
  };
}

// --- 8. MBTISpectrum ---
export interface MBTISpectrumData extends BaseChartData {
  chartType: 'mbti_spectrum';
  data: {
    type: string;
    typeName: string;
    dimensions: Record<'EI' | 'SN' | 'TF' | 'JP', {
      score: number;
      direction: string;
      label: string;
    }>;
    traits: Array<{
      trait: string;
      description: string;
    }>;
    cognitiveStack: string[];
  };
}

// --- 9. TarotElements ---
export interface TarotElementsData extends BaseChartData {
  chartType: 'tarot_elements';
  data: {
    elements: Record<'fire' | 'water' | 'air' | 'earth', {
      count: number;
      percentage: number;
      label: string;
    }>;
    keywords: string[];
    positions: Array<{
      position: string;
      card: string;
      upright: boolean;
      energy: number;
    }>;
    coreCard: {
      name: string;
      meaning: string;
    };
  };
}

// --- 10. PersonalityPetal ---
export interface PersonalityPetalData extends BaseChartData {
  chartType: 'personality_petal';
  data: {
    traits: Array<{
      key: string;
      label: string;
      score: number;
      description: string;
    }>;
    topTraits: string[];
    summary: string;
  };
}

// --- 11. YearlySparklines ---
export interface YearlySparklinesData extends BaseChartData {
  chartType: 'yearly_sparklines';
  data: {
    year: number;
    dimensions: Array<{
      key: FortuneDimensionKey;
      label: string;
      currentScore: number;
      trend: 'up' | 'down' | 'stable';
      monthlyScores: number[];
    }>;
  };
}

// --- 12. PhysiognomyAnnotation ---
export interface PhysiognomyAnnotationData extends BaseChartData {
  chartType: 'physiognomy_annotation';
  data: {
    type: 'face' | 'palm';
    annotations: Array<{
      region: string;
      label: string;
      rating: 'positive' | 'negative' | 'neutral';
      position: { x: number; y: number };
      detail: string;
    }>;
    overallAssessment: string;
  };
}

// --- 13. FortuneComparison ---
export interface FortuneComparisonData extends BaseChartData {
  chartType: 'fortune_comparison';
  data: {
    periodA: { label: string; year: number };
    periodB: { label: string; year: number };
    dimensions: Array<{
      key: FortuneDimensionKey;
      label: string;
      scoreA: number;
      scoreB: number;
      change: string;
    }>;
    summary: string;
  };
}

// --- 14. CrossSystem ---
export interface CrossSystemData extends BaseChartData {
  chartType: 'cross_system';
  data: {
    systems: Array<{
      name: string;
      scores: Partial<Record<FortuneDimensionKey, number>>;
    }>;
    consensus: Array<{
      dimension: FortuneDimensionKey;
      label: string;
      agreement: number;
      detail: string;
    }>;
    overallAgreement: number;
    advice: string;
  };
}

// --- 15. DreamAssociation ---
export interface DreamAssociationData extends BaseChartData {
  chartType: 'dream_association';
  data: {
    nodes: Array<{
      id: string;
      label: string;
      meaning: string;
      sentiment: 'positive' | 'negative' | 'neutral';
      size: 'large' | 'medium' | 'small';
    }>;
    edges: Array<{
      from: string;
      to: string;
      strength: number;
      label: string;
    }>;
    coreInterpretation: string;
  };
}

export type ChartData =
  | LifeFortuneTrendData
  | FortuneRadarData
  | FortuneCalendarData
  | WuxingEnergyData
  | LifeTimelineData
  | CompatibilityGaugeData
  | DivinationVerdictData
  | MBTISpectrumData
  | TarotElementsData
  | PersonalityPetalData
  | YearlySparklinesData
  | PhysiognomyAnnotationData
  | FortuneComparisonData
  | CrossSystemData
  | DreamAssociationData;

export type ChartType = ChartData['chartType'];

/** 运行时清单：提示词列出的类型与渲染器认的类型都以此为准。 */
export const CHART_TYPES = [
  'life_fortune_trend', 'fortune_radar', 'wuxing_energy', 'life_timeline',
  'personality_petal', 'fortune_calendar', 'compatibility_gauge', 'divination_verdict',
  'mbti_spectrum', 'tarot_elements', 'yearly_sparklines', 'physiognomy_annotation',
  'fortune_comparison', 'cross_system', 'dream_association',
] as const satisfies readonly ChartType[];

export function isChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (CHART_TYPES as readonly string[]).includes(value);
}

// ─── Source-to-ChartType mapping (single source of truth) ───
// Used by both the chat prompt-builder (mention-driven) and divination route configs.

import type { DataSourceType } from '@/lib/data-sources/types';

export const SOURCE_CHART_TYPE_MAP: Record<DataSourceType, readonly ChartType[]> = {
    bazi_chart:          ['life_fortune_trend', 'fortune_radar', 'wuxing_energy', 'life_timeline'],
    ziwei_chart:         ['life_fortune_trend', 'fortune_radar', 'life_timeline'],
    tarot_reading:       ['tarot_elements'],
    liuyao_divination:   ['divination_verdict'],
    mbti_reading:        ['mbti_spectrum', 'personality_petal'],
    hepan_chart:         ['compatibility_gauge'],
    face_reading:        ['physiognomy_annotation'],
    palm_reading:        ['physiognomy_annotation'],
    qimen_chart:         ['divination_verdict'],
    daliuren_divination: ['divination_verdict'],
    meihua_divination:   ['divination_verdict'],
    xiaoliuren_divination: ['divination_verdict'],
    daily_fortune:       ['fortune_calendar', 'yearly_sparklines'],
    monthly_fortune:     ['fortune_calendar', 'yearly_sparklines'],
    ming_record:         [],
};
