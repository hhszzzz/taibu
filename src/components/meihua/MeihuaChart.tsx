'use client';
// 'use client'：对话命盘中的 ChartTarget 需要点击交互。

import { ChevronDown } from 'lucide-react';
import type { MeihuaCanonicalJSON } from 'taibu-core/meihua';
import { getBranchElement } from '@/lib/divination/display-helpers';
import { HEXAGRAMS } from '@/lib/divination/liuyao';
import { parseTraditionalYaoPosition } from '@/lib/divination/liuyao-result-state';
import { wuxingTextClass } from '@/components/liuyao/wuxing-tone';
import { buildMeihuaStageRows, formatRelationTerm, type MeihuaStageRow } from '@/components/meihua/meihua-display';
import { ChartTarget, isChartTargetSelected, type ChartInteraction } from '@/components/visualization/ChartTarget';

type HexagramKey = '本卦' | '互卦' | '变卦';
type HexagramTrack = MeihuaCanonicalJSON['卦盘']['本卦'];
type LinePositions = readonly [number, number, number];
/** all：窄屏与宽屏都强调；wide：只在宽屏强调（变卦变爻，与设计稿一致）。 */
type LineEmphasis = 'all' | 'wide';

const LINE_POSITIONS_DESC = [6, 5, 4, 3, 2, 1] as const;
const UPPER_POSITIONS: LinePositions = [6, 5, 4];
const LOWER_POSITIONS: LinePositions = [3, 2, 1];
const STAGE_NOTE: Record<HexagramKey, string> = { 本卦: '初段', 互卦: '中段', 变卦: '后段' };
const SEASON_TONE: Record<string, string> = {
  旺: 'bg-wood-soft text-success',
  相: 'bg-wood-soft text-success',
  休: 'bg-background-secondary text-foreground-secondary',
  囚: 'bg-fire-soft text-danger',
  死: 'bg-fire-soft text-danger',
};
/** 生克标记：窄屏为着色文字，宽屏加浅底标签。 */
const VERB_TONE: Record<string, string> = {
  生: 'text-wood @2xl:bg-wood-soft',
  克: 'text-fire @2xl:bg-fire-soft',
  比和: 'text-foreground-secondary @2xl:bg-background-secondary',
};
const OUTCOME_TONE: Record<string, string> = {
  吉: 'bg-wood-soft text-success',
  平: 'bg-earth-soft text-warning',
  凶: 'bg-fire-soft text-danger',
};
/** 宽屏体 / 用角色的五行实心标签底色。 */
const ROLE_CHIP_WIDE: Record<string, string> = {
  木: '@2xl:bg-wood',
  火: '@2xl:bg-fire',
  土: '@2xl:bg-earth',
  金: '@2xl:bg-metal',
  水: '@2xl:bg-water',
};

/** 通用紧凑六爻（自下而上编号）；亦被六爻派生卦复用。 */
export function HexagramLines({ code, movingLine, id, interaction }: { code: string; movingLine?: number; id: string; interaction?: ChartInteraction }) {
  return (
    <div className="flex flex-col gap-1.5" aria-label="六爻自下而上">
      {LINE_POSITIONS_DESC.map((position) => {
        const yang = code[position - 1] === '1';
        const moving = position === movingLine;
        return (
          <div key={position} data-chart-selected={isChartTargetSelected(interaction, id + ':line:' + position) || undefined} className="flex min-h-4 items-center gap-2">
            <span className={`w-5 text-right text-[10px] tabular-nums ${moving ? 'font-medium text-accent' : 'text-foreground-tertiary'}`}>
              <ChartTarget interaction={interaction} id={id + ':line:' + position}>{position}</ChartTarget>
            </span>
            <span className="flex-1" aria-label={`${position}爻${moving ? '动爻' : ''}`}><LineBar yang={yang} emphasis={moving ? 'all' : undefined} /></span>
            <span className="w-3 text-[10px] text-accent">{moving ? '动' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 单根爻线；阴爻断开。窄屏爻线略浅，强调爻以黏土色标记。 */
function LineBar({ yang, emphasis }: { yang: boolean; emphasis?: LineEmphasis }) {
  const tone = emphasis === 'all' ? 'bg-accent'
    : emphasis === 'wide' ? 'bg-foreground/80 @2xl:bg-accent'
      : 'bg-foreground/80 @2xl:bg-foreground';
  const bar = `block h-2 rounded-[2px] @2xl:h-2.5 @2xl:rounded-[3px] ${tone}`;
  if (yang) return <span className={bar} />;
  return (
    <span className="flex gap-2.5 @2xl:gap-4">
      <span className={`flex-1 ${bar}`} />
      <span className={`flex-1 ${bar}`} />
    </span>
  );
}

function findCode(name: string): string {
  // Looking up the returned hexagram's fixed line pattern does not cast another reading.
  const code = HEXAGRAMS.find((item) => item.name === name)?.code;
  if (!code) throw new Error('卦名缺少对应的展示数据');
  return code;
}

interface TrigramTag {
  role: string;
  /** chip：宽屏为五行实心标签（体 / 用）；stacked：宽屏与卦名上下两行（体互 / 用互）；narrow：只在窄屏显示（变卦）。 */
  roleStyle: 'chip' | 'stacked' | 'narrow';
  name: string;
  element: string;
  /** 对话命盘中可指向的目标（体卦 / 用卦）。 */
  targetId?: string;
}

/** 卦名五行标签：窄屏在爻线上下单行显示，宽屏在爻线左侧上下排列。 */
function TrigramLabel({ tag, interaction, className }: { tag: TrigramTag; interaction?: ChartInteraction; className: string }) {
  const roleClass = tag.roleStyle === 'chip'
    ? `@2xl:rounded @2xl:px-1.5 @2xl:py-px @2xl:text-[0.6875rem] @2xl:leading-tight @2xl:text-background ${ROLE_CHIP_WIDE[tag.element] ?? '@2xl:bg-foreground-secondary'}`
    : tag.roleStyle === 'narrow' ? '@2xl:hidden' : '';
  const role = <span className={roleClass}>{tag.role}</span>;
  return (
    <span className={`flex items-center justify-center gap-1 justify-self-center whitespace-nowrap text-[10.5px] leading-snug @2xl:flex-col @2xl:gap-0.5 @2xl:self-stretch @2xl:text-xs @2xl:leading-[1.4] ${wuxingTextClass(tag.element) || 'text-foreground-secondary'} ${className}`}>
      {tag.targetId ? <ChartTarget interaction={interaction} id={tag.targetId}>{role}</ChartTarget> : role}
      <span>{tag.name}{tag.element}</span>
    </span>
  );
}

interface LineGroupProps {
  code: string;
  positions: LinePositions;
  hexagramId: string;
  emphasisLine?: number;
  interaction?: ChartInteraction;
  className: string;
}

/** 一个经卦的三根爻线（自上而下）。 */
function TrigramLines({ code, positions, hexagramId, emphasisLine, emphasis, interaction, className }: LineGroupProps & { emphasis: LineEmphasis }) {
  return (
    <span aria-hidden="true" className={`flex flex-col gap-1.5 @2xl:gap-[9px] ${className}`}>
      {positions.map((position) => (
        <span key={position} data-chart-selected={isChartTargetSelected(interaction, `${hexagramId}:line:${position}`) || undefined}>
          <LineBar yang={code[position - 1] === '1'} emphasis={position === emphasisLine ? emphasis : undefined} />
        </span>
      ))}
    </span>
  );
}

/** 爻线右侧旁注：宽屏的「九五 动」「变」，对话命盘中另有逐爻可指向的爻位号。 */
function LineNotes({ positions, hexagramId, emphasisLine, note, interaction, className }: LineGroupProps & { note?: string }) {
  return (
    <span className={`flex-col gap-1.5 @2xl:gap-[9px] ${className}`}>
      {positions.map((position) => (
        <span key={position} className="flex h-2 items-center gap-1 text-[0.625rem] leading-tight text-foreground-tertiary @2xl:h-2.5 @2xl:pl-2 @2xl:text-xs">
          {interaction && <ChartTarget interaction={interaction} id={`${hexagramId}:line:${position}`}>{position}</ChartTarget>}
          {position === emphasisLine && note && <span className="hidden text-accent @2xl:inline">{note}</span>}
        </span>
      ))}
    </span>
  );
}

interface HexagramCardProps {
  label: HexagramKey;
  hexagram: HexagramTrack;
  upper: TrigramTag;
  lower: TrigramTag;
  /** 需要以黏土色强调的爻位（本卦动爻 / 变卦变爻）。 */
  emphasisLine?: number;
  emphasis?: LineEmphasis;
  /** 宽屏强调爻右侧旁注。 */
  emphasisNote?: string;
  compactFootnote: string;
  /** 宽屏卡片底部：本卦 / 变卦为卦辞（衬线），互卦为说明文字。 */
  wideFootnote?: { text: string; scripture: boolean };
  featured?: boolean;
  interaction?: ChartInteraction;
}

function HexagramCard({ label, hexagram, upper, lower, emphasisLine, emphasis = 'all', emphasisNote, compactFootnote, wideFootnote, featured = false, interaction }: HexagramCardProps) {
  const id = 'meihua:hexagram:' + label;
  const code = findCode(hexagram.卦名);
  const group = { code, hexagramId: id, emphasisLine, interaction };
  // 对话命盘需要逐爻可指向，窄屏也保留旁注列；普通结果页窄屏只有爻线。
  const notesVisibility = interaction ? 'flex' : 'hidden @2xl:flex';
  return (
    <article
      data-chart-selected={isChartTargetSelected(interaction, id) || undefined}
      className={`flex min-w-0 flex-col items-center gap-2 rounded-[14px] px-1 py-3 @2xl:gap-3.5 @2xl:rounded-2xl @2xl:border-[0.5px] @2xl:border-border @2xl:bg-surface @2xl:p-[22px] @2xl:ring-0 ${featured ? 'bg-accent-light ring-1 ring-inset ring-accent/50' : 'bg-background'}`}
    >
      <span className="text-[0.6875rem] text-foreground-secondary @2xl:text-[0.8125rem]">
        <ChartTarget interaction={interaction} id={id}>{label}</ChartTarget> · {STAGE_NOTE[label]}
      </span>
      <span className="font-display text-[1.0625rem] leading-tight @2xl:text-[1.625rem]">{hexagram.卦名}</span>
      <div className={`grid justify-center gap-y-2 ${interaction ? 'grid-cols-[50px_auto] gap-x-1' : 'grid-cols-[50px]'} @2xl:grid-cols-[44px_120px_44px] @2xl:gap-x-0 @2xl:gap-y-[17px]`}>
        <TrigramLabel tag={upper} interaction={interaction} className="col-start-1 row-start-1" />
        <TrigramLines {...group} positions={UPPER_POSITIONS} emphasis={emphasis} className="col-start-1 row-start-2 @2xl:col-start-2 @2xl:row-start-1" />
        <TrigramLines {...group} positions={LOWER_POSITIONS} emphasis={emphasis} className="col-start-1 row-start-3 mt-2 @2xl:col-start-2 @2xl:row-start-2 @2xl:mt-0" />
        <TrigramLabel tag={lower} interaction={interaction} className="col-start-1 row-start-4 @2xl:row-start-2" />
        <LineNotes {...group} positions={UPPER_POSITIONS} note={emphasisNote} className={`${notesVisibility} col-start-2 row-start-2 @2xl:col-start-3 @2xl:row-start-1`} />
        <LineNotes {...group} positions={LOWER_POSITIONS} note={emphasisNote} className={`${notesVisibility} col-start-2 row-start-3 mt-2 @2xl:col-start-3 @2xl:row-start-2 @2xl:mt-0`} />
      </div>
      <span className="text-[10.5px] text-foreground-tertiary @2xl:hidden">{compactFootnote}</span>
      {wideFootnote && (
        <p className={`hidden text-center leading-[1.7] @2xl:block ${wideFootnote.scripture ? 'font-display text-[15px] text-foreground/80' : 'text-[13px] text-foreground-secondary'}`}>
          {wideFootnote.text}
        </p>
      )}
    </article>
  );
}

/** 体用推演中的一条关系：窄屏卦名不着色、生克为着色文字；宽屏卦名按五行着色、生克为浅底标签。 */
function StageRelation({ row }: { row: MeihuaStageRow }) {
  const { relation } = row;
  if (!relation) return <span className="text-[13px] text-foreground-secondary">{row.text}</span>;
  return (
    <span className="flex flex-col gap-0.5 @2xl:gap-2.5">
      <span className="flex flex-wrap items-center gap-1.5 font-display text-base @2xl:gap-2 @2xl:text-[17px]">
        <span className={`${wuxingTextClass(relation.from)} @max-2xl:text-foreground`}>{formatRelationTerm(relation.from)}</span>
        <span className={`font-sans text-xs @2xl:rounded @2xl:px-1.5 @2xl:py-px ${VERB_TONE[relation.verb] ?? VERB_TONE.比和}`}>
          {relation.verb}{relation.verb === '比和' ? '' : ' →'}
        </span>
        <span className={`${wuxingTextClass(relation.to)} @max-2xl:text-foreground`}>{formatRelationTerm(relation.to)}</span>
      </span>
      <span className="text-xs text-foreground-secondary @2xl:text-[13px]">{row.description}</span>
    </span>
  );
}

/** 判断参考：结果 + 总结，依据收进可展开的列表。 */
function JudgementSummary({ judgement }: { judgement: NonNullable<MeihuaCanonicalJSON['判断参考']> }) {
  const head = (
    <>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${OUTCOME_TONE[judgement.结果] ?? OUTCOME_TONE.平}`}>{judgement.结果}</span>
      <span className="min-w-0 flex-1 font-display text-[15px] leading-relaxed">{judgement.总结}</span>
    </>
  );
  if (judgement.依据.length === 0) return <div className="flex items-baseline gap-2.5 border-t-[0.5px] border-border pt-3">{head}</div>;
  return (
    <details className="group border-t-[0.5px] border-border pt-3">
      <summary className="flex cursor-pointer list-none items-baseline gap-2.5 [&::-webkit-details-marker]:hidden">
        {head}
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-foreground-secondary transition-colors group-hover:text-foreground">
          依据<ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-[18px] text-[13px] leading-relaxed text-foreground-secondary marker:text-foreground-tertiary">
        {judgement.依据.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </details>
  );
}

interface MeihuaChartProps {
  chart: MeihuaCanonicalJSON;
  interaction?: ChartInteraction;
  /** 错卦 / 综卦；结果页按设计稿省略，对话命盘保留以便逐爻指向。 */
  showDerived?: boolean;
}

export function MeihuaChart({ chart, interaction, showDerived = true }: MeihuaChartProps) {
  const board = chart.卦盘;
  const movingLine = parseTraditionalYaoPosition(board.动爻) ?? undefined;
  const bodyIsUpper = board.体卦.所属 === '上卦';
  const bodyTag: TrigramTag = { role: '体', roleStyle: 'chip', name: board.体卦.卦名, element: board.体卦.五行, targetId: 'meihua:trigram:体卦' };
  const useTag: TrigramTag = { role: '用', roleStyle: 'chip', name: board.用卦.卦名, element: board.用卦.五行, targetId: 'meihua:trigram:用卦' };
  // 互卦上下卦中靠体卦一侧为体互（与 core 的体互 / 用互取法一致）；变卦中体卦一侧不变，另一侧为变出之卦。
  const sideTag = (track: HexagramTrack, side: 'upper' | 'lower', roles: { body: string; other: string }, roleStyle: TrigramTag['roleStyle']): TrigramTag => ({
    role: (side === 'upper') === bodyIsUpper ? roles.body : roles.other,
    roleStyle,
    name: side === 'upper' ? track.上卦 : track.下卦,
    element: side === 'upper' ? track.上卦五行 : track.下卦五行,
  });
  const season = chart.体用分析.月令环境;
  const monthElement = getBranchElement(season.月支);
  const guaCi = [
    { label: '本卦卦辞', text: board.本卦.卦辞 },
    { label: '变卦卦辞', text: board.变卦.卦辞 },
  ].filter((item): item is { label: string; text: string } => Boolean(item.text));
  const warnings = chart.起卦信息.警告 ?? [];

  return (
    // 容器查询只作用于后代，宽屏间距放在内层
    <section className="@container">
      <div className="flex flex-col gap-3 @2xl:gap-6">
        <div className="flex flex-col gap-3 @2xl:flex-row @2xl:flex-wrap @2xl:items-baseline @2xl:gap-x-6 @2xl:gap-y-2 @2xl:rounded-xl @2xl:border-[0.5px] @2xl:border-border @2xl:bg-surface @2xl:px-[18px] @2xl:py-3.5">
          {chart.干支时间.length > 0 && (
            <dl className="grid grid-cols-4 rounded-xl bg-panel px-1 py-2.5 @2xl:flex @2xl:gap-x-4 @2xl:rounded-none @2xl:bg-transparent @2xl:p-0">
              {chart.干支时间.map((pillar) => (
                <div key={pillar.柱} className="flex flex-col items-center gap-px @2xl:flex-row">
                  <dt className="text-[11px] text-foreground-secondary @2xl:sr-only">{pillar.柱}</dt>
                  <dd className="font-display text-[17px] @2xl:tracking-[1px]">{pillar.干支}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap justify-center gap-1.5 text-xs @2xl:gap-x-6 @2xl:text-sm">
            <span className="rounded-md bg-background-secondary px-2 py-0.5 text-foreground/80 @2xl:bg-transparent @2xl:p-0 @2xl:text-foreground">
              <span className="@2xl:text-foreground-secondary">月令</span> {season.月支}{monthElement ? `${monthElement}当令` : ''}
            </span>
            {([['体卦', season.体卦], ['用卦', season.用卦]] as const).map(([key, state]) => (
              <span key={key} className={`rounded-md px-2 py-0.5 @2xl:bg-transparent @2xl:p-0 @2xl:text-foreground ${SEASON_TONE[state] ?? SEASON_TONE.休}`}>
                <span className="@2xl:text-foreground-secondary">{key}</span> {state}
              </span>
            ))}
          </div>
        </div>

        <div className={`grid gap-1.5 @2xl:gap-3 ${board.互卦 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <HexagramCard
            label="本卦"
            hexagram={board.本卦}
            upper={bodyIsUpper ? bodyTag : useTag}
            lower={bodyIsUpper ? useTag : bodyTag}
            emphasisLine={movingLine}
            emphasisNote={`${board.动爻} 动`}
            compactFootnote={`${board.动爻} 动`}
            wideFootnote={board.本卦.卦辞 ? { text: board.本卦.卦辞, scripture: true } : undefined}
            featured
            interaction={interaction}
          />
          {board.互卦 && (
            <HexagramCard
              label="互卦"
              hexagram={board.互卦}
              upper={sideTag(board.互卦, 'upper', { body: '体互', other: '用互' }, 'stacked')}
              lower={sideTag(board.互卦, 'lower', { body: '体互', other: '用互' }, 'stacked')}
              compactFootnote="过程"
              wideFootnote={{ text: '事情发展的过程', scripture: false }}
              interaction={interaction}
            />
          )}
          <HexagramCard
            label="变卦"
            hexagram={board.变卦}
            upper={sideTag(board.变卦, 'upper', { body: '体', other: '变' }, 'narrow')}
            lower={sideTag(board.变卦, 'lower', { body: '体', other: '变' }, 'narrow')}
            emphasisLine={movingLine}
            emphasis="wide"
            emphasisNote="变"
            compactFootnote="结局"
            wideFootnote={board.变卦.卦辞 ? { text: board.变卦.卦辞, scripture: true } : undefined}
            interaction={interaction}
          />
        </div>

        {(chart.阶段推演.length > 0 || chart.判断参考) && (
          <section aria-label="体用推演" className="flex flex-col gap-1 rounded-2xl border-[0.5px] border-border bg-surface p-4 @2xl:gap-4 @2xl:px-6 @2xl:py-[22px]">
            <h2 className="font-display text-[1.0625rem] font-medium @2xl:text-xl">体用推演</h2>
            {chart.阶段推演.length > 0 && (
              <div className="flex flex-col @2xl:grid @2xl:grid-cols-3">
                {chart.阶段推演.map((stage, index) => {
                  const id = 'meihua:stage:' + index;
                  return (
                    <div
                      key={id}
                      data-chart-selected={isChartTargetSelected(interaction, id) || undefined}
                      className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-2.5 border-t-[0.5px] border-border py-2.5 @2xl:flex @2xl:flex-col @2xl:items-stretch @2xl:border-t-0 @2xl:px-5 @2xl:py-0 @2xl:first:pl-0 @2xl:last:pr-0 @2xl:[&+&]:border-l-[0.5px]"
                    >
                      <span className="text-xs text-foreground-secondary">
                        <ChartTarget interaction={interaction} id={id}>{stage.阶段}</ChartTarget>
                        <span className="hidden @2xl:inline"> · {stage.落点}</span>
                      </span>
                      <div className="flex min-w-0 flex-col gap-2 @2xl:gap-3">
                        {buildMeihuaStageRows(stage.表达式).map((row) => <StageRelation key={row.text} row={row} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {chart.判断参考 && <JudgementSummary judgement={chart.判断参考} />}
          </section>
        )}

        {guaCi.length > 0 && (
          <section aria-label="卦辞" className="flex flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-4 @2xl:hidden">
            {guaCi.map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <span className="text-xs text-foreground-secondary">{item.label}</span>
                <span className="font-display text-[15px] leading-relaxed">{item.text}</span>
              </div>
            ))}
          </section>
        )}

        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1 border-l-2 border-warning/50 pl-3 text-xs leading-relaxed text-warning">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        {showDerived && board.扩展参考 && (
          <section aria-label="扩展卦象" className="grid grid-cols-2 gap-1.5 @2xl:gap-3">
            {(['错卦', '综卦'] as const).map((key) => {
              const derived = board.扩展参考?.[key];
              const code = derived && HEXAGRAMS.find((row) => row.name === derived.卦名)?.code;
              const id = 'meihua:derived:' + key;
              return derived && code ? (
                <article key={key} className="flex min-w-0 flex-col gap-3 rounded-2xl border-[0.5px] border-border bg-surface p-3 @2xl:p-4" data-chart-selected={isChartTargetSelected(interaction, id) || undefined}>
                  <h3 className="flex items-baseline gap-2 text-xs text-foreground-secondary">
                    <ChartTarget interaction={interaction} id={id}>{key}</ChartTarget>
                    <span className="font-display text-base text-foreground">{derived.卦名}</span>
                  </h3>
                  <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:gap-5">
                    <div className="w-full max-w-[160px] shrink-0"><HexagramLines code={code} id={id} interaction={interaction} /></div>
                    {derived.卦辞 && <p className="min-w-0 font-display text-[13px] leading-relaxed text-foreground-secondary">{derived.卦辞}</p>}
                  </div>
                </article>
              ) : null;
            })}
          </section>
        )}
      </div>
    </section>
  );
}
