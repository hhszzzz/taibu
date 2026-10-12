'use client';
// 'use client'：对话命盘中的 ChartTarget 需要点击交互。
import type { LiuyaoCanonicalJSON } from 'taibu-core/liuyao';
import { HEXAGRAMS, type Yao } from '@/lib/divination/liuyao';
import { parseTraditionalYaoPosition } from '@/lib/divination/liuyao-result-state';
import { HexagramDisplay } from './HexagramDisplay';
import { LiuyaoPillars } from './LiuyaoPillars';
import { wuxingTextClass } from './wuxing-tone';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';
import { HexagramLines } from '@/components/meihua/MeihuaChart';

const DERIVED_KEYS = ['互卦', '错卦', '综卦'] as const;

export function CanonicalLiuyaoChart({ chart, interaction }: { chart: LiuyaoCanonicalJSON; interaction?: ChartInteraction }) {
  const hexagram = HEXAGRAMS.find(row => row.name === chart.卦盘.本卦.卦名);
  const changedHexagram = chart.卦盘.变卦 ? HEXAGRAMS.find(row => row.name === chart.卦盘.变卦?.卦名) : undefined;
  if (!hexagram || (chart.卦盘.变卦 && !changedHexagram)) throw new Error('卦名缺少对应的展示数据');
  const lines = [...chart.六爻].sort((a, b) => (parseTraditionalYaoPosition(a.爻位) ?? 0) - (parseTraditionalYaoPosition(b.爻位) ?? 0));
  if (lines.some((line, index) => parseTraditionalYaoPosition(line.爻位) !== index + 1)) throw new Error('爻位数据不完整');
  // Draw the two returned fixed patterns. This comparison does not cast another reading.
  const yaos: Yao[] = lines.map((_, index) => ({ position: index + 1, type: hexagram.code[index] === '1' ? 1 : 0, change: changedHexagram && hexagram.code[index] !== changedHexagram.code[index] ? 'changing' : 'stable' }));
  const hiddenLines = lines.filter(line => line.伏神);
  const derived = DERIVED_KEYS.flatMap(key => {
    const value = chart.卦盘[key];
    const code = value && HEXAGRAMS.find(row => row.name === value.卦名)?.code;
    return value && code ? [{ key, name: value.卦名, code }] : [];
  });

  return <div className="@container flex flex-col gap-3">
    <LiuyaoPillars pillars={chart.干支时间} />
    <section aria-label="卦盘" className="rounded-2xl border-[0.5px] border-border bg-surface px-2 pb-3.5 pt-3 @2xl:rounded-[18px] @2xl:px-6 @2xl:pb-4">
      <HexagramDisplay
        yaos={yaos}
        hexagram={hexagram}
        changedHexagram={changedHexagram}
        changedLines={yaos.filter(yao => yao.change === 'changing').map(yao => yao.position)}
        fullYaos={lines}
        showTraditional
        showDetails
        interaction={interaction}
        palaces={{ base: chart.卦盘.本卦.卦宫, changed: chart.卦盘.变卦?.卦宫 }}
      />
    </section>
    {hiddenLines.length > 0 && <section aria-label="伏神" className="grid gap-2 @md:grid-cols-2">{hiddenLines.map(line => {
      const id = 'liuyao:line:' + parseTraditionalYaoPosition(line.爻位) + ':hidden';
      return line.伏神 ? <div key={line.爻位} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border-[0.5px] border-border bg-surface px-3.5 py-3" data-chart-selected={isChartTargetSelected(interaction, id) || undefined}>
        <span className="text-xs text-foreground-secondary"><ChartTarget interaction={interaction} id={id}>{line.爻位}伏神</ChartTarget></span>
        <span className="text-sm">{line.伏神.六亲} <span className={`font-display ${wuxingTextClass(line.伏神.五行)}`}>{line.伏神.纳甲}{line.伏神.五行}</span></span>
        {line.伏神.关系 && <span className="text-xs text-foreground-tertiary">{line.伏神.关系}</span>}
      </div> : null;
    })}</section>}
    {derived.length > 0 && <section aria-label="派生卦" className="grid grid-cols-3 gap-1.5 @2xl:gap-3">{derived.map(item => {
      const id = 'liuyao:derived:' + item.key;
      return <article key={item.key} className="flex min-w-0 flex-col gap-2.5 rounded-2xl border-[0.5px] border-border bg-surface p-2.5 @2xl:p-4" data-chart-selected={isChartTargetSelected(interaction, id) || undefined}>
        <h3 className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-foreground-secondary">
          <ChartTarget interaction={interaction} id={id}>{item.key}</ChartTarget>
          <span className="font-display text-sm text-foreground @2xl:text-base">{item.name}</span>
        </h3>
        <HexagramLines code={item.code} id={id} interaction={interaction} />
      </article>;
    })}</section>}
  </div>;
}
