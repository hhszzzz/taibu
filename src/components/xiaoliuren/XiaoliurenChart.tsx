'use client';
// 'use client'：对话命盘中的 ChartTarget 需要点击交互，掌诀 SVG 依赖 useId。

import { useMemo, useState, type ReactNode } from 'react';
import type { XiaoliurenCanonicalJSON } from 'taibu-core/xiaoliuren';
import { LUNAR_DAY_NAMES, LUNAR_MONTH_NAMES } from '@/components/bazi/form/options';
import { wuxingChipClass } from '@/components/liuyao/wuxing-tone';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';
import { XiaoliurenCountDetail, type XiaoliurenStageSummary } from '@/components/xiaoliuren/XiaoliurenCountDetail';
import { XiaoliurenDial } from '@/components/xiaoliuren/XiaoliurenDial';
import { XiaoliurenPalm } from '@/components/xiaoliuren/XiaoliurenPalm';
import {
  XIAOLIUREN_PALACES,
  XIAOLIUREN_PALACE_NATURE,
  buildXiaoliurenCountStages,
  isXiaoliurenPalace,
  type XiaoliurenStageKey,
} from '@/components/xiaoliuren/xiaoliuren-count';

const STEP_KEYS = ['月上起', '日上落', '时上落'] as const;
const STAGE_KEYS: readonly XiaoliurenStageKey[] = ['month', 'day', 'hour'];
const AUSPICIOUS = XIAOLIUREN_PALACES.filter((palace) => XIAOLIUREN_PALACE_NATURE[palace] === '吉').join(' · ');
const INAUSPICIOUS = XIAOLIUREN_PALACES.filter((palace) => XIAOLIUREN_PALACE_NATURE[palace] === '凶').join(' · ');

const BOARD_VIEWS = [
  { id: 'palm', label: '掌诀' },
  { id: 'dial', label: '圆盘' },
] as const;
type BoardView = typeof BOARD_VIEWS[number]['id'];

/** 释义固定为「X时，五行属…。临Y，凡谋事主Z。…」，拆出副标题；格式不符时返回 null。 */
const DESCRIPTION_PATTERN = /^([^，。]+时)，.*?临([^，。]+)，凡谋事主([^。]+)。/u;

function describePalace(description: string | undefined) {
  const match = description ? DESCRIPTION_PATTERN.exec(description) : null;
  return match ? { moment: match[1], deity: `临${match[2]}`, numbers: `主${match[3]}` } : null;
}

const NATURE_CHIP: Record<string, string> = {
  吉: 'bg-wood-soft text-success',
  凶: 'bg-fire-soft text-danger',
  半吉半凶: 'bg-earth-soft text-earth',
};

export function XiaoliurenChart({ chart, interaction, action }: {
  chart: XiaoliurenCanonicalJSON;
  interaction?: ChartInteraction;
  /** 右栏底部的操作区（结果页放「让太卜结合所问解读」）；对话命盘不传。 */
  action?: ReactNode;
}) {
  const [view, setView] = useState<BoardView>('palm');
  const info = chart.起课信息;
  const chain = chart.推演链;
  const result = chart.结果;
  const isLeapMonth = info.闰月 === true;

  const stages = useMemo(() => buildXiaoliurenCountStages({
    lunarMonth: info.农历月,
    lunarDay: info.农历日,
    hour: info.时辰序号,
    monthStatus: chain.月上起,
    dayStatus: chain.日上落,
    hourStatus: chain.时上落,
  }), [chain.日上落, chain.时上落, chain.月上起, info.农历日, info.农历月, info.时辰序号]);

  const steps: XiaoliurenStageSummary[] = STAGE_KEYS.map((key, index) => ({ key, landing: chain[STEP_KEYS[index]] }));
  const highlightedStages = STAGE_KEYS.filter((_, index) => isChartTargetSelected(interaction, 'xiaoliuren:step:' + index));
  const lunarLabel = `农历${isLeapMonth ? '闰' : ''}${LUNAR_MONTH_NAMES[info.农历月] ?? `${info.农历月}月`}${LUNAR_DAY_NAMES[info.农历日] ?? `${info.农历日}日`} · ${info.时辰}`;
  const monthStatus = isXiaoliurenPalace(chain.月上起) ? chain.月上起 : undefined;
  const dayStatus = isXiaoliurenPalace(chain.日上落) ? chain.日上落 : undefined;
  const hourStatus = isXiaoliurenPalace(chain.时上落) ? chain.时上落 : undefined;
  const palaceDetail = describePalace(result.释义);

  return (
    <div className="flex flex-wrap items-stretch gap-3 lg:gap-6">
      <section aria-label="掌诀推演" className="flex min-w-0 flex-[1_1_440px] flex-col gap-1 rounded-2xl border-[0.5px] border-border bg-surface px-3 py-3.5 sm:gap-3 sm:rounded-[18px] sm:px-6 sm:pt-5 sm:pb-[22px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-foreground-secondary sm:text-[0.8125rem]">
            <span className="sm:hidden">{view === 'palm' ? '左手掌诀 · 顺时针掐数' : '六宫圆盘 · 顺时针掐数'}</span>
            <span className="hidden sm:inline">{lunarLabel} · {view === 'palm' ? '左手掌诀' : '六宫圆盘'}</span>
          </span>
          <div role="group" aria-label="盘面样式" className="flex shrink-0 rounded-lg bg-background-secondary p-0.5 sm:rounded-[9px]">
            {BOARD_VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
                className={`h-6 rounded-md px-2.5 text-xs transition-colors sm:h-7 sm:rounded-[7px] sm:px-3 sm:text-[0.8125rem] ${view === option.id ? 'bg-surface text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-center">
          {view === 'palm' ? (
            <XiaoliurenPalm
              monthStatus={monthStatus}
              dayStatus={dayStatus}
              hourStatus={hourStatus}
              highlightedStages={highlightedStages}
              ariaLabel={`左手掌诀：食指、中指、无名指六节为六宫，顺时针掐数；${lunarLabel}，月上起${chain.月上起}，日上落${chain.日上落}，时上落${chain.时上落}`}
            />
          ) : (
            <XiaoliurenDial
              monthStatus={monthStatus}
              dayStatus={dayStatus}
              hourStatus={hourStatus}
              highlightedStages={highlightedStages}
              ariaLabel={`小六壬圆盘：六宫顺时针排列；${lunarLabel}，月上起${chain.月上起}，日上落${chain.日上落}，时上落${chain.时上落}`}
            />
          )}
        </div>
        <div className="hidden flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-foreground-secondary sm:flex">
          <span><span className="mr-2 text-success">吉</span>{AUSPICIOUS}</span>
          <span><span className="mr-2 text-danger">凶</span>{INAUSPICIOUS}</span>
        </div>
        <p className="hidden border-t-[0.5px] border-border pt-3 text-center text-xs leading-relaxed text-foreground-secondary sm:block">
          左手掌心朝己，食指根节起大安，顺时针经三指指尖至无名指根，回中指根为一周；拇指逐节掐数。
        </p>
      </section>

      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 lg:gap-4">
        <section
          className="flex flex-col gap-2.5 rounded-2xl border-[0.5px] border-border bg-surface p-4 sm:gap-3.5 sm:rounded-[18px] sm:p-6"
          data-chart-selected={isChartTargetSelected(interaction, 'xiaoliuren:result') || undefined}
        >
          {/* 窄屏结果页省略小标题（落宫大字即主角）；对话命盘中它是可点目标，始终可见 */}
          <h2 className={`text-[0.8125rem] font-normal text-foreground-secondary ${interaction ? '' : 'sr-only sm:not-sr-only'}`}>
            <ChartTarget interaction={interaction} id="xiaoliuren:result">最终落宫</ChartTarget>
          </h2>
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 sm:gap-x-3">
            <span className="font-display text-[2.375rem] leading-none text-accent-strong sm:text-[2.75rem]">{result.落宫}</span>
            {palaceDetail && (
              <span className="text-xs text-foreground-secondary sm:text-[0.8125rem]" title={result.释义}>
                {palaceDetail.moment} · {palaceDetail.deity}<span className="hidden sm:inline"> · {palaceDetail.numbers}</span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs sm:gap-2 sm:text-[0.8125rem]">
            <span className={`whitespace-nowrap rounded-md px-2 py-0.5 sm:px-2.5 sm:py-[3px] ${wuxingChipClass(result.五行)}`}>五行 {result.五行}</span>
            <span className="whitespace-nowrap rounded-md bg-background-secondary px-2 py-0.5 text-foreground/80 sm:px-2.5 sm:py-[3px]">方位 {result.方位}</span>
            <span className={`whitespace-nowrap rounded-md px-2 py-0.5 sm:px-2.5 sm:py-[3px] ${NATURE_CHIP[result.性质] ?? 'bg-background-secondary text-foreground-secondary'}`}>性质 {result.性质}</span>
            {palaceDetail && <span className="whitespace-nowrap rounded-md bg-background-secondary px-2 py-0.5 text-foreground/80 sm:hidden">{palaceDetail.numbers}</span>}
          </div>
          {!palaceDetail && result.释义 && <p className="text-[0.8125rem] leading-relaxed text-foreground-secondary">{result.释义}</p>}
          {result.诗诀 && (
            <p className="border-t-[0.5px] border-border pt-3 font-display text-sm leading-[1.9] text-foreground/80 sm:pt-3.5">{result.诗诀}</p>
          )}
        </section>

        <XiaoliurenCountDetail
          steps={steps}
          stages={stages}
          isLeapMonth={isLeapMonth}
          shichen={info.时辰}
          interaction={interaction}
        />
        {action}
      </div>
    </div>
  );
}
