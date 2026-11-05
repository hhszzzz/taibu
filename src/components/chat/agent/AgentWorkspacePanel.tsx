'use client';
// 需要 useState/useEffect、拖拽调整宽度与 sessionStorage 恢复标签

import { useEffect, useId, useMemo, useRef, useState, lazy, Suspense, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { useIsDesktopLayout } from '@/lib/hooks/useIsDesktopLayout';
import { useEntranceMotion } from '@/lib/motion/entrance';
import { Ellipsis, LayoutGrid, LocateFixed, Maximize2, Minimize2, Search, X } from 'lucide-react';
import { getAgentToolFamily, isAgentChartTool } from '@/lib/agent/tool-catalog';
import { isAgentRunTerminal, type AgentMessageData, type AgentPart } from '@/lib/agent/types';
import { getAgentChart, getAgentToolArtifactId, getAgentToolText } from '@/lib/agent/tool-presentation';
import { findSavedAgentChart, getAgentChartSave } from '@/lib/agent/chart-save';
import { useUserCharts } from '@/lib/hooks/useUserCharts';
import { parallelAnalysisResults } from '@/lib/agent/parallel-results';
import { getAgentChartReference, getChartFocus, getDrilldownFocus, getLatestChartFocus, parseChartReference, type ChartAskContext } from '@/lib/agent/chart-interaction';
import {
    AGENT_WORKSPACE_SECTIONS, buildAgentWorkspace, getAgentToolQuestionIds, getAgentWorkspaceFollowTarget, getAgentWorkspaceLocation, getAgentWorkspaceSections,
    isAgentRunWorking, parseAgentCitationTarget, resolveAgentWorkspaceLocation,
    type AgentQuestionAnswer, type AgentWorkspaceModel, type AgentWorkspaceResource, type AgentWorkspaceSection,
} from '@/lib/agent/workspace';
import { questionDraftKey } from '@/lib/agent/question-drafts';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Dialog } from '@/components/ui/Dialog';
import { AgentToolCard } from './AgentToolCard';
import { describeAgentChartSubject, getAgentStepNumbers, getAgentToolState, type AgentArtifact } from './presentation';
import type { AgentWorkspaceShown } from './AgentResultContext';
import {
    ArchiveView, AttachmentView, CalculationView, CollaborationView, DataListView, EvidenceView, HistoryView, MemberView, MemoryView, MethodView,
    NotesView, ProfileView, QuestionView, RecordView, ScriptView, WorkspaceTextFallback, WorkspaceToolMeta, WorkspaceToolPending,
} from './AgentWorkspaceViews';
import { getChartKindMeta } from './chart-registry';
import { ModelAvatar } from './ModelAvatar';
import { AgentPlanView } from './AgentPlanView';
import { WorkspaceOverview } from './AgentWorkspaceSections';
import { DrilldownList } from './AgentDrilldownViews';
import { getLatestBaziWuxing } from './bazi-board';
import { AgentChartSave } from './AgentChartSave';
const ChartPreview = lazy(() => import('./AgentChartPreview').then(module => ({ default: module.AgentChartPreview })));
const InteractiveChart = lazy(() => import('./AgentInteractiveChart').then(module => ({ default: module.AgentInteractiveChart })));

const MAX_TABS = 20;
// 工作区是停靠分栏（claude artifacts 预览面板形态）：桌面布局（≥1024，与全站侧栏、会话栏同一断点）参与布局、不遮对话，
// 更窄的屏幕改为弹窗 / 底部抽屉。默认占约 42% 并封顶 560px，比对话列窄但盘面仍能舒展；用户手动调宽后以手动值为准。
// 量不到面板宽度时（尚未布局）按 560 起算拖拽与键盘调整。
const FALLBACK_WIDTH = 560;
// 拖拽边界：面板 280–780，且始终给阅读列留 360（与 .agent-workspace-panel 的 max-width 一致）。
const MIN_WIDTH = 280;
const MAX_WIDTH = 780;
const READING_MIN = 360;
// 面板只保留右外边距 4px（与上、下齐平）；左侧与对话列齐平，拖动时不会露出一条底色带。
const PANEL_GUTTER = 4;
// 默认宽为可用宽度的 42%，上限 560px；min/max-width 仍按上面的边界收口。
const DEFAULT_WIDTH = `min(560px, calc((100% - ${PANEL_GUTTER}px) * .42))`;
const SECTION_LABELS: Record<AgentWorkspaceSection, string> = { results: '概览' };
const TAB_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
const LIVE_LABELS = { running: '正在更新', waiting: '等待回答' } as const;
const isSection = (id: string | null): id is AgentWorkspaceSection => id !== null && (AGENT_WORKSPACE_SECTIONS as readonly string[]).includes(id);

type SavedWorkspace = { tabs: string[]; selected: string | null; followModel: boolean };
function readSavedWorkspace(workspaceKey: string): Partial<SavedWorkspace> {
    try {
        const saved = JSON.parse(sessionStorage.getItem(`taibu.workspace:${workspaceKey}`) ?? 'null');
        if (!saved || typeof saved !== 'object') return {};
        return {
            tabs: Array.isArray(saved.tabs) ? saved.tabs.filter((id: unknown): id is string => typeof id === 'string').slice(0, MAX_TABS) : undefined,
            selected: typeof saved.selected === 'string' ? saved.selected : undefined,
            followModel: typeof saved.followModel === 'boolean' ? saved.followModel : undefined,
        };
    } catch {
        return {};
    }
}

/** One resource's view, chosen by its tool family. Any rendering error falls back to the tool's canonical text. */
function ResourceView({ resource, model, data, answers, questionIds, userId, artifacts, numbers, followModel, live, namedToolId, cite, citedParagraph, draftScope, onOpen, onChartQuestion }: {
    resource: AgentWorkspaceResource; model: AgentWorkspaceModel; data?: AgentMessageData;
    answers: ReadonlyMap<string, AgentQuestionAnswer>; questionIds: ReadonlyMap<string, string>; userId: string | null;
    artifacts: AgentArtifact[];
    /** 第 N 步 of the latest task's calls. */
    numbers: ReadonlyMap<string, number>;
    followModel: boolean;
    /** The model is working, so the view may say whether it is being followed. */
    live: boolean;
    /** A call of this view the reader opened by name, from its step or a citation, while not following. */
    namedToolId: string | null; cite: number | null;
    citedParagraph?: (cite: number) => number | null;
    /** Owner and conversation of the answer panel's drafts; the task and question complete the key. */
    draftScope: string;
    onOpen: (id: string) => void; onChartQuestion?: (ask: ChartAskContext) => void;
}) {
    const tools = resource.toolIds.flatMap(id => model.toolsById.get(id) ?? []);
    const latest = tools.at(-1);
    const runStatus = data?.status ?? 'completed';
    const step = (tool: { id: string } | undefined) => tool ? numbers.get(tool.id) : undefined;
    let body: ReactNode;
    switch (resource.view) {
        case 'chart': {
            const reading = tools.findLast(tool => getAgentChart(tool));
            const value = reading && getAgentChart(reading);
            const reference = reading ? getAgentChartReference(reading) : null;
            // A focus step opened from the process list or a citation shows that position, not the latest one.
            const named = namedToolId ? model.toolsById.get(namedToolId) : undefined;
            const opened = named && reference ? getChartFocus(named) ?? getDrilldownFocus(named) : null;
            const pinned = opened?.reference === reference ? opened : null;
            const drilldowns = tools.filter(tool => getAgentToolFamily(tool.name) === 'drilldown');
            const drilldownList = <DrilldownList tools={drilldowns} runStatus={runStatus} onLocate={tool => onOpen('tool:' + tool.id)} />;
            const focus = pinned ?? (reference ? getLatestChartFocus(model.tools, reference) : null);
            // The calculation that produced the reading, or the saved chart it read back.
            const source = tools.find(tool => isAgentChartTool(tool.name) && getAgentChart(tool)) ?? reading;
            // 按宫位查看只回定位目录、没有规范文本：盘面复制与兜底的文本取最近一次带规范文本的读取。
            const textSource = tools.findLast(tool => getAgentChart(tool) && getAgentToolText(tool));
            body = value && reading
                ? <Suspense fallback={<p role="status">加载命盘…</p>}>
                    <InteractiveChart key={`${reference ?? reading.id}:${pinned ? named!.id : ''}`} value={value} tool={textSource ?? reading} reference={reference}
                        focus={focus} followModel={followModel} live={live} pinned={pinned !== null} subject={describeAgentChartSubject(source ?? reading, value)}
                        baziWuxing={value.kind === 'bazi' ? getLatestBaziWuxing(drilldowns) : undefined}
                        actions={source && <AgentChartSave tool={source} userId={userId} />}
                        onAsk={onChartQuestion} />
                </Suspense>
                // 详查的结果已经落在盘面上（定位高亮，八字的自坐、相邻天干连线与根透标记），规范文本在对话的步骤里展开；这里不再重复列出。
                // A drilldown of a saved chart not read in this task has no board, so its findings show here instead.
                : drilldowns.length ? drilldownList
                : latest && latest.status === 'completed' ? <WorkspaceTextFallback tool={latest} note="命盘数据不完整，已保留工具返回内容。" />
                : latest && <><WorkspaceToolMeta tool={latest} runStatus={runStatus} /><WorkspaceToolPending tool={latest} runStatus={runStatus} running="正在排盘…" /></>;
            break;
        }
        case 'saved': {
            const artifact = artifacts.find(item => 'chart:' + item.id === resource.id);
            body = artifact && <Suspense fallback={<p>加载预览…</p>}>
                <ChartPreview artifact={artifact} tools={model.tools} followModel={followModel} onAsk={onChartQuestion} />
            </Suspense>;
            break;
        }
        case 'calculation': body = latest && <CalculationView tool={latest} runStatus={runStatus} step={step(latest)} />; break;
        case 'evidence': body = <EvidenceView model={model} tools={tools} runStatus={runStatus} selected={cite}
            paragraph={cite !== null ? citedParagraph?.(cite) ?? null : null} onOpen={onOpen} />; break;
        case 'data': body = <DataListView tools={tools} runStatus={runStatus} step={step(tools.findLast(tool => tool.status === 'completed') ?? latest)} />; break;
        case 'record': {
            const reference = parseChartReference(latest?.output && typeof latest.output === 'object' ? (latest.output as { chartReference?: unknown }).chartReference : undefined);
            const chart = reference ? model.chartResources.get(reference.source + ':' + reference.id) : undefined;
            body = <RecordView tools={tools} runStatus={runStatus} title={resource.title} step={step(latest)} onOpenChart={chart ? () => onOpen(chart) : undefined} />;
            break;
        }
        case 'profile': body = latest && <ProfileView tool={latest} runStatus={runStatus} step={step(latest)} />; break;
        case 'notes': body = <NotesView tools={tools} runStatus={runStatus} step={step(tools.findLast(tool => tool.status === 'completed') ?? latest)} />; break;
        case 'history': body = <HistoryView tools={tools} runStatus={runStatus} step={step(tools.findLast(tool => tool.status === 'completed') ?? latest)} />; break;
        case 'archive': body = <ArchiveView tools={tools} runStatus={runStatus} step={step(latest)} />; break;
        case 'attachment': body = <AttachmentView id={resource.id.slice('attachment:'.length)} title={resource.title} tools={tools} />; break;
        case 'method': body = <MethodView tools={tools} runStatus={runStatus} step={step(tools.findLast(tool => tool.status === 'completed') ?? latest)} />; break;
        case 'plan': body = <AgentPlanView tools={tools} runStatus={runStatus} step={step(latest)} />; break;
        case 'question': {
            const questionId = latest && questionIds.get(latest.id);
            body = latest && <QuestionView tool={latest} runStatus={runStatus} step={step(latest)} model={model}
                answer={questionId ? answers.get(questionId) : undefined} draftKey={questionId && data ? questionDraftKey(`${draftScope}:${data.runId}`, questionId) : null} />;
            break;
        }
        case 'collaboration': {
            // A collaboration opened from its step shows that call; step numbers belong to the latest task.
            const tool = tools.find(item => item.id === namedToolId) ?? latest;
            body = tool && <CollaborationView tool={tool} runStatus={runStatus} step={step(tool)} onOpenMember={conversationId => onOpen(`member:${tool.id}:${conversationId}`)} />;
            break;
        }
        case 'member': {
            const memberTool = resource.member ? model.toolsById.get(resource.member.toolId) : undefined;
            const member = memberTool && resource.member ? parallelAnalysisResults(memberTool.output).find(item => item.conversationId === resource.member!.conversationId) : undefined;
            body = memberTool && member ? <MemberView tool={memberTool} member={member} runStatus={runStatus} step={step(memberTool)} />
                : <p className="agent-ws-note">这位成员的分析不在当前对话中。</p>;
            break;
        }
        case 'memory': body = <MemoryView tools={tools} runStatus={runStatus} userId={userId} step={step(latest)} />; break;
        case 'code': body = latest && <ScriptView tool={latest} runStatus={runStatus} step={step(latest)} calls={model.tools.filter(tool => tool.parentId === latest.id)} onOpen={onOpen} />; break;
        case 'tool': body = latest && <AgentToolCard tool={latest} runStatus={runStatus} />; break;
    }
    return latest ? <ChartErrorBoundary resetKey={latest} fallback={<WorkspaceTextFallback tool={latest} note="这个视图暂时无法显示，已改为工具返回的规范文本。" />}>{body}</ChartErrorBoundary> : <>{body}</>;
}

export function AgentWorkspacePanel({ parts, artifacts, data, attachmentIds, answers, userId, onClose, workspaceKey, requestedResource, onChartQuestion, onShownChange, citedParagraph, entering = false, leaving = false }: {
    workspaceKey: string;
    /** Opened just now by the reader or by the model's first board: slides in. Restored with its conversation: appears as is. */
    entering?: boolean;
    /** Closed: plays the way out, then the conversation unmounts it. */
    leaving?: boolean;
    /** Agent parts of the visible conversation branch, in transcript order. */
    parts: AgentPart[];
    artifacts: AgentArtifact[];
    data?: AgentMessageData;
    attachmentIds: string[];
    answers?: ReadonlyMap<string, AgentQuestionAnswer>;
    userId?: string | null;
    onClose: () => void;
    requestedResource?: { id: string; version: number };
    onChartQuestion?: (ask: ChartAskContext) => void;
    /** Reports the tool view on screen so the chat can mark its step and result card. */
    onShownChange?: (shown: AgentWorkspaceShown | null) => void;
    /** The paragraph of the answer that cites a number, counted from 1. */
    citedParagraph?: (cite: number) => number | null;
}) {
    const desktop = useIsDesktopLayout();
    const panelRef = useRef<HTMLElement>(null);
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
    // 拖拽中的实时宽度：直接写 DOM，避免每次 pointermove 都重渲染整个工作区（图表很重）。
    const widthRef = useRef<number | null>(null);
    const resizerRef = useRef<HTMLDivElement>(null);
    // 进场只看挂载那一刻：已经开着的面板被再次「打开」（模型又看了一张盘）时不重放滑入。
    const [enterOnMount] = useState(entering);
    const mountedAt = useRef(0);
    useEffect(() => { mountedAt.current = performance.now(); }, []);
    const scrollRef = useRef<HTMLDivElement>(null);
    const ids = useId();
    const [searchOpen, setSearchOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [maximized, setMaximized] = useState(false);
    const model = useMemo(() => buildAgentWorkspace({ parts, artifacts, attachmentIds }), [parts, artifacts, attachmentIds]);
    // 用户一旦手动调宽，就以手动值为准。
    const [customWidth, setCustomWidth] = useState<number | null>(null);
    // 每个会话回到内容默认宽：上一会话手动拖宽的宽度不带到下一会话。
    const [prevWorkspaceKey, setPrevWorkspaceKey] = useState(workspaceKey);
    if (prevWorkspaceKey !== workspaceKey) {
        setPrevWorkspaceKey(workspaceKey);
        setCustomWidth(null);
    }
    const width = customWidth ?? DEFAULT_WIDTH;
    const questionIds = useMemo(() => getAgentToolQuestionIds(parts), [parts]);
    const numbers = useMemo(() => getAgentStepNumbers(data?.parts ?? []), [data]);
    const library = useUserCharts(userId, { enabled: model.tools.some(tool => getAgentChartSave(tool) !== null) });
    // 已保存：旧任务结算时存入的命盘，以及命盘库里有同一张盘的本对话排盘。
    const saved = useMemo(() => new Set([...artifacts.map(artifact => artifact.id), ...model.tools.flatMap(tool => {
        const save = getAgentChartSave(tool), id = getAgentToolArtifactId(tool);
        return save && id && findSavedAgentChart(library.data, save) ? [id] : [];
    })]), [artifacts, model, library.data]);
    const resolve = (id: string | null | undefined) => id ? resolveAgentWorkspaceLocation(model, id) : null;
    const [followModel, setFollowModel] = useState(() => !requestedResource && readSavedWorkspace(workspaceKey).followModel !== false);
    const [tabs, setTabs] = useState<string[]>(() => readSavedWorkspace(workspaceKey).tabs ?? []);
    // 成员页默认出现，但关掉后不再自动回来；从聊天或协作页再次打开时恢复。
    const [closedTabs, setClosedTabs] = useState<ReadonlySet<string>>(() => new Set());
    const [selected, setSelected] = useState<string | null>(() => requestedResource ? resolve(requestedResource.id) ?? requestedResource.id : readSavedWorkspace(workspaceKey).selected ?? null);
    const status = data?.status ?? null;
    const working = isAgentRunWorking(status);
    const sections = getAgentWorkspaceSections();
    // Following applies while the task runs or waits; once it ends the overview is shown instead.
    const following = followModel && status !== null && !isAgentRunTerminal(status);
    const followTarget = getAgentWorkspaceFollowTarget(model);
    const location = getAgentWorkspaceLocation(model, { selected, followModel, status });
    const activeResource = isSection(location) ? undefined : model.resources.find(resource => resource.id === location);
    const section: AgentWorkspaceSection = isSection(location) ? location : sections[0];
    // Each view the model opens while followed stays as a tab, so the reader can return to what it read.
    const followedId = following && activeResource ? activeResource.id : null;
    const [lastFollowed, setLastFollowed] = useState<string | null>(null);
    if (followedId !== lastFollowed) {
        setLastFollowed(followedId);
        if (followedId !== null && !tabs.includes(followedId)) setTabs([...tabs.slice(-(MAX_TABS - 1)), followedId]);
    }
    // 协作总览与每位成员各占一页，随协作分析一起出现在标签栏里（和命盘页并列）。
    const autoIds = model.resources
        .filter(resource => (resource.view === 'member' || resource.view === 'collaboration') && !closedTabs.has(resource.id))
        .map(resource => resource.id);
    const tabIds = [...new Set([...tabs.flatMap(id => resolve(id) ?? []), ...(activeResource ? [activeResource.id] : []), ...autoIds])].filter(id => !isSection(id));
    const visibleTabs = tabIds.flatMap(id => model.resources.find(resource => resource.id === id) ?? []);
    const normalizedSearch = search.trim().toLowerCase();
    // 搜索覆盖本对话的全部资源，不只已打开的标签：没开过或关掉过的资料页也能找到并重新打开。
    const unmatched = normalizedSearch ? model.resources.filter(resource => !tabIds.includes(resource.id)) : [];
    const filteredTabs = normalizedSearch ? [...visibleTabs, ...unmatched].filter(resource => resource.title.toLowerCase().includes(normalizedSearch)) : visibleTabs;

    // The step the reader is on: a step they opened, else the newest call of the view (the followed one).
    // The process section keeps showing the call details of the last step a view showed.
    const [openedTool, setOpenedTool] = useState<string | null>(null);
    // Opening a step or a citation names its call; opening a tab or section does not.
    const [namedTool, setNamedTool] = useState<string | null>(null);
    const inView = (id: string | null) => !following && id !== null && activeResource?.toolIds.includes(id) ? id : null;
    const shownToolId = !activeResource ? null : inView(openedTool) ?? activeResource.toolIds.at(-1) ?? null;
    // A citation stays selected while its source is on screen.
    const [cite, setCite] = useState<number | null>(null);
    const activeCite = cite !== null && !following && resolve(`cite:${cite}`) === location ? cite : null;
    const shownKey = activeResource ? JSON.stringify([shownToolId, activeResource.toolIds, activeCite]) : null;
    useEffect(() => {
        if (!onShownChange) return;
        if (shownKey === null) { onShownChange(null); return; }
        const [toolId, toolIds, shownCite] = JSON.parse(shownKey) as [string | null, string[], number | null];
        onShownChange({ toolId, toolIds: new Set(toolIds), cite: shownCite });
    }, [shownKey, onShownChange]);
    useEffect(() => () => onShownChange?.(null), [onShownChange]);

    const open = (id: string) => {
        const target = resolve(id) ?? id;
        const citation = parseAgentCitationTarget(id);
        const cited = citation === null ? undefined : model.evidence.find(item => item.n === citation);
        setFollowModel(false);
        setCite(cited ? cited.n : null);
        setNamedTool(cited ? cited.toolId : id.startsWith('tool:') ? id.slice('tool:'.length) : null);
        setOpenedTool(cited ? cited.toolId
            : id.startsWith('tool:') ? id.slice('tool:'.length)
            : isSection(target) ? shownToolId ?? openedTool
            : model.resources.find(resource => resource.id === target)?.toolIds.at(-1) ?? null);
        if (!isSection(target)) setTabs(current => current.includes(target) ? current : [...current.slice(-(MAX_TABS - 1)), target]);
        setClosedTabs(current => { if (!current.has(target)) return current; const next = new Set(current); next.delete(target); return next; });
        setSelected(target);
    };
    useEffect(() => {
        if (!requestedResource) return;
        let current = true;
        queueMicrotask(() => {
            if (!current) return;
            open(requestedResource.id);
            // 从聊天里点开的位置：已经开着的面板描边闪一下，视线从对话跟到工作区（重挂属性让动画重放）。
            // 刚打开的面板正在滑入，不再叠一次闪烁。
            const panel = panelRef.current;
            if (panel && performance.now() - mountedAt.current > 400) { panel.removeAttribute('data-flash'); void panel.offsetWidth; panel.setAttribute('data-flash', ''); }
        });
        return () => { current = false; };
        // A new request version is a new instruction; the resolver reads the current model.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestedResource]);
    useEffect(() => {
        try { sessionStorage.setItem(`taibu.workspace:${workspaceKey}`, JSON.stringify({ tabs, selected: location, followModel } satisfies SavedWorkspace)); } catch { /* Storage may be unavailable. */ }
    }, [tabs, location, followModel, workspaceKey]);
    useEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const key = `taibu.workspace-scroll:${workspaceKey}:${location}`;
        try { element.scrollTop = Number(sessionStorage.getItem(key) ?? 0); } catch { /* optional */ }
        const remember = () => { try { sessionStorage.setItem(key, String(element.scrollTop)); } catch { /* optional */ } };
        element.addEventListener('scroll', remember);
        return () => element.removeEventListener('scroll', remember);
    }, [workspaceKey, location]);
    // 宽度上限与 CSS max-width 同源：面板本身 + 阅读列 360 必须放得下。
    const clampWidth = (next: number) => {
        const parentWidth = panelRef.current?.parentElement?.clientWidth;
        const available = parentWidth ? parentWidth - READING_MIN - PANEL_GUTTER : MAX_WIDTH;
        return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available, Math.round(next)));
    };
    const adjustWidth = (next: number) => setCustomWidth(clampWidth(next));
    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startWidth = panelRef.current?.getBoundingClientRect().width ?? FALLBACK_WIDTH;
        dragRef.current = { startX: event.clientX, startWidth };
        widthRef.current = Math.round(startWidth);
        panelRef.current?.style.setProperty('--agent-drag-width', `${Math.round(startWidth)}px`);
        if (panelRef.current) panelRef.current.style.width = `${Math.round(startWidth)}px`;
        // 拖拽期间锁住文本选择与光标，整块面板随指针实时改变宽度。
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        panelRef.current?.setAttribute('data-resizing', 'true');
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* optional */ }
    };
    const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        const next = clampWidth(drag.startWidth + drag.startX - event.clientX);
        widthRef.current = next;
        // 直接改 DOM：聊天列由 flex 自动回流，工作区子树不重渲染，拖动更跟手。
        if (panelRef.current) {
            panelRef.current.style.setProperty('--agent-drag-width', `${next}px`);
            panelRef.current.style.width = `${next}px`;
        }
    };
    const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        panelRef.current?.removeAttribute('data-resizing');
        const finalWidth = widthRef.current;
        widthRef.current = null;
        // 松手后把实时宽度提交为状态（恢复默认宽度 / 键盘调整都以它为准）。
        if (finalWidth !== null) setCustomWidth(finalWidth);
    };
    // 默认宽（盘面时与对话列平分）是 CSS 算出来的，分隔条的 aria-valuenow 跟随实际宽度；直接写 DOM，拖动时不重渲染。
    useEffect(() => {
        const panel = panelRef.current, resizer = resizerRef.current;
        if (!panel || !resizer) return;
        const observer = new ResizeObserver(() => resizer.setAttribute('aria-valuenow', String(Math.round(panel.getBoundingClientRect().width))));
        observer.observe(panel);
        return () => observer.disconnect();
    }, [desktop]);
    // 组件在拖拽途中被卸载（关闭工作区）时，恢复被临时锁住的全局样式。
    useEffect(() => () => {
        dragRef.current = null;
        widthRef.current = null;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
    }, []);
    /** A resource whose call is still running, or waiting for the user's answer, is marked on its tab. */
    const liveState = (resource: AgentWorkspaceResource): keyof typeof LIVE_LABELS | null => {
        const states = resource.toolIds.flatMap(id => {
            const tool = model.toolsById.get(id);
            return tool ? [getAgentToolState(tool, status ?? 'completed').status] : [];
        });
        return states.some(state => state === 'pending' || state === 'running') ? 'running' : states.includes('awaiting_input') ? 'waiting' : null;
    };
    const closeTab = (resource: AgentWorkspaceResource, index: number) => {
        setFollowModel(false);
        setClosedTabs(current => new Set(current).add(resource.id));
        setTabs(current => current.filter(item => item !== resource.id));
        if (activeResource?.id === resource.id) setSelected(visibleTabs[index - 1]?.id ?? visibleTabs[index + 1]?.id ?? section);
    };

    // One tab list: the sections, then the resources. Arrow keys move along it; Alt+Arrow reorders resources.
    const tabOrder = [...sections, ...visibleTabs.map(resource => resource.id)];
    const selectedTab = activeResource?.id ?? section;
    // 跟随模型或从聊天打开时，选中的标签可能在标签行可视区外：横向滚到它（只动标签行，不带动页面）。
    const tabsRef = useRef<HTMLDivElement>(null);
    // 新开的标签弹入；面板随会话重新挂载、搜索框换回标签栏时已有的标签不重放。
    useEntranceMotion(tabsRef, { selector: '.agent-ws-resource-tab', preset: 'pop', scope: `${workspaceKey}:${searchOpen}` });
    useEffect(() => {
        const list = tabsRef.current;
        const tab = list?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.closest<HTMLElement>('.agent-ws-resource-tab, [role=tab]');
        if (!list || !tab) return;
        const left = tab.offsetLeft - list.offsetLeft, right = left + tab.offsetWidth;
        if (left >= list.scrollLeft && right <= list.scrollLeft + list.clientWidth) return;
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        list.scrollTo({ left: Math.max(0, left - 24), behavior: smooth ? 'smooth' : 'auto' });
    }, [selectedTab, searchOpen]);
    const tabId = (id: string) => `${ids}-tab-${tabOrder.indexOf(id)}`;
    const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
        const resourceIndex = visibleTabs.findIndex(resource => resource.id === id);
        if (event.key === 'Delete' && resourceIndex >= 0) {
            event.preventDefault();
            const list = event.currentTarget.closest('[role=tablist]');
            closeTab(visibleTabs[resourceIndex], resourceIndex);
            // The closed tab took focus with it; the tab shown next receives it.
            requestAnimationFrame(() => list?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus());
            return;
        }
        if (!TAB_KEYS.includes(event.key)) return;
        event.preventDefault();
        const index = tabOrder.indexOf(id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabOrder.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabOrder.length) % tabOrder.length;
        if (event.altKey) {
            if (isSection(id) || isSection(tabOrder[next])) return;
            setTabs(current => {
                const result = [...current], from = result.indexOf(id), to = result.indexOf(tabOrder[next]);
                if (from >= 0 && to >= 0) [result[from], result[to]] = [result[to], result[from]];
                return result;
            });
            return;
        }
        open(tabOrder[next]);
        event.currentTarget.closest('[role=tablist]')?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus();
    };
    const tab = (id: string, label: ReactNode, extra?: { live?: keyof typeof LIVE_LABELS | null; icon?: ReactNode }) => <Button unstyled key={id} type="button" role="tab" id={tabId(id)}
        aria-selected={selectedTab === id} aria-controls={`${ids}-panel`} tabIndex={selectedTab === id ? 0 : -1} aria-describedby={extra?.live ? `${ids}-${extra.live}` : undefined}
        onClick={() => open(id)} onKeyDown={event => onTabKey(event, id)}>
        {extra?.icon}{label}{extra?.live && <span className="agent-ws-tab-live" data-state={extra.live} aria-hidden="true" />}
    </Button>;
    // 命盘标签统一用注册表图标（每种占术一个），与右栏成果行同源。
    const chartIcon = (resource: AgentWorkspaceResource) => {
        if (resource.view === 'member') {
            const memberTool = resource.member ? model.toolsById.get(resource.member.toolId) : undefined;
            const target = resource.member;
            const member = memberTool && target ? parallelAnalysisResults(memberTool.output).find(item => item.conversationId === target.conversationId) : undefined;
            return <ModelAvatar member={member ?? {}} size={14} />;
        }
        if (resource.view !== 'chart') return undefined;
        const reading = resource.toolIds.flatMap(id => model.toolsById.get(id) ?? []).findLast(tool => getAgentChart(tool));
        const kind = reading && getAgentChart(reading)?.kind;
        const Icon = getChartKindMeta(kind).icon;
        return <Icon size={15} aria-hidden="true" />;
    };

    const content = <div className="agent-panel-content">
        <div className="agent-panel-header">
            <h2 id="agent-workspace-heading" className="sr-only">工作区</h2>
            {searchOpen
                ? <label className="agent-ws-search agent-ws-search-header">
                    <Search size={14} aria-hidden="true" />
                    <Input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索标签" aria-label="搜索工作区标签" />
                    <Button unstyled type="button" aria-label="关闭搜索" onClick={() => { setSearch(''); setSearchOpen(false); }}><X size={13} aria-hidden="true" /></Button>
                </label>
                : <div ref={tabsRef} className="agent-ws-tabs" role="tablist" aria-label="工作区资源">
                    {sections.map(id => tab(id, SECTION_LABELS[id], { icon: <LayoutGrid size={15} aria-hidden="true" /> }))}
                    {visibleTabs.length > 0 && <span className="agent-ws-tab-separator" aria-hidden="true" />}
                    {filteredTabs.map((resource, index) => <div key={resource.id} role="presentation" className="agent-ws-resource-tab" data-motion-key={resource.id} data-selected={activeResource?.id === resource.id || undefined}>
                        {tab(resource.id, resource.title, { live: liveState(resource), icon: chartIcon(resource) })}
                        {/* Only the open tab's close button is in the Tab order; Delete closes the focused tab. */}
                        <Button unstyled type="button" className="agent-ws-tab-close" aria-label={`关闭${resource.title}标签`} title="关闭标签（Delete）" tabIndex={activeResource?.id === resource.id ? 0 : -1}
                            onClick={() => closeTab(resource, index)}><X size={12} aria-hidden="true" /></Button>
                    </div>)}
                    {Object.entries(LIVE_LABELS).map(([key, text]) => <span key={key} id={`${ids}-${key}`} hidden>{text}</span>)}
                </div>}
            <div className="agent-ws-header-actions">
                {working && <Button unstyled type="button" className="agent-follow-chart" aria-pressed={followModel} disabled={!followTarget} title={followModel ? '跟随中：显示模型最新调用的工具' : '已暂停跟随'} onClick={() => {
                    if (followModel) setSelected(location);
                    setFollowModel(!followModel);
                }}><LocateFixed size={15} aria-hidden="true" /><span>跟随模型</span></Button>}
                {!searchOpen && <Tooltip label="搜索会话内容" side="bottom"><IconButton label="搜索会话内容" className="agent-icon-button" expand="none"
                    onClick={() => setSearchOpen(true)}><Search size={16} aria-hidden="true" /></IconButton></Tooltip>}
                <Menu>
                    <Tooltip label="视图选项" side="bottom"><MenuTrigger className="agent-icon-button" aria-label="视图选项"><Ellipsis size={18} aria-hidden="true" /></MenuTrigger></Tooltip>
                    <MenuContent align="end" className="chat-header-menu" aria-label="视图选项">
                        <MenuItem className="chat-header-menu-item" disabled={!visibleTabs.length} onClick={() => { setFollowModel(false); setTabs([]); setSelected(sections[0]); }}>关闭全部标签</MenuItem>
                        {desktop && <MenuItem className="chat-header-menu-item" disabled={customWidth === null} onClick={() => setCustomWidth(null)}>恢复默认宽度</MenuItem>}
                    </MenuContent>
                </Menu>
                {/* Only the docked panel can grow; the dialog and the phone sheet already take their full size. */}
                {desktop && <Tooltip label={maximized ? '还原工作区' : '最大化工作区'} side="bottom"><IconButton label={maximized ? '还原工作区' : '最大化工作区'} className="agent-icon-button" expand="none"
                    aria-pressed={maximized} onClick={() => setMaximized(value => !value)}>{maximized ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}</IconButton></Tooltip>}
                <Tooltip label="关闭工作区" side="bottom"><IconButton label="关闭工作区" onClick={onClose} className="agent-icon-button" expand="none"><X size={18} aria-hidden="true" /></IconButton></Tooltip>
            </div>
        </div>
        {searchOpen
            ? <ul className="agent-ws-search-results" aria-label="匹配的标签">
                {filteredTabs.length
                    ? filteredTabs.map(resource => <li key={resource.id}><Button unstyled type="button" aria-current={activeResource?.id === resource.id ? 'true' : undefined}
                        onClick={() => { open(resource.id); setSearch(''); setSearchOpen(false); }}>
                        {chartIcon(resource)}<span>{resource.title}</span>
                    </Button></li>)
                    : <li className="agent-ws-note">没有匹配的标签。</li>}
            </ul>
            : <div ref={scrollRef} id={`${ids}-panel`} className="agent-panel-scroll" role="tabpanel" aria-labelledby={tabId(selectedTab)} data-workspace-view={activeResource?.view ?? section}>
                {/* 按资源建视图：换一个标签就是换一页，入场动效（.agent-panel-scroll > *）随之重放。 */}
                {activeResource
                    ? <ResourceView key={activeResource.id} resource={activeResource} model={model} data={data} answers={answers ?? new Map()} questionIds={questionIds} userId={userId ?? null}
                        artifacts={artifacts} numbers={numbers} followModel={following} live={working} namedToolId={inView(namedTool)} cite={activeCite} citedParagraph={citedParagraph}
                        draftScope={workspaceKey} onOpen={open} onChartQuestion={onChartQuestion} />
                    : <WorkspaceOverview model={model} artifacts={artifacts} saved={saved} onOpen={open} />}
            </div>}
    </div>;
    return desktop ? <aside ref={panelRef} id="agent-workspace-panel" className={`agent-workspace-panel${maximized ? ' is-maximized' : ''}`} style={{ width: maximized ? undefined : width }} aria-labelledby="agent-workspace-heading"
        data-entering={enterOnMount || undefined} data-leaving={leaving || undefined} inert={leaving || undefined}>
        <div ref={resizerRef} className="agent-panel-resizer" role="separator" tabIndex={0} aria-label="调整工作区宽度" title="拖动调整宽度，双击恢复默认" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH}
            onDoubleClick={() => setCustomWidth(null)} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); adjustWidth((panelRef.current?.getBoundingClientRect().width ?? FALLBACK_WIDTH) + (event.key === 'ArrowLeft' ? 24 : -24)); } }} />
        {content}</aside>
        : <Dialog bare open={!leaving} id="agent-workspace-panel" onClose={onClose} className="agent-workspace-dialog" labelledBy="agent-workspace-heading">{content}</Dialog>;
}
