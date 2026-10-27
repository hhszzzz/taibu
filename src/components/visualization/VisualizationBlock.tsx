'use client';

import { lazy, Suspense, useId, useMemo, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { parseChartSource, parseVisualSource, VISUAL_BLOCK_MAX_BYTES } from '@/lib/visualization/chart-data-extract';
import VisualFrame from './VisualFrame';
import './visualization.css';

const ChartRenderer = lazy(() => import('./ChartRenderer'));

export interface VisualizationBlockProps {
    kind: 'chart' | 'visual';
    /** ```chart 的 JSON 正文，或 ```visual 的 HTML 正文。 */
    source: string;
    /** 消息仍在流式生成：只显示占位，完成后才渲染。 */
    streaming?: boolean;
    /** ```visual 围栏没有闭合。 */
    incomplete?: boolean;
    className?: string;
}

const CHART_LOADING = <div className="visualization-placeholder">加载图表...</div>;

/**
 * 普通对话、Agent 回答与分享页共用的可视化卡片：
 * 标题、全屏、主题跟随，以及错误时的数据/源码兜底。
 */
export function VisualizationBlock({ kind, source, streaming = false, incomplete = false, className = '' }: VisualizationBlockProps) {
    const [showSource, setShowSource] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const titleId = useId();
    const chart = useMemo(() => kind === 'chart' ? parseChartSource(source) : null, [kind, source]);
    const visual = useMemo(() => kind === 'visual' ? parseVisualSource(source) : null, [kind, source]);
    const title = chart?.title || visual?.title || (kind === 'chart' ? '图表' : '可视化');
    const sourceLabel = kind === 'chart' ? '查看数据' : '查看源码';

    const body = streaming
        ? <div className="visualization-placeholder" role="status">{kind === 'chart' ? '图表正在生成…' : '可视化正在生成…'}</div>
        : kind === 'chart'
            ? <ChartBody chart={chart} />
            : <VisualBody visual={visual} incomplete={incomplete} title={title} />;

    return <section className={`visualization-card ${className}`} data-visualization={kind} data-streaming={streaming || undefined}>
        <header className="visualization-head">
            <p className="visualization-title" title={title}>{title}</p>
            {!streaming && <div className="visualization-actions">
                <button type="button" className="visualization-action" aria-pressed={showSource}
                    onClick={() => setShowSource(current => !current)}>{sourceLabel}</button>
                <button type="button" className="visualization-action visualization-expand" aria-label="全屏查看"
                    onClick={() => setExpanded(true)}><Maximize2 size={14} aria-hidden="true" /></button>
            </div>}
        </header>
        {body}
        {showSource && !streaming && <pre className="visualization-source" data-visualization-source="">{source}</pre>}
        <Modal open={expanded} onClose={() => setExpanded(false)} labelledBy={titleId} className="visualization-dialog">
            <div className="visualization-dialog-head">
                <h2 id={titleId}>{title}</h2>
                <button type="button" className="visualization-action" aria-label="关闭全屏" onClick={() => setExpanded(false)}><X size={16} aria-hidden="true" /></button>
            </div>
            <div className="visualization-dialog-body">
                {kind === 'chart' ? <ChartBody chart={chart} /> : <VisualBody visual={visual} incomplete={incomplete} title={title} minHeight={320} />}
            </div>
        </Modal>
    </section>;
}

function ChartBody({ chart }: { chart: ReturnType<typeof parseChartSource> }) {
    // 卡片标题栏已经显示标题；运势雷达、大运趋势、运势日历还在图表内部再画一次 h3，这里传空标题避免重复。
    const body = useMemo(() => chart ? { ...chart, title: '' } : null, [chart]);
    if (!body) return <div className="visualization-error">图表数据解析失败，可查看数据。</div>;
    return <div className="visualization-body">
        <Suspense fallback={CHART_LOADING}><ChartRenderer data={body} /></Suspense>
    </div>;
}

function VisualBody({ visual, incomplete, title, minHeight }: {
    visual: ReturnType<typeof parseVisualSource> | null;
    incomplete: boolean;
    title: string;
    minHeight?: number;
}) {
    if (incomplete) return <div className="visualization-error">可视化内容不完整（代码块没有闭合），可查看源码。</div>;
    if (!visual) return <div className="visualization-error">可视化内容无法解析，可查看源码。</div>;
    if (visual.tooLarge) return <div className="visualization-error">可视化内容超过 {Math.round(VISUAL_BLOCK_MAX_BYTES / 1024)} KB，已停止渲染，可查看源码。</div>;
    if (!visual.html) return <div className="visualization-error">可视化内容为空。</div>;
    return <div className="visualization-body">
        <VisualFrame html={visual.html} title={title} minHeight={minHeight} />
    </div>;
}
