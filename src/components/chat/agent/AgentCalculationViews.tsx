'use client';
// 需要 useId：合盘各组关系的标题与列表相互关联

import { Fragment, useId } from 'react';
import type { AgentCalculation } from '@/lib/agent/tool-presentation';

function DayunTimeline({ data }: { data: Extract<AgentCalculation, { kind: 'bazi_dayun' }>['data'] }) {
    const year = new Date().getFullYear();
    const start = data.起运信息;
    return <>
        <dl className="agent-ws-facts">
            <div><dt>起运</dt><dd>{start.起运详情}（{start.起运年龄} 岁）</dd></div>
            {/* 出生时辰未知：起运时刻是当天最早到最晚出生之间的范围 */}
            {start.起运时刻 && <div><dt>起运时刻</dt><dd>{start.起运时刻}{start.最晚起运时刻 ? ` 至 ${start.最晚起运时刻}` : ''}{start.时区 ? ` · ${start.时区}` : ''}</dd></div>}
            {start.交运年份 && <div><dt>交运年份</dt><dd>{start.交运年份}</dd></div>}
            {start.顺逆 && <div><dt>排列</dt><dd>{start.顺逆}</dd></div>}
        </dl>
        <ol className="agent-ws-timeline" aria-label="大运列表">
            {data.大运列表.map((item, index) => {
                const next = data.大运列表[index + 1];
                const current = year >= item.起运年份 && (!next || year < next.起运年份);
                // full 档才带流年列表；有此数据的大运可逐年在原位展开。
                const liunian = item.流年列表 ?? [];
                const notes = (entry: typeof liunian[number]) => [
                    entry.地势 ? `地势 ${entry.地势}` : null,
                    entry.太岁关系?.length ? `太岁 ${entry.太岁关系.join('、')}` : null,
                    entry.原局关系?.length ? entry.原局关系.map(relation => relation.描述).join('；') : null,
                ].filter(Boolean).join(' · ');
                return <li key={item.起运年份} aria-current={current ? 'step' : undefined}>
                    <span className="agent-ws-glyph">{item.干支}</span>
                    <span className="agent-ws-timeline-body">
                        <strong>{item.起运年份}{item.最晚起运年份 ? `（或${item.最晚起运年份}）` : ''}{next ? `–${next.起运年份 - 1}` : ' 起'} · {item.起运年龄 !== undefined ? `${item.起运年龄} 岁` : ''}{current && <em>当前</em>}</strong>
                        <small>天干{item.十神} · 藏干 {item.藏干.map(stem => `${stem.天干}${stem.十神}`).join('、') || '无'}</small>
                        {liunian.length > 0 && <details className="agent-ws-liunian">
                            <summary>流年 {liunian[0].流年}–{liunian[liunian.length - 1].流年}（{liunian.length} 年）</summary>
                            <ol className="agent-ws-list" aria-label={`${item.起运年份} 年起大运的流年`}>
                                {liunian.map(entry => <li key={entry.流年}>
                                    <strong>{entry.流年} · {entry.干支} · {entry.十神}</strong>
                                    <small>{notes(entry) || '与该大运、原局无冲合刑害记录'}</small>
                                </li>)}
                            </ol>
                        </details>}
                    </span>
                </li>;
            })}
        </ol>
    </>;
}

function ResolveCandidates({ data }: { data: Extract<AgentCalculation, { kind: 'bazi_pillars_resolve' }>['data'] }) {
    const rules = data.计算规则 ?? {};
    const range = typeof rules.startYear === 'number' && typeof rules.endYear === 'number' ? `${rules.startYear}–${rules.endYear} 年内` : '计算范围内';
    const pillars = data.原始四柱;
    return <>
        <p className="agent-ws-pillars" aria-label="原始四柱">{[pillars.年柱, pillars.月柱, pillars.日柱, pillars.时柱].map((pillar, index) => <span key={index}>{pillar}</span>)}</p>
        {data.候选列表.length ? <ol className="agent-ws-list" aria-label="候选出生时间">
            {data.候选列表.map(candidate => <li key={candidate.候选序号}>
                <strong>{candidate.公历} {candidate.出生时间}</strong>
                <small>农历 {candidate.农历}{candidate.是否闰月 === '是' ? ' · 闰月' : ''}{candidate.时间区间 ? ` · ${candidate.时间区间.开始} 至 ${candidate.时间区间.结束}（不含）` : ''}</small>
            </li>)}
        </ol> : <p className="agent-ws-note">{range}没有与这组四柱匹配的出生时间。请核对四柱是否抄录正确。</p>}
    </>;
}

function HoroscopeTable({ data }: { data: Extract<AgentCalculation, { kind: 'ziwei_horoscope' }>['data'] }) {
    return <>
        <p className="agent-ws-note">目标日期 {data.基本信息.目标日期} · {data.基本信息.五行局}</p>
        <div className="agent-ws-table-scroll" tabIndex={0} aria-label="运限叠宫">
            <table className="agent-ws-table">
                <thead><tr><th scope="col">层次</th><th scope="col">时间</th><th scope="col">干支</th><th scope="col">落入本命</th><th scope="col">运限四化</th></tr></thead>
                <tbody>{data.运限叠宫.map(layer => <tr key={layer.层次}>
                    <th scope="row">{layer.层次}</th><td>{layer.时间段备注}</td><td>{layer.干支}</td><td>{layer.落入本命宫位}</td><td>{layer.运限四化.join(' ')}</td>
                </tr>)}</tbody>
            </table>
        </div>
        {data.流年星曜 && <dl className="agent-ws-facts">
            {(['吉星分布', '煞星分布', '桃花/文星'] as const).map(key => <div key={key}><dt>{key}</dt><dd>{data.流年星曜![key].join('、') || '无'}</dd></div>)}
        </dl>}
    </>;
}

function FlyingStars({ data }: { data: Extract<AgentCalculation, { kind: 'ziwei_flying_star' }>['data'] }) {
    return <ol className="agent-ws-list" aria-label="飞星查询">
        {data.查询结果.map(result => {
            const flights = result.四化落宫 ?? result.实际飞化;
            return <li key={result.查询序号}>
                <strong>{result.查询类型}{result.发射宫位 ? ` · ${result.发射宫位}${result.发射宫干支 ? `（${result.发射宫干支}）` : ''}` : result.本宫 ? ` · ${result.本宫}` : ''}</strong>
                {flights && <small>{flights.map(flight => `化${flight.四化} → ${flight.宫位 ?? '不入宫'}${flight.星曜 ? ` · ${flight.星曜}` : ''}`).join('；')}</small>}
                {result.矩阵宫位 && <small>对宫 {result.矩阵宫位.对宫} · 三合 {result.矩阵宫位.三合1}、{result.矩阵宫位.三合2}</small>}
                {result.判断目标 && <small>{result.判断目标}：{result.结果 ?? '未判断'}</small>}
            </li>;
        })}
    </ol>;
}

function AlmanacCandidates({ data }: { data: Extract<AgentCalculation, { kind: 'almanac_select' }>['data'] }) {
    const query = data.查询;
    return <>
        <p className="agent-ws-note">{query.起止日期} · {query.天数} 天{query.事项 ? ` · 事项「${query.事项}」` : ''}{query.排除冲煞 ? ` · 避冲 ${query.排除冲煞.join('、')}` : ''} · 候选 {data.候选日.length} 天</p>
        {data.候选日.length ? <ol className="agent-ws-list" aria-label="候选日">
            {data.候选日.map(candidate => <li key={candidate.日期}>
                <strong>{candidate.日期} · {candidate.日干支}</strong>
                <small>{candidate.建除} · {candidate.星宿}{candidate.星宿吉凶 ? `（${candidate.星宿吉凶}）` : ''} · 冲煞 {candidate.冲煞}</small>
                <small>宜 {candidate.宜.join('、') || '无'}；忌 {candidate.忌.join('、') || '无'}</small>
            </li>)}
        </ol> : <p className="agent-ws-note">这个区间没有符合筛选条件的日期：犯忌 {data.排除统计.犯忌} 天、无对应宜 {data.排除统计.无对应宜} 天、冲煞 {data.排除统计.冲煞} 天。</p>}
    </>;
}

/** 两盘之间的关系分三组：日柱（日主与夫妻宫）、年柱（生肖与年命）、其余；各组按 Core 的顺序列出。 */
const HEPAN_GROUPS = [
    { key: '日柱之间', note: '日主与夫妻宫', scope: '两人日柱之间' },
    { key: '年柱之间', note: '生肖与年命', scope: '两人年柱之间' },
    { key: '其余关系', note: '其余柱位', scope: '其余柱位之间' },
] as const;

function HepanReading({ data }: { data: Extract<AgentCalculation, { kind: 'bazi_hepan' }>['data'] }) {
    const id = useId();
    return <>
        {data.双方.map(person => <Fragment key={person.称呼}>
            <p className="agent-ws-note">{person.称呼}（{person.性别}）· 属{person.生肖} · 日主{person.日主}，生于{person.月令}月（{person.月令旺衰}）· 缺失五行 {person.缺失五行.join('、') || '无'}{person.出生时辰 ? ' · 出生时辰未知，未排时柱' : ''}</p>
            <p className="agent-ws-pillars" aria-label={`${person.称呼}四柱`}>{person.四柱.map(pillar => <span key={pillar.柱} title={`${pillar.柱} · ${pillar.纳音}`}>{pillar.干支}</span>)}</p>
        </Fragment>)}
        <dl className="agent-ws-facts">
            <div><dt>日主互见</dt><dd>{[...data.日主互见.说明, data.日主互见.五行生克].join('；')}</dd></div>
            <div><dt>年命纳音</dt><dd>{data.年命纳音.说明}：{data.年命纳音.五行生克}</dd></div>
            <div><dt>五行互补</dt><dd>{data.五行互补.join('；')}</dd></div>
        </dl>
        {HEPAN_GROUPS.map(({ key, note, scope }, index) => <section key={key} className="agent-ws-group" aria-labelledby={`${id}-${index}`}>
            <h3 id={`${id}-${index}`}>{key} <span>{note} · {data[key].length} 项</span></h3>
            {data[key].length ? <ol className="agent-ws-list">
                {data[key].map(row => <li key={`${row.类型}:${row.位置.map(cell => cell.柱 + cell.部位).join('·')}`}>
                    <strong>{row.说明}</strong>
                    <small>{row.位置.map(cell => `${cell.柱}${cell.部位}${cell.字}`).join(' · ')}</small>
                </li>)}
            </ol> : <p className="agent-ws-note">{scope}没有干支合冲刑害破。</p>}
        </section>)}
    </>;
}

type HourCandidates = Extract<AgentCalculation, { kind: 'bazi_hour_candidates' }>['data'];

/** 钟表时刻：与出生日期同日只写钟点，次日零点写作 24:00，其余写全 */
/** 时段只写时分：次日零点写 24:00，落在出生前后一天（真太阳时跨日）时注明前一日、次日 */
function clockSpan(start: string, end: string, solarDate: string) {
    const [startDate, startTime] = start.split(' ');
    const [endDate, endTime] = end.split(' ');
    const day = (date: string) => date === solarDate ? '' : date < solarDate ? '前一日 ' : '次日 ';
    const tail = endDate === startDate ? endTime : endTime === '00:00' ? '24:00' : `${day(endDate)}${endTime}`;
    return `${day(startDate)}${startTime}–${tail}`;
}

/** 「辰戌相冲（时支辰·流年支戌）」：流年与大运同字时，同一关系出现两次，靠位置区分 */
function relationText(row: HourCandidates['候选'][number]['时柱关系'][number]) {
    return `${row.说明}（${row.位置.map(cell => `${cell.柱.replace(/柱$/u, '')}${cell.部位 === '天干' ? '干' : '支'}${cell.字}`).join('·')}）`;
}

/** 推算时辰：每个候选一行——时段与时柱、时柱自身的事实、与原局的关系、起运，给了前事年份时再列各年的区分事实。 */
function HourCandidateList({ data }: { data: HourCandidates }) {
    const birth = data.出生日期;
    const solar = birth.公历;
    return <>
        <p className="agent-ws-note">公历 {solar}（农历{birth.农历}）· {birth.性别}{data.共有柱.length ? ` · 共有 ${data.共有柱.map(pillar => `${pillar.柱}${pillar.干支}`).join(' ')}` : ''}{data.日主 ? `（日主${data.日主}）` : ''}</p>
        {data.当天交节 && <p className="agent-ws-note">当天交节：{data.当天交节}</p>}
        {data.前事年份 && <p className="agent-ws-note">前事 {data.前事年份.map(event => `${event.年份} ${event.流年}`).join('、')}</p>}
        <ol className="agent-ws-list" aria-label="候选时辰">
            {data.候选.map(candidate => {
                const hour = candidate.时柱;
                const truth = candidate.真太阳时 ? `（真太阳时 ${clockSpan(candidate.真太阳时.开始, candidate.真太阳时.结束, solar)}）` : '';
                return <li key={candidate.序号} data-hour-candidate={candidate.时辰}>
                    <strong>{candidate.时辰} · {clockSpan(candidate.钟表时间.开始, candidate.钟表时间.结束, solar)}{truth} · 时柱 {hour.干支}</strong>
                    <small>{[hour.天干十神, `日主坐${hour.地势}`, hour.纳音, hour.空亡 ? '空亡' : '', `命宫${candidate.命宫}`, candidate.日主之根, candidate.月令透时干.length ? `月令${candidate.月令透时干.join('、')}透时干` : ''].filter(Boolean).join(' · ')}</small>
                    <small>{candidate.时柱关系.length ? candidate.时柱关系.map(relationText).join(' · ') : '时柱与原局无合冲刑害'}</small>
                    <small>{candidate.起运}{candidate.首步大运 ? ` · 首步大运${candidate.首步大运.干支}（${candidate.首步大运.起运年份}）` : ''}</small>
                    {candidate.前事?.map(event => <small key={event.年份}>{event.年份} {event.流年}{event.大运 ? ` · ${event.大运}` : ''}：{[...event.关系.map(relationText), ...event.岁运提示].join(' · ') || '无区分候选的关系'}</small>)}
                </li>;
            })}
        </ol>
        <p className="agent-ws-note">只列各时辰的事实，不判断哪个更可能；时辰由你确认。</p>
    </>;
}

/** 推演的结构化结果：大运时间线、四柱候选、运限表、飞星、择日候选、合盘与候选时辰，按 Core 的计算种类选一种展示。 */
export function CalculationResult({ value }: { value: AgentCalculation }) {
    switch (value.kind) {
        case 'bazi_dayun': return <DayunTimeline data={value.data} />;
        case 'bazi_pillars_resolve': return <ResolveCandidates data={value.data} />;
        case 'ziwei_horoscope': return <HoroscopeTable data={value.data} />;
        case 'ziwei_flying_star': return <FlyingStars data={value.data} />;
        case 'almanac_select': return <AlmanacCandidates data={value.data} />;
        case 'bazi_hepan': return <HepanReading data={value.data} />;
        case 'bazi_hour_candidates': return <HourCandidateList data={value.data} />;
    }
}
