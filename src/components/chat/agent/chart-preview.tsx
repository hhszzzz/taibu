'use client';
// 概览卡的简化预览：每种占术给一个能一眼认出盘面的小图，数据全部来自该盘已保存的 canonical JSON。

import { getStemElement, getBranchElement, getElementColor } from '@/lib/divination/display-helpers';
import { HEXAGRAMS } from '@/lib/divination/liuyao';
import type { AgentChart } from '@/lib/agent/tool-presentation';
import { ziweiRingCells } from '@/lib/divination/ziwei';
import { parseTraditionalYaoPosition } from '@/lib/divination/liuyao-result-state';

const chip = (key: string, label: string, value: string) =>
    <span key={key} className="chart-mini-chip"><small>{label}</small>{value}</span>;

/** 六爻线：阳实阴虚；动爻用 accent 加亮（自上而下与卦盘一致）。 */
function HexagramLines({ code, moving = [], label }: { code: string; moving?: number[]; label?: string }) {
    return <span className="chart-mini-lines" aria-hidden="true">
        {[...code].map((bit, index) => <span key={index} data-yang={bit === '1' || undefined} data-moving={moving.includes(index + 1) || undefined} />).reverse()}
        {label && <small className="chart-mini-lines-label">{label}</small>}
    </span>;
}

/** 九宫小图（奇门）：上南下北、左东右西，按宫位序号落格。 */
function NineGrid({ cells }: { cells: Array<{ 宫位序号: number; 八门: string; 九星: string }> }) {
    const layout = [4, 9, 2, 3, 5, 7, 8, 1, 6];
    return <span className="chart-mini-grid" aria-hidden="true">
        {layout.map(order => {
            const cell = cells.find(item => item.宫位序号 === order);
            return <span key={order} data-center={order === 5 || undefined}>{cell ? <>{cell.八门}<small>{cell.九星}</small></> : null}</span>;
        })}
    </span>;
}

/** 紫微十二宫：按宫位地支落到与完整命盘相同的 4×4 外环格，命宫 clay 高亮，中宫写五行局。 */
function ZiweiRing({ palaces, center }: { palaces: Array<{ 宫位: string; 干支: string; 主星及四化?: Array<{ 星名: string }> }>; center: string }) {
    return <span className="chart-mini-ring" aria-hidden="true">
        {ziweiRingCells(palaces).map(({ palace, row, col }) => {
            const main = (palace.主星及四化 ?? []).map(star => star.星名).slice(0, 2).join('');
            return <span key={palace.干支} className="chart-mini-ring-cell" data-life={palace.宫位 === '命宫' || undefined}
                style={{ gridRow: row + 1, gridColumn: col + 1 }}>
                <small>{palace.宫位.replace('宫', '')}</small>{main || palace.干支}
            </span>;
        })}
        <span className="chart-mini-ring-center">{center}</span>
    </span>;
}

/** 概览卡的小图；数据不足时返回 null，调用方回退到占术图标。 */
export function ChartMiniPreview({ value }: { value: AgentChart }) {
    switch (value.kind) {
        case 'bazi': {
            const color = (element: ReturnType<typeof getStemElement>) => element ? { color: getElementColor(element) } : undefined;
            const labels = ['年', '月', '日', '时'];
            return <span className="chart-mini-pillars" aria-hidden="true">{value.chart.四柱.map((pillar, index) => {
                const [stem, branch] = [pillar.干支.charAt(0), pillar.干支.charAt(1)];
                return <span key={pillar.柱}><small>{labels[index] ?? pillar.柱}</small>
                    <span style={color(getStemElement(stem))}>{stem}</span><span style={color(getBranchElement(branch))}>{branch}</span>
                    <small data-role="god">{pillar.天干十神 || ' '}</small></span>;
            })}</span>;
        }
        case 'ziwei': {
            const basic = value.chart.基本信息;
            return <ZiweiRing palaces={value.chart.十二宫位} center={basic.五行局} />;
        }
        case 'qimen': {
            const basic = value.chart.基本信息;
            return <span className="chart-mini-row">
                <NineGrid cells={value.chart.九宫盘} />
                <span className="chart-mini-stack">
                    {chip('j', '局式', basic.局式)}
                    {chip('f', '值符', basic.值符)}
                    {chip('s', '值使', basic.值使)}
                </span>
            </span>;
        }
        case 'liuyao': {
            const board = value.chart.卦盘;
            const hexagram = HEXAGRAMS.find(row => row.name === board.本卦.卦名);
            // 动爻直接读盘面里带「变爻」的爻位，不靠本变卦卦码比对推断。
            const moving = value.chart.六爻.flatMap(line => line.变爻 ? [parseTraditionalYaoPosition(line.爻位) ?? 0] : []).filter(position => position > 0);
            const shi = value.chart.六爻.find(line => line.世应 === '世');
            return <span className="chart-mini-row">
                {hexagram && <HexagramLines code={hexagram.code} moving={moving} label={board.本卦.卦名} />}
                <span className="chart-mini-stack">
                    {board.变卦 ? chip('v', '变卦', board.变卦.卦名) : null}
                    {shi ? chip('s', '世', `${shi.爻位} ${shi.六亲}`) : null}
                    {chip('m', '动爻', moving.length ? `${moving.length} 爻` : '静卦')}
                </span>
            </span>;
        }
        case 'meihua': {
            const board = value.chart.卦盘;
            const hexagram = HEXAGRAMS.find(row => row.name === board.本卦.卦名);
            return <span className="chart-mini-row">
                {hexagram && <HexagramLines code={hexagram.code} label={board.本卦.卦名} />}
                <span className="chart-mini-stack">
                    {chip('d', '动爻', board.动爻)}
                    {chip('v', '变卦', board.变卦.卦名)}
                    {chip('t', '体用', `${board.体卦.卦名} · ${board.用卦.卦名}`)}
                </span>
            </span>;
        }
        case 'daliuren': {
            return <span className="chart-mini-row">
                <span className="chart-mini-stack">
                    {chip('k', '课式', value.chart.基本信息.课式.split(' ')[0])}
                    {chip('y', '月将', value.chart.基本信息.月将)}
                </span>
                <span className="chart-mini-transmissions" aria-hidden="true">
                    {value.chart.三传.map(row => <span key={row.传序}>
                        <small>{row.传序.slice(0, 1)}</small>
                        <b>{row.地支}</b>
                        <em>{row.天将 ?? ''}</em>
                    </span>)}
                </span>
            </span>;
        }
        case 'xiaoliuren': {
            const result = value.chart.结果;
            return <span className="chart-mini-row">
                <span className="chart-mini-glyph" aria-hidden="true">{result.落宫}</span>
                <span className="chart-mini-stack">
                    {chip('x', '性质', result.性质)}
                    {chip('w', '五行', result.五行)}
                    {chip('f', '方位', result.方位)}
                </span>
            </span>;
        }
        case 'tarot': {
            return <span className="chart-mini-row">
                <span className="chart-mini-cards" aria-hidden="true">
                    {value.chart.牌阵展开.slice(0, 3).map((card, index) => <span key={index} data-reversed={card.状态 === '逆位' || undefined}>
                        <small>{card.位置}</small>{card.塔罗牌}{card.状态 === '逆位' && <em>逆位</em>}
                    </span>)}
                </span>
                {chip('s', '牌阵', value.chart.问卜设定.牌阵)}
            </span>;
        }
        case 'taiyi': {
            const rows = value.chart.九星阵列 ?? [];
            return <span className="chart-mini-row">
                <span className="chart-mini-stack">
                    {chip('q', '四柱', value.chart.问卜与时空底盘.四柱)}
                    {chip('s', '值星', value.chart.外部时空环境?.值星 ?? '—')}
                </span>
                {rows.length > 0 && <span className="chart-mini-stars" aria-hidden="true">
                    {rows.map(row => <span key={row.观测层级}><small>{row.观测层级.replace('盘', '')}</small>{row.太乙名}<em>{row.方位}</em></span>)}
                </span>}
            </span>;
        }
        case 'astrology': {
            const anchors = value.chart.命盘锚点;
            return <span className="chart-mini-row">
                <span className="chart-mini-wheel" aria-hidden="true"><i /><b /><em /></span>
                <span className="chart-mini-stack">
                    {chip('s', '太阳', anchors.太阳.星座)}
                    {chip('m', '月亮', anchors.月亮.星座)}
                    {anchors.上升 ? chip('a', '上升', anchors.上升.星座) : null}
                    {anchors.天顶 ? chip('c', '天顶', anchors.天顶.星座) : null}
                </span>
            </span>;
        }
        case 'almanac': {
            const chart = value.chart;
            return <span className="chart-mini-row">
                <span className="chart-mini-glyph" aria-hidden="true">{chart.基础与个性化坐标.日干支}</span>
                <span className="chart-mini-stack">
                    {chip('y', '宜', chart.择日宜忌.宜.slice(0, 3).join('、') || '无')}
                    {chip('j', '忌', chart.择日宜忌.忌.slice(0, 3).join('、') || '无')}
                </span>
            </span>;
        }
    }
}
