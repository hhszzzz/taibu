/**
 * 日运 · 黄历页主体
 *
 * 桌面端：标题 + 日期切换 → 黄历主卡（左栏日期与值日细项，右栏宜忌、冲煞与方位）→ 时辰吉凶 → 运势 | 问答 → 运势详解。
 * 移动端：日期切换 → 日期摘要 + 宜忌 → 运势 → 时辰吉凶 → 方位 → 当日黄历细项 → 运势详解 → 问答。
 * 两端板块顺序不同：DOM 顺序与桌面一致，移动端以 order 重排；纯展示的黄历块按断点各渲染一份。
 *
 * 'use client'：需要 useState（宜忌展开）、日期选择器与客户端黄历细项计算（core 黄历引擎异步加载）。
 */
'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { getCalendarAlmanac, getZhiShenDesc, isBlackDay, type CalendarAlmanacData } from '@/lib/divination/calendar';
import { DailyDirectionGrid } from '@/components/daily/DailyDirectionGrid';
import { DailyHourStrip } from '@/components/daily/DailyHourStrip';
import { toLocalDateKey, useDailyAlmanacDetail, type DailyAlmanacDetail } from '@/components/daily/useDailyAlmanacDetail';

interface CalendarAlmanacProps {
    date: Date;
    isToday: boolean;
    onDateChange: (days: number) => void;
    onDatePick: (date: Date) => void;
    onGoToday: () => void;
    /** 运势卡：移动端位于宜忌之后，桌面端位于时辰吉凶下方左栏。 */
    fortune: ReactNode;
    /** 问答卡：移动端置于页尾，桌面端位于运势卡右侧；为空时运势卡占满整行。 */
    assistant?: ReactNode;
    /** 运势详解（趋势、指引等），两端均为全宽。 */
    insights?: ReactNode;
}

/** 宜忌超过该数量时折叠，避免极端长列表撑高卡片。 */
const YI_JI_COLLAPSE_LIMIT = 12;
/** 日期选择器范围（与历法库可靠区间一致）。 */
const DATE_MIN = '1901-01-01';
const DATE_MAX = '2099-12-31';
const DASH = '—';
const NAV_BUTTON_CLASS = 'flex size-9 items-center justify-center rounded-[10px] text-foreground-secondary transition-colors hover:bg-background-secondary hover:text-foreground lg:size-10 lg:border-[0.5px] lg:border-border-hover lg:bg-surface';
const TODAY_BUTTON_CLASS = 'h-9 rounded-[10px] px-2.5 text-[13px] text-accent transition-colors hover:bg-accent-light lg:h-10';
const MOBILE_CARD_CLASS = 'rounded-2xl border-[0.5px] border-border bg-surface';

/** 黄历文本整理：一处换算，桌面主卡与移动端细项共用。 */
interface AlmanacText {
    weekdayShort: string;
    ganZhiLine: string;
    shengXiaoLine: string;
    naYinLine: string;
    zhiShen: { name: string; label: string; favorable: boolean } | null;
    dayOfficer: string;
    xiu: { text: string; luck: string } | null;
    nineStar: string;
    houLine: string;
    chongSha: string;
    pengZu: string[];
    taiShen: string;
}

/** lunar-javascript 冲煞描述用半角括号（"(辛亥)猪"），展示统一为全角。 */
function toFullWidthParens(value: string): string {
    return value.replace(/\(/gu, '（').replace(/\)/gu, '）');
}

function buildAlmanacText(data: CalendarAlmanacData, detail: DailyAlmanacDetail | null): AlmanacText {
    const tianShenLabel = detail?.tianShenType && detail.tianShenLuck
        ? `${detail.tianShenType} ${detail.tianShenLuck}`
        : getZhiShenDesc(data.zhiShen).replace(data.zhiShen, '').replace(/[()（）]/gu, '').trim();
    const chongSha = [
        data.chongSha.chong ? `冲${toFullWidthParens(data.chongSha.chong)}` : '',
        data.chongSha.sha ? `煞${data.chongSha.sha}` : '',
    ].filter(Boolean).join(' · ');

    return {
        weekdayShort: data.weekday.replace('星期', '周'),
        ganZhiLine: `${data.ganZhi.year}年 · ${data.ganZhi.month}月 · ${data.ganZhi.day}日`,
        shengXiaoLine: `${data.shengXiao.year}年 · ${data.shengXiao.month}月 · ${data.shengXiao.day}日`,
        naYinLine: [data.naYin.year, data.naYin.month, data.naYin.day].filter(Boolean).join(' · '),
        zhiShen: data.zhiShen ? { name: data.zhiShen, label: tianShenLabel, favorable: !isBlackDay(data.zhiShen) } : null,
        dayOfficer: detail?.dayOfficer ? `${detail.dayOfficer}日` : '',
        xiu: data.xiu.name
            ? { text: [`${data.xiu.name}宿`, data.xiu.animal].filter(Boolean).join(' · '), luck: data.xiu.luck }
            : null,
        nineStar: [data.nineStar.name, data.nineStar.position].filter(Boolean).join(' · '),
        houLine: [data.hou.term, data.hou.phenology].filter(Boolean).join(' · '),
        chongSha,
        pengZu: detail?.pengZuBaiJi ? detail.pengZuBaiJi.split(/\s+/u).filter(Boolean) : [],
        taiShen: data.taiShen ? data.taiShen.replace(/\s+/gu, ' · ') : '',
    };
}

function formatJieQi(item: { date: string; time: string }): string {
    return `${item.date.slice(5)} ${item.time.slice(0, 5)}`;
}

function LuckBadge({ favorable, children }: { favorable: boolean; children: ReactNode }) {
    return (
        <span className={`ml-1.5 rounded px-1.5 py-px text-xs whitespace-nowrap ${favorable ? 'bg-wood-soft text-wood' : 'bg-fire-soft text-fire'}`}>
            {children}
        </span>
    );
}

function CollapseToggle({ kind, hidden, expanded, onToggle }: { kind: 'yi' | 'ji'; hidden: number; expanded: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className={`text-[13px] underline-offset-2 hover:underline ${kind === 'yi' ? 'text-wood' : 'text-fire'}`}
        >
            {expanded ? '收起' : `还有 ${hidden} 项`}
        </button>
    );
}

interface YiJiProps {
    kind: 'yi' | 'ji';
    items: string[];
    expanded: boolean;
    onToggle: () => void;
}

/** 宜忌标题：大号衬线「宜 / 忌」+ 项数（桌面主卡为 lg，移动端面板为 md）。 */
function YiJiHeading({ kind, count, size }: { kind: 'yi' | 'ji'; count: number; size: 'lg' | 'md' }) {
    const isYi = kind === 'yi';
    const tone = isYi ? 'text-wood' : 'text-fire';
    return (
        <h3 className={`flex items-baseline ${size === 'lg' ? 'gap-2' : 'gap-1.5'}`}>
            <span className={`font-display leading-none ${size === 'lg' ? 'text-[26px]' : 'text-[22px]'} ${tone}`}>{isYi ? '宜' : '忌'}</span>
            <span className={size === 'lg' ? 'text-xs text-foreground-secondary' : `text-[11px] ${tone}`}>{count} 项</span>
        </h3>
    );
}

/** 桌面：宜忌以色块标签呈现。 */
function YiJiChips({ kind, items, expanded, onToggle }: YiJiProps) {
    const isYi = kind === 'yi';
    const visible = expanded ? items : items.slice(0, YI_JI_COLLAPSE_LIMIT);
    return (
        <div className="flex min-w-0 flex-col gap-2.5">
            <YiJiHeading kind={kind} count={items.length} size="lg" />
            {items.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                    {visible.map((item) => (
                        <span key={item} className={`rounded-md px-2.5 py-[3px] text-sm leading-5 ${isYi ? 'bg-wood-soft text-wood' : 'bg-fire-soft text-fire'}`}>
                            {item}
                        </span>
                    ))}
                    {items.length > YI_JI_COLLAPSE_LIMIT && (
                        <CollapseToggle kind={kind} hidden={items.length - YI_JI_COLLAPSE_LIMIT} expanded={expanded} onToggle={onToggle} />
                    )}
                </div>
            ) : (
                <span className="text-[13px] text-foreground-secondary">{isYi ? '诸事不宜' : '无'}</span>
            )}
        </div>
    );
}

/** 移动端：宜忌为整块底色面板，事项以文字排列。 */
function YiJiPanel({ kind, items, expanded, onToggle }: YiJiProps) {
    const isYi = kind === 'yi';
    const visible = expanded ? items : items.slice(0, YI_JI_COLLAPSE_LIMIT);
    return (
        <section className={`flex min-w-0 flex-col gap-2 rounded-2xl p-3.5 ${isYi ? 'bg-wood-soft' : 'bg-fire-soft'}`}>
            <YiJiHeading kind={kind} count={items.length} size="md" />
            {items.length > 0 ? (
                <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-sm leading-normal">
                    {visible.map((item) => <span key={item}>{item}</span>)}
                    {items.length > YI_JI_COLLAPSE_LIMIT && (
                        <CollapseToggle kind={kind} hidden={items.length - YI_JI_COLLAPSE_LIMIT} expanded={expanded} onToggle={onToggle} />
                    )}
                </div>
            ) : (
                <span className="text-[13px] text-foreground-secondary">{isYi ? '诸事不宜' : '无'}</span>
            )}
        </section>
    );
}

function DateNav({ date, isToday, onDateChange, onDatePick, onGoToday }: Pick<CalendarAlmanacProps, 'date' | 'isToday' | 'onDateChange' | 'onDatePick' | 'onGoToday'>) {
    const inputRef = useRef<HTMLInputElement>(null);
    const dateKey = toLocalDateKey(date);

    const openPicker = () => {
        const input = inputRef.current;
        if (!input) return;
        try {
            input.showPicker();
        } catch {
            // 旧浏览器不支持 showPicker：聚焦后由系统控件接管
            input.focus();
        }
    };

    return (
        // 移动端三栏居中（标题在顶栏）；桌面端标题居左、切换居右
        <header className="grid grid-cols-[1fr_auto_1fr] items-center lg:flex lg:justify-between lg:gap-4">
            <h1 className="hidden font-display text-[32px] font-normal leading-tight lg:block">日运 · 黄历</h1>
            <span aria-hidden="true" className="lg:hidden" />
            <div className="flex items-center gap-1 lg:gap-2">
                <button type="button" aria-label="前一天" onClick={() => onDateChange(-1)} className={NAV_BUTTON_CLASS}>
                    <ChevronLeft className="size-4" />
                </button>
                <span className="relative">
                    <button
                        type="button"
                        onClick={openPicker}
                        aria-label={`选择日期，当前 ${dateKey}`}
                        className="flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-[0.9375rem] font-medium tabular-nums transition-colors hover:bg-background-secondary lg:h-10 lg:border-[0.5px] lg:border-border-hover lg:bg-surface lg:px-3.5 lg:text-sm lg:font-normal"
                    >
                        <Calendar className="hidden size-[15px] text-foreground-secondary lg:block" />
                        {dateKey}
                    </button>
                    <input
                        ref={inputRef}
                        type="date"
                        tabIndex={-1}
                        aria-hidden="true"
                        min={DATE_MIN}
                        max={DATE_MAX}
                        value={dateKey}
                        onChange={(event) => {
                            const [year, month, day] = event.target.value.split('-').map(Number);
                            if (year && month && day) onDatePick(new Date(year, month - 1, day));
                        }}
                        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                    />
                </span>
                <button type="button" aria-label="后一天" onClick={() => onDateChange(1)} className={NAV_BUTTON_CLASS}>
                    <ChevronRight className="size-4" />
                </button>
                {!isToday && (
                    <button type="button" onClick={onGoToday} className={`hidden lg:block ${TODAY_BUTTON_CLASS}`}>
                        回到今天
                    </button>
                )}
            </div>
            {!isToday && (
                <button type="button" onClick={onGoToday} className={`justify-self-end lg:hidden ${TODAY_BUTTON_CLASS}`}>
                    今天
                </button>
            )}
        </header>
    );
}

export function CalendarAlmanac({ date, isToday, onDateChange, onDatePick, onGoToday, fortune, assistant, insights }: CalendarAlmanacProps) {
    const data = useMemo(() => getCalendarAlmanac(date), [date]);
    const detail = useDailyAlmanacDetail(date);
    const text = useMemo(() => buildAlmanacText(data, detail), [data, detail]);
    const dateKey = toLocalDateKey(date);
    const [expanded, setExpanded] = useState<{ key: string; yi: boolean; ji: boolean }>({ key: dateKey, yi: false, ji: false });
    // 换日后宜忌折叠状态复位
    const yiExpanded = expanded.key === dateKey && expanded.yi;
    const jiExpanded = expanded.key === dateKey && expanded.ji;
    const toggle = (kind: 'yi' | 'ji') => setExpanded({
        key: dateKey,
        yi: kind === 'yi' ? !yiExpanded : yiExpanded,
        ji: kind === 'ji' ? !jiExpanded : jiExpanded,
    });

    const directionProps = {
        dayGanZhi: data.ganZhi.day,
        caiShen: data.shenWei.caiShen,
        xiShen: data.shenWei.xiShen,
        fuShen: data.shenWei.fuShen,
        yangGui: data.shenWei.yangGuiShen,
        yinGui: detail?.directions.yinGui,
        sha: data.chongSha.sha,
        taiShen: data.taiShen,
    };

    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-x-4 lg:gap-y-[26px]">
            <div className="lg:col-span-2">
                <DateNav date={date} isToday={isToday} onDateChange={onDateChange} onDatePick={onDatePick} onGoToday={onGoToday} />
            </div>

            {/* 移动端：日期摘要 + 宜忌面板 */}
            <div className="flex flex-col gap-3 max-lg:order-1 lg:hidden">
                <section aria-label="黄历" className="flex items-center gap-4 rounded-[18px] border-[0.5px] border-border bg-surface p-[18px]">
                    <div className="flex w-[74px] shrink-0 flex-col items-center rounded-[14px] bg-accent-soft py-2 text-accent-strong">
                        <span className="text-[11px]">{date.getMonth() + 1} 月 · {text.weekdayShort}</span>
                        <span className="font-display text-[40px] leading-[1.1]">{date.getDate()}</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-display text-[22px] leading-tight">{data.lunarMonthDay}</span>
                        <span className="text-[13px] text-foreground/80">{text.ganZhiLine}</span>
                        <span className="text-xs text-foreground-secondary">
                            {[text.shengXiaoLine, data.hou.term].filter(Boolean).join(' · ')}
                        </span>
                    </div>
                </section>
                <div className="grid grid-cols-2 gap-2">
                    <YiJiPanel kind="yi" items={data.yi} expanded={yiExpanded} onToggle={() => toggle('yi')} />
                    <YiJiPanel kind="ji" items={data.ji} expanded={jiExpanded} onToggle={() => toggle('ji')} />
                </div>
            </div>

            {/* 桌面：黄历主卡 */}
            <section aria-label="黄历" className="hidden overflow-hidden rounded-[18px] border-[0.5px] border-border bg-surface lg:col-span-2 lg:flex">
                <div className="flex w-[280px] shrink-0 flex-col gap-4 border-r-[0.5px] border-border bg-panel p-7">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-sm text-foreground-secondary">{date.getFullYear()} 年 {date.getMonth() + 1} 月 · {data.weekday}</span>
                        <span className="font-display text-[88px] leading-none">{date.getDate()}</span>
                        <span className="mt-1.5 font-display text-2xl leading-snug">{data.lunarMonthDay}</span>
                        <span className="font-display text-base text-foreground/80">{text.ganZhiLine}</span>
                    </div>

                    <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2.5 gap-y-[9px] border-t-[0.5px] border-border pt-3.5 text-[13px] leading-[18px]">
                        <dt className="text-foreground-secondary">生肖</dt>
                        <dd className="min-w-0">{text.shengXiaoLine}</dd>
                        <dt className="text-foreground-secondary">纳音</dt>
                        <dd className="min-w-0">{text.naYinLine || DASH}</dd>
                        <dt className="text-foreground-secondary">值神</dt>
                        <dd className="min-w-0">
                            {text.zhiShen ? <>{text.zhiShen.name}{text.zhiShen.label && <LuckBadge favorable={text.zhiShen.favorable}>{text.zhiShen.label}</LuckBadge>}</> : DASH}
                        </dd>
                        <dt className="text-foreground-secondary">建除</dt>
                        <dd className="min-w-0">{text.dayOfficer || DASH}</dd>
                        <dt className="text-foreground-secondary">星宿</dt>
                        <dd className="min-w-0">
                            {text.xiu ? <>{text.xiu.text}{text.xiu.luck && <LuckBadge favorable={text.xiu.luck === '吉'}>{text.xiu.luck}</LuckBadge>}</> : DASH}
                        </dd>
                        <dt className="text-foreground-secondary">日九星</dt>
                        <dd className="min-w-0">{text.nineStar || DASH}</dd>
                        <dt className="text-foreground-secondary">月相</dt>
                        <dd className="min-w-0">{data.yueXiang || DASH}</dd>
                        <dt className="text-foreground-secondary">物候</dt>
                        <dd className="min-w-0">{text.houLine || DASH}</dd>
                    </dl>

                    {(data.jieQi.current || data.jieQi.next) && (
                        <div className="mt-auto flex flex-col gap-1.5 rounded-xl bg-surface px-3.5 py-3 text-[13px]">
                            {data.jieQi.current && (
                                <span className="flex justify-between gap-3">
                                    <span>{data.jieQi.current.name}</span>
                                    <span className="tabular-nums text-foreground-secondary">{formatJieQi(data.jieQi.current)}</span>
                                </span>
                            )}
                            {data.jieQi.next && (
                                <span className="flex justify-between gap-3 text-foreground-secondary">
                                    <span>下一节气 · {data.jieQi.next.name}</span>
                                    <span className="tabular-nums">{formatJieQi(data.jieQi.next)}</span>
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-[22px] p-7">
                    <div className="grid grid-cols-2 gap-5">
                        <YiJiChips kind="yi" items={data.yi} expanded={yiExpanded} onToggle={() => toggle('yi')} />
                        <YiJiChips kind="ji" items={data.ji} expanded={jiExpanded} onToggle={() => toggle('ji')} />
                    </div>

                    <div className="flex gap-6 border-t-[0.5px] border-border pt-5">
                        <dl className="grid min-w-0 flex-1 grid-cols-[76px_minmax(0,1fr)] content-start gap-3 text-sm leading-normal">
                            <dt className="text-foreground-secondary">冲煞</dt>
                            <dd className="min-w-0">{text.chongSha || DASH}</dd>
                            <dt className="text-foreground-secondary">彭祖百忌</dt>
                            <dd className="min-w-0">{text.pengZu.length > 0 ? text.pengZu.map((line) => <span key={line} className="block">{line}</span>) : DASH}</dd>
                            <dt className="text-foreground-secondary">胎神占方</dt>
                            <dd className="min-w-0">{text.taiShen || DASH}</dd>
                            <dt className="text-foreground-secondary">空亡</dt>
                            <dd className="min-w-0">{data.kongWang || DASH}</dd>
                            <dt className="text-foreground-secondary">吉神宜趋</dt>
                            <dd className="min-w-0 text-wood">{data.jiShen.length > 0 ? data.jiShen.join('　') : '无'}</dd>
                            <dt className="text-foreground-secondary">凶煞宜忌</dt>
                            <dd className="min-w-0 text-fire">{data.xiongSha.length > 0 ? data.xiongSha.join('　') : '无'}</dd>
                        </dl>
                        <div className="w-[220px] shrink-0">
                            <DailyDirectionGrid {...directionProps} />
                        </div>
                    </div>
                </div>
            </section>

            <div className="min-w-0 max-lg:order-3 lg:col-span-2">
                <DailyHourStrip key={dateKey} hours={detail ? detail.hourlyFortune : null} isToday={isToday} />
            </div>

            <div className={`min-w-0 max-lg:order-2 ${assistant ? '' : 'lg:col-span-2'}`}>{fortune}</div>
            {assistant && <div className="min-w-0 max-lg:order-7">{assistant}</div>}
            {insights && <div className="min-w-0 max-lg:order-6 lg:col-span-2">{insights}</div>}

            {/* 移动端：方位 + 当日黄历细项（桌面端已在主卡中） */}
            <div className="flex flex-col gap-3.5 max-lg:order-4 lg:hidden">
                <MobileDirections data={data} yinGui={detail?.directions.yinGui} />
                <section aria-labelledby="daily-almanac-list-title" className={`${MOBILE_CARD_CLASS} flex flex-col gap-1 p-4`}>
                    <h2 id="daily-almanac-list-title" className="font-display text-[17px]">
                        {isToday ? '今日黄历' : '当日黄历'}
                    </h2>
                    <dl className="text-sm">
                        <MobileRow label="值神">
                            {text.zhiShen
                                ? <span className={text.zhiShen.favorable ? 'text-wood' : 'text-fire'}>{[text.zhiShen.name, text.zhiShen.label.replace(/\s+/gu, '')].filter(Boolean).join(' · ')}</span>
                                : DASH}
                        </MobileRow>
                        <MobileRow label="建除">{text.dayOfficer || DASH}</MobileRow>
                        <MobileRow label="星宿">
                            {text.xiu
                                ? <span className={text.xiu.luck === '凶' ? 'text-fire' : text.xiu.luck === '吉' ? 'text-wood' : ''}>{[text.xiu.text, text.xiu.luck].filter(Boolean).join(' · ')}</span>
                                : DASH}
                        </MobileRow>
                        <MobileRow label="日九星">{text.nineStar || DASH}</MobileRow>
                        <MobileRow label="冲煞">{text.chongSha || DASH}</MobileRow>
                        <MobileRow label="彭祖百忌">
                            {text.pengZu.length > 0 ? text.pengZu.map((line) => <span key={line} className="block">{line}</span>) : DASH}
                        </MobileRow>
                        <MobileRow label="胎神占方">{text.taiShen || DASH}</MobileRow>
                        <MobileRow label="空亡">{data.kongWang || DASH}</MobileRow>
                        <MobileRow label="吉神宜趋">{data.jiShen.length > 0 ? data.jiShen.join('　') : '无'}</MobileRow>
                        <MobileRow label="凶煞宜忌">{data.xiongSha.length > 0 ? data.xiongSha.join('　') : '无'}</MobileRow>
                        <MobileRow label="纳音">{text.naYinLine || DASH}</MobileRow>
                        <MobileRow label="月相 · 物候">{[data.yueXiang, data.hou.phenology].filter(Boolean).join(' · ') || DASH}</MobileRow>
                        {(data.jieQi.current || data.jieQi.next) && (
                            <MobileRow label="节气">
                                {data.jieQi.current && <span className="block">{data.jieQi.current.name} {formatJieQi(data.jieQi.current)}</span>}
                                {data.jieQi.next && <span className="block text-foreground-secondary">下一节气 {data.jieQi.next.name} {formatJieQi(data.jieQi.next)}</span>}
                            </MobileRow>
                        )}
                    </dl>
                </section>
            </div>
        </div>
    );
}

function MobileRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2.5 border-t-[0.5px] border-border py-2.5">
            <dt className="leading-[1.6] text-foreground-secondary">{label}</dt>
            <dd className="min-w-0 break-words leading-[1.6]">{children}</dd>
        </div>
    );
}

const MOBILE_DIRECTION_GODS: ReadonlyArray<{ label: string; pick: (data: CalendarAlmanacData, yinGui?: string) => string | undefined; sha?: boolean }> = [
    { label: '喜神', pick: (data) => data.shenWei.xiShen },
    { label: '福神', pick: (data) => data.shenWei.fuShen },
    { label: '财神', pick: (data) => data.shenWei.caiShen },
    { label: '阳贵', pick: (data) => data.shenWei.yangGuiShen },
    { label: '阴贵', pick: (_data, yinGui) => yinGui },
    { label: '煞', pick: (data) => (data.chongSha.sha ? `正${data.chongSha.sha}` : undefined), sha: true },
];

/** 移动端方位：神煞 → 方位列表（桌面端为上北下南九宫）。 */
function MobileDirections({ data, yinGui }: { data: CalendarAlmanacData; yinGui?: string }) {
    return (
        <section aria-labelledby="daily-directions-title" className={`${MOBILE_CARD_CLASS} p-4`}>
            <h2 id="daily-directions-title" className="mb-3 font-display text-[17px]">方位</h2>
            <ul className="grid grid-cols-3 gap-1.5 text-center">
                {MOBILE_DIRECTION_GODS.map(({ label, pick, sha }) => (
                    <li key={label} className={`flex flex-col gap-0.5 rounded-xl py-2.5 ${sha ? 'bg-fire-soft' : 'bg-background'}`}>
                        <span className="text-[11px] text-foreground-secondary">{label}</span>
                        <span className={`font-display text-[15px] ${sha ? 'text-fire' : ''}`}>{pick(data, yinGui) || DASH}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
