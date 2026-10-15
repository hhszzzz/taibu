/**
 * 传统六爻分析组件（多用神分组版）
 * 卦辞爻辞（衬线卡）· 盘面要点 · 用神分析；四柱旬空由结果页的干支条展示。
 * 'use client'：useMemo 汇总盘面要点。
 */
'use client';

import { useMemo, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import type { LiuyaoCanonicalJSON } from 'taibu-core/liuyao';
import { LIU_QIN_TIPS, SHEN_XI_TIPS } from '@/lib/divination/liuyao-term-tips';
import { KONG_WANG_LABELS } from '@/lib/divination/liuyao';
import { buildLiuyaoHighlights } from '@/components/liuyao/liuyao-highlights';
import { wuxingTextClass } from '@/components/liuyao/wuxing-tone';

interface TraditionalAnalysisProps {
    analysis: LiuyaoCanonicalJSON;
    /** 盘面要点卡底部的操作（如「让太卜断这一卦」），作为卡片纵向 flex 的末项渲染，可用 mt-auto 贴底。 */
    highlightAction?: ReactNode;
}

type YongShenCandidate = NonNullable<LiuyaoCanonicalJSON['用神分析'][number]['候选用神']>[number];

const YAO_NAMES = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
/** 应期提示的性质配色：应期为主色，吉期、忌期分别用吉凶色 */
const TIMING_TONES: Record<string, string> = { '应期': 'text-accent-strong', '吉期': 'text-success', '忌期': 'text-danger' };
const SCRIPTURE_LABEL = 'font-sans text-xs text-foreground-secondary';
const SCRIPTURE_TEXT = 'text-[0.9375rem] leading-[1.7] lg:text-base lg:leading-[1.8]';
/** 卦辞卡分节：手机端纯留白分隔，桌面端加细分隔线。 */
const SCRIPTURE_SECTION = 'flex flex-col gap-1 lg:gap-0.5 lg:border-t-[0.5px] lg:border-border lg:pt-3';

function getMovementTone(state?: string): string {
    if (state === 'changing') return 'text-accent-strong';
    if (state === 'hidden_moving') return 'text-warning';
    if (state === 'day_break') return 'text-danger';
    return '';
}

function getPositionLabel(position?: string | number): string {
    if (typeof position === 'string' && position.trim()) return position;
    if (typeof position !== 'number') return '未定位';
    return YAO_NAMES[position - 1] ?? `第${position}爻`;
}

function getCandidateSourceLabel(source?: string): string | null {
    if (source === 'changed') return '变出';
    if (source === 'fushen') return '伏神';
    if (source === 'temporal') return '时空';
    if (source === 'visible') return '显爻';
    return null;
}

function getKongLabel(state?: string): string {
    if (!state || state === 'not_kong') return '';
    return KONG_WANG_LABELS[state as keyof typeof KONG_WANG_LABELS] || state;
}

/** 候选用神：位置、来源与强弱、动静、旬空，便于对照取用说明里的取舍次第 */
function describeCandidate(candidate: YongShenCandidate): string {
    const state = [getCandidateSourceLabel(candidate.来源), candidate.强弱, candidate.动静, getKongLabel(candidate.空亡状态)].filter(Boolean).join('·');
    return `${candidate.六亲}${candidate.纳甲 ?? ''}@${getPositionLabel(candidate.爻位)}${state ? `（${state}）` : ''}`;
}

export function TraditionalAnalysis({
    analysis,
    highlightAction,
}: TraditionalAnalysisProps) {
    const highlights = useMemo(() => buildLiuyaoHighlights(analysis), [analysis]);

    const baseHexagram = analysis.卦盘.本卦;
    const changedHexagram = analysis.卦盘.变卦;
    const movingTexts = changedHexagram?.动爻爻辞 ?? [];
    const hasScripture = Boolean(baseHexagram.卦辞 || movingTexts.length > 0 || changedHexagram?.卦辞);
    const guaShen = analysis.卦盘.卦身;
    const globalShenSha = analysis.全局神煞 ?? [];

    return (
        <div className="flex w-full flex-col gap-3 lg:gap-4">
            <div className={`grid gap-3 lg:gap-4 ${hasScripture ? 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}>
                {hasScripture && (
                    <section aria-label="卦辞爻辞" className="flex flex-col gap-3.5 rounded-2xl border-[0.5px] border-border bg-surface p-4 font-display lg:px-6 lg:py-[22px]">
                        {baseHexagram.卦辞 && (
                            <div className="flex flex-col gap-1 lg:gap-0.5">
                                <span className={SCRIPTURE_LABEL}>本卦卦辞</span>
                                <span className={SCRIPTURE_TEXT}>{baseHexagram.卦辞}</span>
                            </div>
                        )}
                        {movingTexts.map((yaoText) => (
                            <div key={`${yaoText.爻名}-${yaoText.爻辞}`} className={SCRIPTURE_SECTION}>
                                <span className={`${SCRIPTURE_LABEL} lg:text-accent-strong`}>动爻 · {yaoText.爻名}</span>
                                <span className={SCRIPTURE_TEXT}>{yaoText.爻辞}</span>
                            </div>
                        ))}
                        {changedHexagram?.卦辞 && (
                            <div className={SCRIPTURE_SECTION}>
                                <span className={SCRIPTURE_LABEL}>变卦卦辞</span>
                                <span className={SCRIPTURE_TEXT}>{changedHexagram.卦辞}</span>
                            </div>
                        )}
                    </section>
                )}

                <section aria-label="盘面要点" className="flex flex-col gap-2.5 rounded-2xl border-[0.5px] border-border bg-surface p-4 lg:gap-3 lg:bg-panel lg:p-[22px]">
                    <h2 className="font-display text-[1.0625rem] font-medium lg:text-lg lg:font-normal">盘面要点</h2>
                    {highlights.length > 0 && (
                        <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-sm leading-[1.6] marker:text-foreground-tertiary lg:gap-2 lg:text-foreground-secondary">
                            {highlights.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}
                        </ul>
                    )}
                    {analysis.提示.length > 0 && (
                        <ul className="flex flex-col gap-1.5 text-sm leading-[1.6]">
                            {analysis.提示.map((line, index) => (
                                <li key={`tip-${line}-${index}`} className="flex items-start gap-1.5">
                                    <AlertCircle aria-hidden="true" className="mt-[0.3em] h-3.5 w-3.5 shrink-0 text-danger" />
                                    <span>{line}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {(guaShen || globalShenSha.length > 0) && (
                        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground-tertiary">
                            {guaShen && (
                                <span>
                                    卦身 <span className="font-display text-foreground-secondary">{guaShen.地支}</span>
                                    {guaShen.位置 ? `（${guaShen.位置}）` : ''}{guaShen.状态 ? `（${guaShen.状态}）` : ''}
                                </span>
                            )}
                            {globalShenSha.length > 0 && <span>全局神煞 {globalShenSha.join('、')}</span>}
                        </p>
                    )}
                    {highlightAction}
                </section>
            </div>

            {analysis.用神分析.length > 0 && (
                <section aria-label="用神分析" className="overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface">
                    <h2 className="px-5 pt-5 font-display text-lg sm:px-6">用神分析</h2>
                    <div className="divide-y divide-border">
                    {analysis.用神分析.map((group, groupIndex) => {
                        const selectedSourceLabel = getCandidateSourceLabel(group.已选用神.来源);
                        const selectedKongLabel = getKongLabel(group.已选用神.空亡状态);
                        return (
                            <div key={group.目标六亲} className="px-5 py-4 text-[13px] sm:px-6">
                                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                                    <span className="font-display text-base text-accent-strong" title={LIU_QIN_TIPS[group.目标六亲]}>{group.目标六亲}</span>
                                    {groupIndex === 0 && (
                                        <span className="rounded bg-accent px-1.5 py-px text-[11px] text-on-accent">主</span>
                                    )}
                                    <span className="text-foreground-secondary">{group.取用状态}</span>
                                </div>

                                <div className="grid gap-x-6 gap-y-1.5 leading-relaxed text-foreground-secondary md:grid-cols-2">
                                    <div>
                                        <span>用神：</span>
                                        <span className="font-medium text-foreground" title={LIU_QIN_TIPS[group.已选用神.六亲]}>{group.已选用神.六亲}</span>
                                        {group.已选用神.爻位 && <span>{' @'}{getPositionLabel(group.已选用神.爻位)}</span>}
                                        {group.已选用神.是否世爻 && <span className="text-accent-strong">{' · 世位'}</span>}
                                        {group.已选用神.是否应爻 && <span className="text-water">{' · 应位'}</span>}
                                        {selectedSourceLabel && <span>{` · ${selectedSourceLabel}`}</span>}
                                    </div>

                                    <div>
                                        <span>状态：</span>
                                        <span className={getMovementTone(group.已选用神.动静状态)}>{group.已选用神.动静}</span>
                                        <span>{' · '}{group.已选用神.强弱}</span>
                                        {group.已选用神.纳甲 && group.已选用神.五行 && <span>{' · '}<span className={`font-display ${wuxingTextClass(group.已选用神.五行)}`}>{group.已选用神.纳甲}{group.已选用神.五行}</span></span>}
                                        {selectedKongLabel && <span className="text-warning">{` · ${selectedKongLabel}`}</span>}
                                    </div>

                                    {(group.神煞系统?.原神 || group.神煞系统?.忌神 || group.神煞系统?.仇神) && (
                                        <div className="md:col-span-2">
                                            <span>神系：</span>
                                            {[
                                                group.神煞系统?.原神 && <span key="yuan" className="text-success" title={SHEN_XI_TIPS['原神']}>{'原神'}{group.神煞系统.原神}</span>,
                                                group.神煞系统?.忌神 && <span key="ji" className="text-danger" title={SHEN_XI_TIPS['忌神']}>{'忌神'}{group.神煞系统.忌神}</span>,
                                                group.神煞系统?.仇神 && <span key="chou" className="text-warning" title={SHEN_XI_TIPS['仇神']}>{'仇神'}{group.神煞系统.仇神}</span>,
                                            ].filter(Boolean).map((node, i) => <span key={i}>{i > 0 && ' · '}{node}</span>)}
                                        </div>
                                    )}

                                    {group.已选用神.依据 && group.已选用神.依据.length > 0 && (
                                        <div className="md:col-span-2">
                                            <span>判据：</span>
                                            {group.已选用神.依据.join('、')}
                                        </div>
                                    )}

                                    {group.取用说明 && (
                                        <div className="md:col-span-2">
                                            <span>取用：</span>
                                            {group.取用说明}
                                        </div>
                                    )}

                                    {group.候选用神 && group.候选用神.length > 0 && (
                                        <div className="md:col-span-2">
                                            <span>{`候选（${group.候选用神.length}）：`}</span>
                                            {group.候选用神.map(describeCandidate).join('；')}
                                        </div>
                                    )}

                                    {group.应期提示 && group.应期提示.length > 0 && (
                                        <div className="md:col-span-2">
                                            <span>应期提示：</span>
                                            <ul className="mt-1 flex flex-col gap-1">
                                                {group.应期提示.map((rec, index) => {
                                                    const kind = rec.类型 ?? '应期';
                                                    return (
                                                        <li key={`${kind}-${rec.触发}-${index}`}>
                                                            <span className={`mr-1.5 ${TIMING_TONES[kind] ?? ''}`}>{kind}</span>
                                                            <span className="text-foreground">{rec.触发}</span>
                                                            {`${rec.依据.length > 0 ? `（${rec.依据.join('、')}）` : ''} ${rec.说明}`}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    </div>
                </section>
            )}
        </div>
    );
}
