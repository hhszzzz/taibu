'use client';
// 需要按钮事件（定位到盘面）与 details 展开交互

import { LocateFixed } from 'lucide-react';
import type { BaziRelationsCanonicalJSON, BaziWuxingCanonicalJSON } from 'taibu-core/bazi';
import type { AgentRunStatus } from '@/lib/agent/types';
import type { AgentToolPart } from '@/lib/agent/tool-presentation';
import { getDrilldownFocus } from '@/lib/agent/chart-interaction';
import { describeDrilldownSelection, getAgentToolTitle } from './presentation';
import { WorkspaceToolPending } from './AgentWorkspaceViews';
import { layoutRelations, relationTone, type RelationRow } from '@/lib/divination/ganzhi-relation-layout';
import { asBaziRelations, asBaziWuxing } from './bazi-board';
import { GanzhiRelationOverlay, WuxingCycleStrip, relationBandHeight } from '@/components/bazi/result/GanzhiRelationOverlay';
import { ganZhiTextClass } from '@/components/bazi/element-classes';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Cell = { 柱?: unknown; 部位?: unknown; 字?: unknown };

/** 只展示事实段；计算规则留给 Core 规范文本，口径收进折叠说明。 */
const HIDDEN_SECTIONS = new Set(['计算规则', '口径']);
const MAX_COLUMNS = 6;

const isRecord = (value: Json | undefined): value is { [key: string]: Json } => !!value && typeof value === 'object' && !Array.isArray(value);
const isPrimitive = (value: Json | undefined): value is null | boolean | number | string => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const text = (value: Json | undefined) => value === null || value === undefined ? '-' : typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
const cellsText = (cells: Json) => Array.isArray(cells) ? (cells as Cell[]).map(cell => `${cell.柱 ?? ''}${cell.部位 ?? ''}${cell.字 ?? ''}`).join(' · ') : text(cells);

function relationRows(rows: Json[]): rows is Array<{ [key: string]: Json }> {
    return rows.every(row => isRecord(row) && typeof row.类型 === 'string' && Array.isArray(row.位置));
}

/** 「类型 · 参与 · 说明」：干支关系、宫位关系等带位置的事实行。 */
function RelationTable({ label, rows }: { label: string; rows: Array<{ [key: string]: Json }> }) {
    return <div className="agent-ws-table-scroll" tabIndex={0} aria-label={label}>
        <table className="agent-ws-table agent-ws-drilldown-table">
            <thead><tr><th scope="col">类型</th><th scope="col">参与</th><th scope="col">说明</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index}>
                <th scope="row">{text(row.类型)}</th><td>{cellsText(row.位置)}</td><td>{text(row.说明)}{row.结果 !== undefined ? `（${text(row.结果)}）` : ''}</td>
            </tr>)}</tbody>
        </table>
    </div>;
}

function RecordTable({ label, rows }: { label: string; rows: Array<{ [key: string]: Json }> }) {
    const columns = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => isPrimitive(row[key]) || Array.isArray(row[key]))))].slice(0, MAX_COLUMNS);
    return <div className="agent-ws-table-scroll" tabIndex={0} aria-label={label}>
        <table className="agent-ws-table agent-ws-drilldown-table">
            <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => {
                const value = row[column];
                return <td key={column}>{Array.isArray(value) ? value.filter(isPrimitive).map(text).join('、') || '-' : text(value)}</td>;
            })}</tr>)}</tbody>
        </table>
    </div>;
}

/** Core 详查 JSON 的通用视图：对象成 dl，带位置的行成关系表，扁平对象数组成表格，字符串数组成标签。 */
export function JsonSectionView({ label, value, depth = 0 }: { label: string; value: Json; depth?: number }) {
    if (isPrimitive(value)) return <p className="agent-ws-note">{text(value)}</p>;
    if (Array.isArray(value)) {
        if (!value.length) return <p className="agent-ws-note">无</p>;
        if (value.every(isPrimitive)) return <p className="agent-ws-chips" aria-label={label}>{value.map((item, index) => <span key={index}>{text(item)}</span>)}</p>;
        if (relationRows(value)) return <RelationTable label={label} rows={value} />;
        if (value.every(isRecord)) return <RecordTable label={label} rows={value as Array<{ [key: string]: Json }>} />;
        return <p className="agent-ws-note">{value.length} 项</p>;
    }
    const entries = Object.entries(value);
    if (!entries.length) return <p className="agent-ws-note">无</p>;
    const flat = entries.filter(([, item]) => isPrimitive(item));
    const nested = depth < 2 ? entries.filter(([, item]) => !isPrimitive(item)) : [];
    return <>
        {flat.length > 0 && <dl className="agent-ws-facts" aria-label={label}>
            {flat.map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{text(item)}</dd></div>)}
        </dl>}
        {nested.map(([key, item]) => <section key={key} className="agent-ws-drilldown-section">
            <h4>{key}</h4>
            <JsonSectionView label={key} value={item} depth={depth + 1} />
        </section>)}
    </>;
}

const NOTHING: ReadonlySet<string> = new Set();
/** 关系的类型标记与说明，一行一条；标记沿用盘面连线的配色。 */
function RelationLines({ label, rows }: { label: string; rows: readonly RelationRow[] }) {
    if (!rows.length) return <p className="agent-ws-note">无</p>;
    return <ul className="agent-ws-relation-lines" aria-label={label}>{rows.map((row, index) => {
        const { tone, mark } = relationTone(row.类型, row.位置.length);
        return <li key={index}><span data-tone={tone}>{mark}</span>{row.说明}{row.结果 && !row.说明.includes(row.结果) ? `（${row.结果}）` : ''}</li>;
    })}</ul>;
}

/** bazi_relations：参与的柱排成一条（原局四柱在前，大运流年等在后），关系画在柱位条上，下面逐条说明。 */
function BaziRelationsView({ result }: { result: BaziRelationsCanonicalJSON }) {
    const columns = result.参与柱位.map(pillar => pillar.柱);
    const rows = [...result.原局关系, ...(result.叠加关系 ?? [])];
    const layout = layoutRelations(rows, columns);
    const stemBand = relationBandHeight(layout.lanes.stem), branchBand = relationBandHeight(layout.lanes.branch);
    const notes = [...(result.岁运提示 ?? []), ...(result.太岁关系 ?? [])];
    return <>
        <div className="agent-ws-pillar-strip" data-relation-strip="">
            <table>
                <thead><tr>{result.参与柱位.map(pillar => <th key={pillar.柱} scope="col" data-layer={pillar.层}>{pillar.柱}{pillar.层 !== '原局' && <small>{pillar.层}</small>}</th>)}</tr></thead>
                <tbody>
                    <tr data-row="stem">{result.参与柱位.map(pillar => <td key={pillar.柱} style={{ paddingTop: stemBand + 4 }}>
                        <span className={ganZhiTextClass(pillar.干支.charAt(0))} data-relation-cell={pillar.柱 + ':天干'}>{pillar.干支.charAt(0)}</span>
                    </td>)}</tr>
                    <tr data-row="branch">{result.参与柱位.map(pillar => <td key={pillar.柱} style={{ paddingBottom: branchBand + 4 }}>
                        <span className={ganZhiTextClass(pillar.干支.charAt(1))} data-relation-cell={pillar.柱 + ':地支'}>{pillar.干支.charAt(1)}</span>
                    </td>)}</tr>
                    <tr data-row="tenGod">{result.参与柱位.map(pillar => <td key={pillar.柱}>{pillar.天干十神} · {pillar.地支主气十神}</td>)}</tr>
                </tbody>
            </table>
            {layout.edges.length > 0 && <GanzhiRelationOverlay layout={layout} located={NOTHING} />}
        </div>
        <section className="agent-ws-drilldown-section"><h4>原局关系 · {result.原局关系.length}</h4><RelationLines label="原局关系" rows={result.原局关系} /></section>
        {result.叠加关系 && <section className="agent-ws-drilldown-section"><h4>岁运叠加 · {result.叠加关系.length}</h4><RelationLines label="岁运叠加" rows={result.叠加关系} /></section>}
        {notes.length > 0 && <ul className="agent-ws-drilldown-notes" aria-label="岁运提示">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    </>;
}

const SEASONS = ['旺', '相', '休', '囚', '死'] as const;

/** bazi_wuxing：五行相生环与月令旺衰在上，通根、透干、自坐、相邻天干逐组列出，十神分布成表。 */
function BaziWuxingView({ result }: { result: BaziWuxingCanonicalJSON }) {
    return <>
        <WuxingCycleStrip dayElement={result.日主.五行}
            counts={result.五行统计.map(item => ({ 五行: item.五行, 合计: item.合计, 出现: !result.缺失五行.includes(item.五行) }))}
            caption={result.相生链.中断.length ? result.相生链.中断.join('；') : `相生链：${result.相生链.连续段.join('；') || '无'}`} />
        <ol className="agent-ws-seasons" aria-label={`月令${result.月令.月支}旺相休囚死`}>
            {SEASONS.map(season => <li key={season} data-day-master={result.月令[season] === result.日主.五行 || undefined}>
                <span>{season}</span><strong>{result.月令[season]}</strong>
            </li>)}
            <li className="agent-ws-seasons-note">月令{result.月令.月支}（{result.月令.月令五行}）· 日主{result.日主.天干}{result.日主.五行}{result.月令.日主状态}</li>
        </ol>
        {(['通根', '透干', '干支自坐', '相邻天干'] as const).map(key => <section key={key} className="agent-ws-drilldown-section">
            <h4>{key} · {result[key].length}</h4><RelationLines label={key} rows={result[key]} />
        </section>)}
        {result.十神分布.length > 0 && <section className="agent-ws-drilldown-section"><h4>十神分布</h4>
            <RecordTable label="十神分布" rows={result.十神分布 as unknown as Array<{ [key: string]: Json }>} />
        </section>}
    </>;
}

function DrilldownResult({ result, name }: { result: Json; name: string }) {
    if (!isRecord(result)) return <p className="agent-ws-note">没有可显示的详查结果。</p>;
    const relations = name === 'bazi_relations' ? asBaziRelations(result) : null;
    const wuxing = name === 'bazi_wuxing' ? asBaziWuxing(result) : null;
    const notes = Array.isArray(result.口径) ? result.口径.filter(isPrimitive) : [];
    return <>
        {relations ? <BaziRelationsView result={relations} />
            : wuxing ? <BaziWuxingView result={wuxing} />
            : Object.entries(result).filter(([key]) => !HIDDEN_SECTIONS.has(key)).map(([key, value]) => <section key={key} className="agent-ws-drilldown-section">
                <h4>{key}</h4>
                <JsonSectionView label={key} value={value} />
            </section>)}
        {notes.length > 0 && <details className="agent-ws-canonical">
            <summary>判定口径</summary>
            <ul className="agent-ws-drilldown-notes">{notes.map((note, index) => <li key={index}>{text(note)}</li>)}</ul>
        </details>}
    </>;
}

/** 命盘标签里的「详查」区：每次详查一条，最新的一条默认展开；「定位」在盘面上高亮它涉及的位置。 */
export function DrilldownList({ tools, runStatus, onLocate }: {
    tools: AgentToolPart[];
    runStatus: AgentRunStatus;
    onLocate?: (tool: AgentToolPart) => void;
}) {
    if (!tools.length) return null;
    return <section className="agent-ws-drilldowns" aria-label={`详查 ${tools.length} 条`}>
        <h3>详查 · {tools.length}</h3>
        {tools.map((tool, index) => {
            const input = tool.input && typeof tool.input === 'object' && !Array.isArray(tool.input) ? tool.input as Record<string, unknown> : {};
            const output = tool.output && typeof tool.output === 'object' ? tool.output as { result?: Json } : {};
            const focus = getDrilldownFocus(tool);
            return <details key={tool.id} className="agent-ws-drilldown" open={index === tools.length - 1}>
                <summary>
                    <strong>{getAgentToolTitle(tool)}</strong>
                    <span>{describeDrilldownSelection(input)}</span>
                </summary>
                {focus && focus.targetIds.length > 0 && onLocate && <button type="button" className="agent-secondary-button agent-ws-drilldown-locate" onClick={() => onLocate(tool)}>
                    <LocateFixed size={13} aria-hidden="true" />在盘面定位 {focus.targetIds.length} 处
                </button>}
                {tool.status === 'completed'
                    ? <DrilldownResult result={output.result ?? null} name={tool.name} />
                    : <WorkspaceToolPending tool={tool} runStatus={runStatus} running="正在详查…" />}
            </details>;
        })}
    </section>;
}
