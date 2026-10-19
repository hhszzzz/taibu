'use client';
import type { ReactNode } from 'react';
import type { AstrologyCanonicalJSON } from 'taibu-core/astrology';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from './ChartTarget';
import { BoardFacts, FactChips } from './BoardFacts';

type Factor = AstrologyCanonicalJSON['命盘锚点']['太阳'];
type Point = { id: string; label: string; factor: Factor };
const polar = (degree: number, radius: number) => ({ x: 170 + radius * Math.cos((degree - 90) * Math.PI / 180), y: 170 + radius * Math.sin((degree - 90) * Math.PI / 180) });
const hasCoordinate = (factor: Factor) => typeof factor.黄经度 === 'number' && Number.isFinite(factor.黄经度) && factor.黄经度 >= 0 && factor.黄经度 < 360;

export function AstrologyChart({ chart, interaction, includeRelated = true }: { chart: AstrologyCanonicalJSON; interaction?: ChartInteraction; includeRelated?: boolean }) {
  const points: Point[] = chart.本命主星.map((factor, index) => ({ factor, label: factor.因素, id: 'astrology:natal:' + index }));
  for (const name of ['上升', '天顶'] as const) {
    const factor = chart.命盘锚点[name];
    if (factor) points.push({ factor, label: name, id: 'astrology:anchor:' + name });
  }
  const visible = points.filter(point => hasCoordinate(point.factor));
  const activeKeys = new Set(points.flatMap(point => isChartTargetSelected(interaction, point.id) && point.factor.标识 ? [point.factor.标识] : []));
  for (const name of ['太阳', '月亮', '上升', '天顶'] as const) if (interaction?.selectedIds.includes('astrology:anchor:' + name) && chart.命盘锚点[name]?.标识) activeKeys.add(chart.命盘锚点[name]!.标识!);
  const lines: Array<{ from: string; to: string; label: string }> = [];
  chart.本命主星.forEach((planet, index) => planet.关键相位.forEach((aspect, aspectIndex) => {
    if (planet.标识 && aspect.对象标识 && (interaction?.selectedIds.includes('astrology:natal:' + index + ':aspect:' + aspectIndex) || includeRelated && interaction?.selectedIds.includes('astrology:natal:' + index)))
      lines.push({ from: planet.标识, to: aspect.对象标识, label: planet.因素 + aspect.相位 + aspect.对象 });
  }));
  chart.扩展信息?.完整相位矩阵?.本命.forEach((aspect, index) => {
    if (interaction?.selectedIds.includes('astrology:aspect:本命:' + index) && aspect.起点标识 && aspect.终点标识) lines.push({ from: aspect.起点标识, to: aspect.终点标识, label: aspect.起点 + aspect.相位 + aspect.终点 });
  });
  lines.forEach(line => { activeKeys.add(line.from); activeKeys.add(line.to); });
  const row = (id: string, children: ReactNode, className = '') => <li key={id} className={`rounded-lg px-2.5 py-1.5 data-[chart-selected=true]:bg-accent-light ${className}`} data-chart-selected={isChartTargetSelected(interaction, id) || undefined}>{children}</li>;
  const tiers = labelTiers(visible);
  const aspectsOpen = interaction?.selectedIds.some(id => id.startsWith('astrology:aspect:')) || undefined;
  return <div className="@container flex flex-col gap-3">
    {visible.length > 0 && <figure className="chart-astrology-wheel"><svg viewBox="0 0 340 340" role="group" aria-label="原始黄经投影">
      <circle cx="170" cy="170" r="142" fill="none" stroke="currentColor" opacity=".25" /><circle cx="170" cy="170" r="112" fill="none" stroke="currentColor" opacity=".15" />
      {Array.from({ length: 12 }, (_, index) => {
        const from = polar(index * 30, 132), to = polar(index * 30, 142), label = polar(index * 30, 157);
        return <g key={index}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" opacity=".4" /><text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="currentColor">{index * 30}°</text></g>;
      })}
      {chart.扩展信息?.宫位宫头?.map((house, index) => {
        if (typeof house.宫头黄经度 !== 'number' || !Number.isFinite(house.宫头黄经度)) return null;
        const from = polar(house.宫头黄经度, 34), to = polar(house.宫头黄经度, 132);
        return <line key={index} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" opacity={interaction?.selectedIds.includes('astrology:house:' + index) ? .8 : .12} />;
      })}
      {lines.map((line, index) => {
        const from = visible.find(point => point.factor.标识 === line.from), to = visible.find(point => point.factor.标识 === line.to);
        if (!from || !to) return null;
        const a = polar(from.factor.黄经度!, 103), b = polar(to.factor.黄经度!, 103);
        return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="chart-aspect-line"><title>{line.label}</title></line>;
      })}
      {visible.map(point => {
        const spot = polar(point.factor.黄经度!, 103), radius = LABEL_TIERS[tiers.get(point.id) ?? 0], label = polar(point.factor.黄经度!, radius), selected = Boolean(point.factor.标识 && activeKeys.has(point.factor.标识));
        const tick = polar(point.factor.黄经度!, radius > 103 ? radius - 6 : radius + 6);
        return <g key={point.id} data-chart-planet={point.id} data-chart-selected={selected || undefined} role={interaction ? 'button' : undefined} tabIndex={interaction ? 0 : undefined}
          aria-label={'盘面 ' + point.label} aria-pressed={interaction ? selected : undefined} onClick={() => interaction?.onSelect(point.id)} onKeyDown={event => { if (interaction && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); interaction.onSelect(point.id); } }}>
          {Math.abs(radius - 103) > 20 && <line x1={spot.x} y1={spot.y} x2={tick.x} y2={tick.y} stroke="currentColor" opacity=".25" />}
          <circle cx={spot.x} cy={spot.y} r={selected ? 6 : 3.5} fill="currentColor" /><text x={label.x} y={label.y} fontSize="10" textAnchor="middle" dominantBaseline="middle" fill="currentColor">{point.label}</text>
        </g>;
      })}
    </svg><figcaption>黄经投影 · {chart.基础坐标.计算模式} · {chart.基础坐标.黄道体系}</figcaption></figure>}
    {/* 四个锚点一行一项：太阳、月亮的完整数据在主星表里，这里只给星座与宫位。 */}
    <ul aria-label="命盘锚点" className="grid grid-cols-2 gap-1 @xl:grid-cols-4">{(['太阳', '月亮', '上升', '天顶'] as const).map(name => {
      const anchor = chart.命盘锚点[name];
      return anchor ? row('astrology:anchor:' + name, <span className="flex items-baseline gap-1.5 text-[0.8125rem]">
        <ChartTarget interaction={interaction} id={'astrology:anchor:' + name} className="text-foreground-secondary">{name}</ChartTarget>
        <span className="font-display">{anchor.星座}</span><span className="text-xs text-foreground-tertiary">{anchor.宫位}</span>
      </span>, 'border-[0.5px] border-border') : null;
    })}</ul>
    <section aria-label="本命主星" className="flex flex-col gap-1">
      <h3 className="px-1 text-xs text-foreground-tertiary">本命主星</h3>
      <ul className="flex flex-col">{chart.本命主星.map((planet, index) => row('astrology:natal:' + index, <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[0.8125rem] @xl:grid-cols-[4.5rem_10rem_minmax(0,1fr)]">
        <ChartTarget interaction={interaction} id={'astrology:natal:' + index} className="font-medium">{planet.因素}</ChartTarget>
        <span className="text-foreground-secondary">{planet.星座} {planet.黄经.split(' / ')[1] ?? planet.黄经} · {planet.宫位}{planet.逆行 ? ' · 逆行' : ''}</span>
        <span className="col-start-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-foreground-tertiary @xl:col-start-3">{planet.关键相位.map((aspect, aspectIndex) =>
          <ChartTarget key={aspectIndex} interaction={interaction} id={'astrology:natal:' + index + ':aspect:' + aspectIndex}>{aspect.相位}{aspect.对象} {aspect.容许度.toFixed(1)}°</ChartTarget>)}</span>
      </div>, 'border-t-[0.5px] border-border first:border-t-0'))}</ul>
    </section>
    {chart.当前流运触发.length > 0 && <section aria-label="流运触发" className="flex flex-col gap-1">
      <h3 className="px-1 text-xs text-foreground-tertiary">流运触发 · {chart.基础坐标.流运时刻}</h3>
      <ul className="flex flex-col gap-1">{chart.当前流运触发.map((planet, index) => row('astrology:transit:' + index, <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.8125rem]">
        <ChartTarget interaction={interaction} id={'astrology:transit:' + index} className="font-medium">流运{planet.流运星体}</ChartTarget>
        <span className="text-foreground-secondary">{planet.星座} {planet.黄经.split(' / ')[1] ?? planet.黄经}{planet.宫位 ? ` · ${planet.宫位}` : ''}</span>
        <FactChips items={planet.触发相位.map(aspect => `${aspect.相位}${aspect.对象} ${aspect.容许度.toFixed(1)}°`)} tone="accent" />
      </div>, 'border-[0.5px] border-border'))}</ul>
    </section>}
    {(chart.扩展信息?.宫位宫头?.length ?? 0) > 0 && <section aria-label="宫位宫头" className="flex flex-col gap-1">
      <h3 className="px-1 text-xs text-foreground-tertiary">宫头 · {chart.基础坐标.宫制}</h3>
      <ul className="grid grid-cols-3 gap-1 @xl:grid-cols-6">{chart.扩展信息!.宫位宫头!.map((house, index) => row('astrology:house:' + index, <span className="flex flex-col text-xs">
        <ChartTarget interaction={interaction} id={'astrology:house:' + index} className="text-foreground-tertiary">{house.宫位}</ChartTarget>
        <span className="text-[0.8125rem]">{house.宫头星座} <span className="text-foreground-tertiary">{house.宫头黄经.split(' / ')[1] ?? house.宫头黄经}</span></span>
      </span>, 'border-[0.5px] border-border'))}</ul>
    </section>}
    {(chart.扩展信息?.附加点与交点?.length ?? 0) > 0 && <section aria-label="附加点与交点" className="flex flex-col gap-1">
      <h3 className="px-1 text-xs text-foreground-tertiary">附加点与交点</h3>
      <ul className="grid gap-1 @xl:grid-cols-2">{chart.扩展信息!.附加点与交点!.map((point, index) => row('astrology:point:' + index, <span className="flex flex-wrap items-baseline gap-x-2 text-[0.8125rem]">
        <ChartTarget interaction={interaction} id={'astrology:point:' + index} className="font-medium">{point.因素}</ChartTarget>
        <span className="text-foreground-secondary">本命 {point.本命.星座} {point.本命.宫位}</span>
        {point.流运 && <span className="text-foreground-tertiary">流运 {point.流运.星座} {point.流运.宫位}</span>}
      </span>, 'border-[0.5px] border-border'))}</ul>
    </section>}
    {chart.扩展信息?.完整相位矩阵 && <details open={aspectsOpen} className="rounded-xl border-[0.5px] border-border px-3 py-2">
      <summary className="cursor-pointer text-xs text-foreground-secondary">完整相位 · 本命 {chart.扩展信息.完整相位矩阵.本命.length} · 流运 {chart.扩展信息.完整相位矩阵.流运.length}</summary>
      {(['本命', '流运'] as const).map(group => <section key={group} aria-label={group + '相位'} className="mt-2">
        <h4 className="px-1 text-xs text-foreground-tertiary">{group}</h4>
        <ul className="grid gap-x-2 @xl:grid-cols-2">{chart.扩展信息!.完整相位矩阵![group].map((aspect, index) => row('astrology:aspect:' + group + ':' + index,
          <span className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
            <ChartTarget interaction={interaction} id={'astrology:aspect:' + group + ':' + index}>{aspect.起点} <span className="text-foreground-secondary">{aspect.相位}</span> {aspect.终点}</ChartTarget>
            <span className="text-xs tabular-nums text-foreground-tertiary">{aspect.容许度.toFixed(1)}°</span>
          </span>, 'py-1'))}</ul>
      </section>)}
    </details>}
    <details className="rounded-xl border-[0.5px] border-border px-3 py-2">
      <summary className="cursor-pointer text-xs text-foreground-secondary">基础坐标</summary>
      <div className="mt-2"><BoardFacts label="基础坐标" facts={Object.entries(chart.基础坐标).map(([label, value]) => ({ label, value: String(value) }))} /></div>
    </details>
  </div>;
}

/** 标签环：从内到外三档半径。黄经相近（不足 10°）的星体依次换档，避免名字叠在一起。 */
const LABEL_TIERS = [121, 85, 70] as const;
const LABEL_GAP = 10;

function labelTiers(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.factor.黄经度! - b.factor.黄经度!);
  const last: number[] = LABEL_TIERS.map(() => -Infinity);
  const first: number[] = LABEL_TIERS.map(() => Infinity);
  const tiers = new Map<string, number>();
  for (const point of sorted) {
    const degree = point.factor.黄经度!;
    // 末尾的星体还要与环起点的星体比较（359° 与 2° 相邻）。
    let tier = LABEL_TIERS.findIndex((_, index) => degree - last[index] >= LABEL_GAP && first[index] + 360 - degree >= LABEL_GAP);
    if (tier < 0) tier = 0;
    tiers.set(point.id, tier);
    last[tier] = degree;
    if (first[tier] === Infinity) first[tier] = degree;
  }
  return tiers;
}
