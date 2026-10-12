import { LUNAR_DAY_NAMES, LUNAR_MONTH_NAMES } from '@/components/bazi/form/options';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';
import type { XiaoliurenCountStage, XiaoliurenStageKey } from '@/components/xiaoliuren/xiaoliuren-count';

const STAGE_TITLE: Record<XiaoliurenStageKey, string> = { month: '① 月上', day: '② 日上', hour: '③ 时上' };
const STAGE_INDEX: Record<XiaoliurenStageKey, number> = { month: 0, day: 1, hour: 2 };

export interface XiaoliurenStageSummary {
  key: XiaoliurenStageKey;
  /** 引擎推演链中的落宫原文。 */
  landing: string;
}

interface XiaoliurenCountDetailProps {
  /** 推演链三步（始终展示，保证对话命盘的步骤目标存在）。 */
  steps: readonly XiaoliurenStageSummary[];
  /** 逐指掐数明细；输入不合法时为 null，仅展示三步落宫。 */
  stages: readonly XiaoliurenCountStage[] | null;
  isLeapMonth: boolean;
  shichen: string;
  interaction?: ChartInteraction;
}

function monthName(month: number): string {
  return LUNAR_MONTH_NAMES[month] ?? `第 ${month} 月`;
}

interface StageDescription {
  /** 起数宫位。 */
  from: string;
  /** 所数对象：农历月 / 农历日 / 时辰。 */
  target: string;
  /** 补充说明（闰月递进、实际步数等），不含括号。 */
  note?: string;
  /** 说明仅在宽屏展示（时辰序号只是辅助信息）。 */
  noteWideOnly?: boolean;
}

function describeStage(stage: XiaoliurenCountStage, isLeapMonth: boolean, shichen: string): StageDescription {
  const shifted = stage.count !== stage.nominal;
  if (stage.key === 'month') {
    const target = `${isLeapMonth ? '闰' : ''}${monthName(stage.nominal)}`;
    if (!shifted) return { from: '大安', target };
    return { from: '大安', target, note: `${isLeapMonth ? '闰月递进，' : ''}按${LUNAR_MONTH_NAMES[stage.count] ?? `第 ${stage.count} 步`}数` };
  }
  if (stage.key === 'day') {
    const target = LUNAR_DAY_NAMES[stage.nominal] ?? `${stage.nominal}日`;
    return shifted ? { from: stage.start, target, note: `按第 ${stage.count} 步` } : { from: stage.start, target };
  }
  return { from: stage.start, target: shichen, note: `第 ${shifted ? stage.count : stage.nominal}`, noteWideOnly: !shifted };
}

/** 宽屏「大安起，数九月（…）」；窄屏按设计稿收紧为「大安起数九月」。 */
function StageDescriptionText({ description }: { description: StageDescription }) {
  return (
    <span className="ml-2 text-foreground-secondary">
      {description.from}起<span className="hidden sm:inline">，</span>数{description.target}
      {description.note && <span className={description.noteWideOnly ? 'hidden sm:inline' : undefined}>（{description.note}）</span>}
    </span>
  );
}

export function XiaoliurenCountDetail({ steps, stages, isLeapMonth, shichen, interaction }: XiaoliurenCountDetailProps) {
  const stageByKey = new Map(stages?.map((stage) => [stage.key, stage]) ?? []);
  return (
    <section aria-label="掐数明细" className="flex flex-col gap-3.5 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:gap-4 sm:rounded-[18px] sm:px-6 sm:py-[22px]">
      <span className="text-xs text-foreground-secondary sm:text-[0.8125rem]">掐数明细 · <span className="sm:hidden">每行</span>六宫一周</span>
      {steps.map((step) => {
        const stage = stageByKey.get(step.key);
        const isFinal = step.key === 'hour';
        const targetId = 'xiaoliuren:step:' + STAGE_INDEX[step.key];
        return (
          <div key={step.key} className="flex flex-col gap-1.5 sm:gap-2" data-chart-selected={isChartTargetSelected(interaction, targetId) || undefined}>
            <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] sm:text-sm">
              <span className="min-w-0">
                <span className="font-medium"><ChartTarget interaction={interaction} id={targetId}>{STAGE_TITLE[step.key]}</ChartTarget></span>
                {stage && <StageDescriptionText description={describeStage(stage, isLeapMonth, shichen)} />}
              </span>
              <span className={`shrink-0 font-display text-[0.9375rem] sm:text-base ${isFinal ? 'text-accent-strong' : 'text-foreground'}`}>→ {step.landing}</span>
            </div>
            {stage && (
              <ol className="grid grid-cols-6 gap-[5px] sm:gap-1.5" aria-label={`${STAGE_TITLE[step.key]}逐指掐数`}>
                {stage.chips.map((palace, index) => {
                  const isLanding = index === stage.chips.length - 1;
                  const tone = !isLanding
                    ? 'border-[0.5px] border-border bg-background text-foreground'
                    : isFinal
                      ? 'border-[0.5px] border-accent bg-accent text-on-accent'
                      : 'border border-accent bg-accent-soft text-foreground';
                  const numberTone = !isLanding ? 'text-foreground-tertiary' : isFinal ? 'text-on-accent/80' : 'text-accent-strong';
                  return (
                    <li key={index} className={`flex min-w-0 flex-col items-center rounded-lg pb-1 pt-[3px] sm:gap-px sm:pb-[5px] sm:pt-1 ${tone}`} aria-current={isLanding ? 'step' : undefined}>
                      <span className={`text-[9.5px] tabular-nums sm:text-[0.625rem] ${numberTone}`}>{index + 1}</span>
                      <span className="font-display text-[13px] leading-tight">{palace}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </section>
  );
}
