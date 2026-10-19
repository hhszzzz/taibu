'use client';
// 黄历工作区视图：直接沿用日运页的版面语言（左栏日期与值日 + 右栏宜忌色块 + 冲煞/方位，下方时辰带），
// 数据全部来自已保存的 canonical JSON，不在 Web 端重新排历。

import { useState, type KeyboardEvent } from 'react';
import type { AlmanacCanonicalJSON } from 'taibu-core/almanac';
import type { ChartInteraction } from './ChartTarget';

const DASH = '—';
const DIRECTIONS = ['西北', '正北', '东北', '正西', null, '正东', '西南', '正南', '东南'] as const;
const DIRECTION_FIELDS: Record<string, string> = { 财神: '财神', 喜神: '喜神', 福神: '福神', 阳贵人: '阳贵', 阴贵人: '阴贵' };
const HOUR_LUCK = (luck?: string) => luck === '吉';

/** "00:00–00:59" → "00–01"（与日运页时辰条同款短标注）。 */
function hourRange(range?: string): string {
    if (!range) return '';
    const [start, end] = range.split('–');
    const endHour = end ? Number(end.slice(0, 2)) : NaN;
    return start ? `${start.slice(0, 2)}–${Number.isFinite(endHour) ? String(endHour + 1).padStart(2, '0') : end?.slice(0, 2) ?? ''}` : '';
}

function weekdayOf(date: string): string {
    const value = new Date(`${date}T00:00:00`);
    return Number.isNaN(value.getTime()) ? '' : `星期${'日一二三四五六'[value.getDay()]}`;
}

function targetProps(interaction: ChartInteraction | undefined, id: string) {
    if (!interaction) return {};
    return {
        'data-chart-target': id,
        role: 'button' as const,
        tabIndex: 0,
        'aria-pressed': interaction.selectedIds.includes(id),
        onClick: () => interaction.onSelect(id),
        onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); interaction.onSelect(id); } },
    };
}

/** 日运页同款：宜忌色块标签（wood / fire 软底）。 */
function YiJiChips({ kind, items, interaction }: { kind: '宜' | '忌'; items: string[]; interaction?: ChartInteraction }) {
    const yi = kind === '宜';
    return <div className="almanac-yiji-block" data-kind={yi ? 'yi' : 'ji'} {...targetProps(interaction, `almanac:activity:${kind}`)}>
        <h3><span className="almanac-yiji-title">{kind}</span><small>{items.length} 项</small></h3>
        <div className="almanac-yiji-chips">{items.length
            ? items.map(item => <span key={item}>{item}</span>)
            : <span className="almanac-yiji-empty">{yi ? '诸事不宜' : '无'}</span>}</div>
    </div>;
}

/** Display the inspected snapshot without recalculating the daily calendar. */
export function AlmanacChart({ chart, interaction }: { chart: AlmanacCanonicalJSON; interaction?: ChartInteraction }) {
    const [hour, setHour] = useState<number | null>(null);
    const date = chart.基础与个性化坐标.日期;
    const day = date.slice(8) || DASH;
    const month = Number(date.slice(5, 7));
    const base = chart.传统黄历基调;
    const dayInfo = chart.值日信息 ?? {};
    const hours = chart.时辰吉凶 ?? [];
    const directions = chart.方位信息;
    const directionEntries = directions
        ? Object.entries(directions).map(([field, value]) => ({ field, label: DIRECTION_FIELDS[field] ?? field, direction: value.trim() }))
        : [];
    const spirits = (['吉神宜趋', '凶煞宜忌'] as const).filter(field => chart.神煞参考[field]?.length);
    const nineStar = base.日九星;
    // 模型定位到某个时辰时，详情条跟着显示它；用户点选优先。
    const located = hours.findIndex((_, index) => interaction?.selectedIds.includes(`almanac:hour:${index}`));
    const shownHour = hour ?? (located >= 0 ? located : null);
    const activeHour = shownHour === null ? null : hours[shownHour];
    const dayTarget = (field: keyof NonNullable<typeof chart.值日信息>) => targetProps(interaction, `almanac:day:${field}`);

    return <div className="almanac-view">
        {/* 黄历主卡 = 日运页同构：左栏日期与值日（含星宿歌诀），右栏宜忌、冲煞与方位。 */}
        <section className="almanac-main" aria-label="黄历">
            <div className="almanac-date" {...targetProps(interaction, 'almanac:date')}>
                <span className="almanac-date-line">{date.slice(0, 4)} 年 {month} 月 · {weekdayOf(date)}</span>
                <strong className="almanac-date-day">{Number(day)}</strong>
                <span className="almanac-date-lunar">{base.农历}</span>
                <span className="almanac-date-ganzhi">{chart.基础与个性化坐标.日干支}</span>
                <dl className="almanac-kv almanac-kv-date">
                    <div><dt>生肖</dt><dd>{base.生肖 || DASH}</dd></div>
                    <div><dt>纳音</dt><dd><span {...dayTarget('日柱纳音')}>{dayInfo.日柱纳音 || DASH}</span></dd></div>
                    {dayInfo.天神 && <div><dt>值神</dt><dd>
                        <span {...dayTarget('天神')}>{dayInfo.天神}</span>
                        {dayInfo.天神类型 && <span className="almanac-badge" data-tone={dayInfo.天神吉凶 === '吉' ? 'yi' : 'ji'} {...dayTarget('天神类型')}>{dayInfo.天神类型}</span>}
                        {dayInfo.天神吉凶 && <span className="almanac-badge" data-tone={dayInfo.天神吉凶 === '吉' ? 'yi' : 'ji'} {...dayTarget('天神吉凶')}>{dayInfo.天神吉凶}</span>}
                    </dd></div>}
                    {dayInfo.建除十二值星 && <div><dt>建除</dt><dd><span {...dayTarget('建除十二值星')}>{dayInfo.建除十二值星}日</span></dd></div>}
                    {dayInfo.二十八星宿 && <div><dt>星宿</dt><dd>
                        <span {...dayTarget('二十八星宿')}>{dayInfo.二十八星宿}宿</span>
                        {dayInfo.星宿吉凶 && <span className="almanac-badge" data-tone={dayInfo.星宿吉凶 === '吉' ? 'yi' : 'ji'} {...dayTarget('星宿吉凶')}>{dayInfo.星宿吉凶}</span>}
                    </dd></div>}
                    {/* 歌诀默认收成两行；悬停、聚焦或被定位时展开全文。 */}
                    {dayInfo.星宿歌诀 && <div data-wide><dd><q className="almanac-verse" title={dayInfo.星宿歌诀} {...dayTarget('星宿歌诀')}>{dayInfo.星宿歌诀}</q></dd></div>}
                    {nineStar && <div><dt>日九星</dt><dd title={nineStar.描述}>{nineStar.方位 ? `${nineStar.方位} · ${nineStar.描述.split(' ')[0]}` : nineStar.描述.split(' ')[0]}</dd></div>}
                </dl>
            </div>

            <div className="almanac-body">
                <div className="almanac-yiji">
                    <YiJiChips kind="宜" items={chart.择日宜忌.宜} interaction={interaction} />
                    <YiJiChips kind="忌" items={chart.择日宜忌.忌} interaction={interaction} />
                </div>

                <div className="almanac-details">
                    <dl className="almanac-kv almanac-kv-detail">
                        <div><dt>冲煞</dt><dd>{base.冲煞 || DASH}</dd></div>
                        {base.彭祖百忌 && <div><dt>彭祖百忌</dt><dd>{base.彭祖百忌}</dd></div>}
                        {base.胎神占方 && <div><dt>胎神占方</dt><dd>{base.胎神占方}</dd></div>}
                        {spirits.map(field => <div key={field}>
                            <dt>{field}</dt>
                            <dd data-kind={field === '吉神宜趋' ? 'yi' : 'ji'} {...targetProps(interaction, `almanac:spirit:${field}`)}>{chart.神煞参考[field]!.join('　')}</dd>
                        </div>)}
                    </dl>

                    <div className="almanac-direction-wrap">
                        <span className="almanac-direction-caption">方位 · 上北下南</span>
                        <div className="almanac-directions">
                            {DIRECTIONS.map(direction => {
                                if (direction === null) return <span key="center" className="almanac-direction is-center">{chart.基础与个性化坐标.日干支}</span>;
                                const gods = directionEntries.filter(entry => entry.direction === direction);
                                return <span key={direction} className="almanac-direction" data-tone={gods.length ? 'god' : undefined}>
                                    <small>{direction}</small>
                                    {gods.map(god => <span key={god.field} {...targetProps(interaction, `almanac:direction:${god.field}`)}>{god.label}</span>)}
                                </span>;
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </section>

        {/* 时辰带：13 个时辰（早子、晚子）宽时一行，窄时 7 + 6 两行居中；顶边色条与文字双重标示吉凶。 */}
        {hours.length > 0 && <section className="almanac-card almanac-hours-card" aria-label="时辰吉凶">
            <div className="almanac-hours-head"><h3>时辰吉凶</h3>{!activeHour && <span>点时辰查看宜忌与冲煞</span>}</div>
            <div className="almanac-hours">
                {hours.map((item, index) => <button key={`${item.时辰}-${index}`} type="button" className="almanac-hour" data-kind={HOUR_LUCK(item.天神吉凶) ? 'yi' : 'ji'}
                    {...targetProps(interaction, `almanac:hour:${index}`)}
                    aria-pressed={shownHour === index || (interaction?.selectedIds.includes(`almanac:hour:${index}`) ?? false)}
                    onClick={() => { interaction?.onSelect(`almanac:hour:${index}`); setHour(index); }}>
                    <small>{hourRange(item.时间范围)}</small>
                    <strong>{item.时辰}</strong>
                    <span>{item.天神 ?? ''}</span>
                    <em>{item.天神吉凶 ?? DASH}</em>
                </button>)}
            </div>
            {activeHour && <dl className="almanac-hour-detail" aria-live="polite" data-kind={HOUR_LUCK(activeHour.天神吉凶) ? 'yi' : 'ji'}>
                <div className="almanac-hour-detail-head">
                    <strong>{activeHour.时辰}时</strong>
                    <span>{hourRange(activeHour.时间范围)}</span>
                    <span>{[activeHour.天神, activeHour.天神类型, activeHour.天神吉凶].filter(Boolean).join(' · ')}</span>
                    {activeHour.冲煞 && <span>冲煞 {activeHour.冲煞}</span>}
                </div>
                <div data-kind="yi"><dt>宜</dt><dd>{activeHour.宜?.filter(item => item !== '无').join('　') || '诸事不宜'}</dd></div>
                <div data-kind="ji"><dt>忌</dt><dd>{activeHour.忌?.filter(item => item !== '无').join('　') || '无'}</dd></div>
            </dl>}
        </section>}
    </div>;
}
