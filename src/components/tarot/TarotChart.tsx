'use client';
import type { TarotCanonicalJSON } from 'taibu-core/tarot';
import { findTarotCardByChineseName } from '@/lib/divination/tarot';
import { TarotCardFace } from './TarotCardFace';
import { TarotMeaningList, TarotOrientationChip, TarotPositionLabel } from './TarotSpreadParts';
import { getTarotSpreadGridClass } from './tarot-display';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';

export function TarotChart({ chart, interaction }: { chart: TarotCanonicalJSON; interaction?: ChartInteraction }) {
  const cards = chart.牌阵展开;
  return <section className="@container flex flex-col gap-4">
    <h2 className="font-display text-lg font-medium">{chart.问卜设定.牌阵}</h2>
    {chart.问卜设定.问题 && <p className="rounded-xl bg-panel px-4 py-3 text-center font-display text-[15px] leading-relaxed">{chart.问卜设定.问题}</p>}
    <div className={`grid justify-items-center gap-x-2 gap-y-5 ${getTarotSpreadGridClass(cards.length)}`}>{cards.map((card, index) => {
      const artwork = findTarotCardByChineseName(card.塔罗牌);
      const reversed = card.状态 === '逆位';
      return <article key={`${card.位置}:${index}`} className="flex w-full min-w-0 flex-col items-center gap-2 rounded-xl p-1 text-center" data-chart-selected={isChartTargetSelected(interaction, 'tarot:card:' + index) || undefined}>
        <h3 className="max-w-full"><ChartTarget interaction={interaction} id={'tarot:card:' + index}><TarotPositionLabel index={index}>{card.位置}</TarotPositionLabel></ChartTarget></h3>
        <div className="relative aspect-[4/7] w-full max-w-[112px] overflow-hidden rounded-[10px] border-[0.5px] border-border bg-surface shadow-[var(--shadow-md)] @md:max-w-[140px]">
          {artwork ? <TarotCardFace image={artwork.image} name={card.塔罗牌} reversed={reversed} /> : <span className="flex h-full items-center justify-center p-3 font-display text-sm">{card.塔罗牌}</span>}
        </div>
        <p className="text-[13px] font-medium">{card.塔罗牌}</p>
        <TarotOrientationChip reversed={reversed} />
      </article>;
    })}</div>
    <TarotMeaningList entries={cards.map((card, index) => ({
      key: `${card.位置}:${index}`,
      name: card.塔罗牌,
      reversed: card.状态 === '逆位',
      keywords: card.核心基调,
      element: card.元素,
      astro: card.星象,
    }))} />
  </section>;
}
