/**
 * Markdown 内容渲染组件
 *
 * 'use client' 标记说明：
 * - 使用 React hooks (useMemo / useContext)
 * - ```chart 与 ```visual 交给 VisualizationBlock（内部再按需加载 ChartRenderer）
 *
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useMemo 缓存组件定义和 textClass
 * - 静态组件提取到组件外部
 */
'use client';

import { createContext, memo, useContext, useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import { MarkdownBlocks, markdownPlugins, pendingChartFence } from '@/lib/chat/markdown-blocks';
import { remarkCitations } from '@/lib/chat/markdown-citations';
import { extractVisualBlocks } from '@/lib/visualization/chart-data-extract';
import { VisualizationBlock } from '@/components/visualization/VisualizationBlock';
import { CodeBlock, MarkdownTable } from './MarkdownTools';
import { markdownLinkProps } from '@/lib/chat/markdown-links';

/** ```chart 与 ```visual 的流式状态：完成前只显示占位，未闭合的块按不完整处理。 */
interface VisualizationRenderState {
    live: boolean;
    pendingChart: boolean;
    incompleteVisual: string | null;
    onChartError?: () => void;
}

const VisualizationRenderContext = createContext<VisualizationRenderState>({ live: false, pendingChart: false, incompleteVisual: null });

/** Answer citations: known numbers become badges that open their source. */
export interface MarkdownCitations {
    /** Title of each number the text may cite; any other number stays plain text. */
    labels: ReadonlyMap<number, string>;
    /** The number whose source is open, marked on its badges. */
    active?: number | null;
    onOpen?: (cite: number) => void;
}

interface MarkdownContentProps {
    content: string;
    className?: string;
    streaming?: boolean;
    citations?: MarkdownCitations;
    onChartError?: () => void;
}

/** ```chart / ```visual 统一交给 VisualizationBlock；其余代码块保持原样。 */
const MarkdownCode: NonNullable<Components['code']> = ({ className, children }) => {
    const visualization = useContext(VisualizationRenderContext);
    const language = /language-(\w+)/.exec(className || '')?.[1];
    const source = String(children);
    const isInline = !className && !source.includes('\n');

    if (!isInline && (language === 'chart' || language === 'visual')) {
        return <div className="max-w-full overflow-x-auto">
            <VisualizationBlock
                kind={language}
                source={source}
                streaming={language === 'chart' ? visualization.live && visualization.pendingChart : visualization.live}
                incomplete={language === 'visual' && visualization.incompleteVisual !== null && source.trim() === visualization.incompleteVisual}
                onChartError={visualization.onChartError}
            />
        </div>;
    }

    if (!isInline) return <CodeBlock code={source} language={language ?? ''} />;
    return <code className="px-1 py-0.5 rounded bg-background-secondary text-xs">{children}</code>;
};

// 静态组件定义，避免每次渲染重新创建
const staticComponents: Partial<Components> = {
    h1: ({ children }) => (
        <h1 className="text-2xl font-bold mt-6 mb-4 text-foreground">{children}</h1>
    ),
    h2: ({ children }) => (
        <h2 className="text-xl font-bold mt-5 mb-3 text-foreground">{children}</h2>
    ),
    h3: ({ children }) => (
        <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground">{children}</h3>
    ),
    h4: ({ children }) => (
        <h4 className="text-base font-semibold mt-3 mb-2 text-foreground">{children}</h4>
    ),
    h5: ({ children }) => (
        <h5 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h5>
    ),
    h6: ({ children }) => (
        <h6 className="text-sm font-medium mt-2 mb-1 text-foreground-secondary">{children}</h6>
    ),
    a: ({ href, children }) => (
        <a href={href} {...markdownLinkProps(href)} className="text-accent underline underline-offset-2">{children}</a>
    ),
    blockquote: ({ children }) => (
        <blockquote className="border-l-4 border-accent/50 pl-4 py-1 my-3 italic text-foreground-secondary">
            {children}
        </blockquote>
    ),
    hr: () => <hr className="my-6 border-border" />,
    table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
    pre: ({ children }) => <div className="markdown-code-block">{children}</div>,
    thead: ({ children }) => (
        <thead className="border-b border-border">{children}</thead>
    ),
    tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => (
        <th className="px-3 py-2 text-left font-semibold text-foreground">{children}</th>
    ),
    td: ({ children }) => (
        <td className="px-3 py-2 text-foreground">{children}</td>
    ),
    strong: ({ children }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    code: MarkdownCode,
};

// remarkPlugins 数组提取到外部，避免每次渲染创建新数组
const remarkPlugins = markdownPlugins;

const MarkdownBlock = memo(function MarkdownBlock({ content, className, messageStreaming = false, citations, onChartError }: Omit<MarkdownContentProps, 'streaming'> & { messageStreaming?: boolean }) {
    // 使用 useMemo 缓存 textClass，避免每次渲染重新拼接字符串
    const textClass = useMemo(
        () => `leading-relaxed ${className ?? 'text-sm text-foreground'}`,
        [className]
    );

    // 可视化块的流式状态：整条消息完成前 ```visual 只显示占位；未闭合的块按不完整处理。
    const visualization = useMemo<VisualizationRenderState>(() => ({
        live: messageStreaming,
        pendingChart: pendingChartFence(content),
        incompleteVisual: extractVisualBlocks(content).find(block => !block.complete)?.raw.trim() ?? null,
        onChartError,
    }), [messageStreaming, content, onChartError]);

    // 使用 useMemo 缓存依赖 className 的组件
    const dynamicComponents = useMemo<Partial<Components>>(() => ({
        p: ({ children }) => (
            <p className={`${textClass} whitespace-pre-wrap`}>{children}</p>
        ),
        ul: ({ children }) => (
            <ul className={`${textClass} list-disc pl-5 space-y-1`}>{children}</ul>
        ),
        ol: ({ children }) => (
            <ol className={`${textClass} list-decimal pl-5 space-y-1`}>{children}</ol>
        ),
        li: ({ children }) => <li className={textClass}>{children}</li>,
        ...(citations ? {
            sup: ({ node, children }) => {
                const cite = Number(node?.properties?.dataCite);
                const label = citations.labels.get(cite);
                if (label === undefined) return <sup>{children}</sup>;
                const open = citations.onOpen;
                // Without a workspace to open the source in, the badge only names it.
                if (!open) return <sup className="md-cite" data-cite={cite} title={label}>{cite}</sup>;
                return <Button unstyled className="md-cite" data-cite={cite} data-active={citations.active === cite || undefined}
                    aria-label={`依据 ${cite}：${label}`} title={label} onClick={() => open(cite)}>{cite}</Button>;
            },
        } satisfies Partial<Components> : {}),
    }), [textClass, citations]);
    const plugins = useMemo<PluggableList>(() => citations ? [...remarkPlugins, [remarkCitations, { isKnown: (cite: number) => citations.labels.has(cite) }]] : remarkPlugins, [citations]);

    // 合并静态和动态组件
    const components = useMemo<Partial<Components>>(
        () => ({ ...staticComponents, ...dynamicComponents }),
        [dynamicComponents]
    );

    return (
        <VisualizationRenderContext.Provider value={visualization}>
            <ReactMarkdown remarkPlugins={plugins} components={components}>
                {content}
            </ReactMarkdown>
        </VisualizationRenderContext.Provider>
    );
});

function MarkdownContentInner({ content, className, streaming = false, citations, onChartError }: MarkdownContentProps) {
    const cache = useMemo(() => new MarkdownBlocks(), []);
    const blocks = useMemo(() => cache.advance(content), [cache, content]);
    return <>{blocks.map((block, index) => <MarkdownBlock key={index} content={block} className={className} messageStreaming={streaming} citations={citations} onChartError={onChartError} />)}</>;
}

// 使用 memo 包装，只在 props（content、className、streaming、citations、onChartError）变化时重渲染
export const MarkdownContent = memo(MarkdownContentInner);
