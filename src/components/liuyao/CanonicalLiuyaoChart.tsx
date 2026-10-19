'use client';
// 'use client'：对话命盘中的 ChartTarget 需要点击交互。
import type { LiuyaoCanonicalJSON, LiuyaoJSON, LiuyaoYaoJSON } from 'taibu-core/liuyao';
import { HEXAGRAMS, type Yao } from '@/lib/divination/liuyao';
import { parseTraditionalYaoPosition } from '@/lib/divination/liuyao-result-state';
import { HexagramDisplay } from './HexagramDisplay';
import { LiuyaoPillars } from './LiuyaoPillars';
import { wuxingTextClass } from './wuxing-tone';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';
import { HexagramLines } from '@/components/meihua/MeihuaChart';

const DERIVED_KEYS = ['互卦', '错卦', '综卦'] as const;
const FACT_CHIP = 'rounded-md bg-background-secondary px-2 py-0.5 text-xs text-foreground-secondary';

/** 动爻以 Core 的「动静」为准（明动，含「明动·月破」）；旧快照没有该字段时才比对本卦与变卦的卦码。 */
function isMoving(line: LiuyaoYaoJSON, index: number, base: string, changed?: string) {
  if (line.动静) return line.动静.startsWith('明动');
  return Boolean(changed && base[index] !== changed[index]);
}

/** 卦级事实：Core 的卦级分析行原样列出；AI 安全版只有结构化的全局互动，按字段标出，不另行推断。 */
function hexagramFacts(chart: LiuyaoCanonicalJSON & { 全局互动?: LiuyaoJSON['全局互动'] }): string[] {
  if (chart.卦级分析.length) return chart.卦级分析;
  const interplay = chart.全局互动;
  if (!interplay) return [];
  return [
    interplay.是否六冲卦 === '是' ? '六冲卦' : '',
    interplay.是否六合卦 === '是' ? '六合卦' : '',
    interplay.冲合趋势 ?? '',
    ...(interplay.冲合转换 ?? []).map(item => item.类型),
    ...(interplay.反伏信息 ?? []).map(item => item.范围 ? `${item.类型}（${item.范围}）` : item.类型),
    ...interplay.组合关系.map(item => `${item.类型}${item.名称 ?? (item.参与者 ?? []).map(part => part.地支).join('')} → ${item.结果五行}`),
  ].filter((fact, index, all) => fact && all.indexOf(fact) === index);
}

export function CanonicalLiuyaoChart({ chart, interaction }: { chart: LiuyaoCanonicalJSON & { 全局互动?: LiuyaoJSON['全局互动'] }; interaction?: ChartInteraction }) {
  const hexagram = HEXAGRAMS.find(row => row.name === chart.卦盘.本卦.卦名);
  const changedHexagram = chart.卦盘.变卦 ? HEXAGRAMS.find(row => row.name === chart.卦盘.变卦?.卦名) : undefined;
  if (!hexagram || (chart.卦盘.变卦 && !changedHexagram)) throw new Error('卦名缺少对应的展示数据');
  const lines = [...chart.六爻].sort((a, b) => (parseTraditionalYaoPosition(a.爻位) ?? 0) - (parseTraditionalYaoPosition(b.爻位) ?? 0));
  if (lines.some((line, index) => parseTraditionalYaoPosition(line.爻位) !== index + 1)) throw new Error('爻位数据不完整');
  // Draw the two returned fixed patterns. This comparison does not cast another reading.
  const yaos: Yao[] = lines.map((line, index) => ({ position: index + 1, type: hexagram.code[index] === '1' ? 1 : 0, change: isMoving(line, index, hexagram.code, changedHexagram?.code) ? 'changing' : 'stable' }));
  const facts = hexagramFacts(chart);
  const body = chart.卦盘.卦身;
  const texts = [
    { name: chart.卦盘.本卦.卦名, lines: [chart.卦盘.本卦.卦辞, chart.卦盘.本卦.象辞] },
    ...(chart.卦盘.变卦 ? [{ name: chart.卦盘.变卦.卦名, lines: [chart.卦盘.变卦.卦辞, chart.卦盘.变卦.象辞] }] : []),
  ].map(item => ({ ...item, lines: item.lines.filter((line): line is string => Boolean(line)) })).filter(item => item.lines.length);
  const movingTexts = chart.卦盘.变卦?.动爻爻辞 ?? [];
  const hiddenLines = lines.filter(line => line.伏神);
  const derived = DERIVED_KEYS.flatMap(key => {
    const value = chart.卦盘[key];
    const code = value && HEXAGRAMS.find(row => row.name === value.卦名)?.code;
    return value && code ? [{ key, name: value.卦名, code }] : [];
  });

  return <div className="@container flex flex-col gap-3">
    <LiuyaoPillars pillars={chart.干支时间} />
    <section aria-label="卦盘" className="rounded-2xl border-[0.5px] border-border bg-surface px-2 pb-3.5 pt-3 @2xl:rounded-2xl @2xl:px-6 @2xl:pb-4">
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
    {(body || facts.length > 0 || (chart.全局神煞?.length ?? 0) > 0) && <section aria-label="卦象要点" className="flex flex-wrap items-center gap-1.5 px-1">
      {body && <span className={FACT_CHIP}>卦身 <span className="font-display text-foreground">{body.地支}</span>{[body.位置, body.状态].filter(Boolean).map(item => ' · ' + item).join('')}</span>}
      {facts.map(fact => <span key={fact} className={FACT_CHIP}>{fact}</span>)}
      {chart.全局神煞?.map(item => <span key={item} className="rounded-md border-[0.5px] border-border px-2 py-0.5 text-xs text-foreground-tertiary">{item}</span>)}
    </section>}
    {(texts.length > 0 || movingTexts.length > 0) && <details className="group rounded-xl border-[0.5px] border-border bg-surface px-3.5 py-2.5">
      <summary className="cursor-pointer list-none text-xs text-foreground-secondary marker:hidden">卦辞与爻辞<span className="ml-1 text-foreground-tertiary group-open:hidden">展开</span></summary>
      <div className="mt-2 flex flex-col gap-2.5 text-[0.8125rem] leading-relaxed">
        {texts.map(item => <div key={item.name} className="flex flex-col gap-0.5">
          <span className="font-display text-foreground">{item.name}</span>
          {item.lines.map(line => <p key={line} className="text-foreground-secondary">{line}</p>)}
        </div>)}
        {movingTexts.length > 0 && <div className="flex flex-col gap-0.5">
          <span className="font-display text-foreground">动爻爻辞</span>
          {movingTexts.map(item => <p key={item.爻名} className="text-foreground-secondary">{item.爻辞}</p>)}
        </div>}
      </div>
    </details>}
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
