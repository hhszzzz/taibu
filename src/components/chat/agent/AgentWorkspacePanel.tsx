'use client';
// 需要 useState/useEffect、拖拽调整宽度与 sessionStorage 恢复标签

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, lazy, Suspense, type KeyboardEvent, type ReactNode } from 'react';
import { Ellipsis, ListChecks, LocateFixed, X } from 'lucide-react';
import { isAgentChartTool } from '@/lib/agent/tool-catalog';
import { isAgentRunTerminal, type AgentMessageData, type AgentPart } from '@/lib/agent/types';
import { getAgentChart, getAgentFinalSelection } from '@/lib/agent/tool-presentation';
import { getAgentChartReference, getChartFocus, getLatestChartFocus, parseChartReference } from '@/lib/agent/chart-interaction';
import {
    AGENT_WORKSPACE_SECTIONS, buildAgentWorkspace, getAgentToolQuestionIds, getAgentWorkspaceFollowTarget, getAgentWorkspaceLocation, getAgentWorkspaceSections,
    isAgentRunWorking, parseAgentCitationTarget, resolveAgentWorkspaceLocation,
    type AgentQuestionAnswer, type AgentWorkspaceModel, type AgentWorkspaceResource, type AgentWorkspaceSection,
} from '@/lib/agent/workspace';
import { questionDraftKey } from '@/lib/agent/question-drafts';
import { requestConversationExport } from '@/lib/chat/conversation-export';
import { ChartErrorBoundary } from '@/components/visualization/ChartRenderer';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { Modal } from '@/components/ui/Modal';
import { AgentToolCard } from './AgentToolCard';
import { describeAgentChartSteps, describeAgentChartSubject, getAgentReadingState, getAgentStepNumbers, getAgentToolState, type AgentArtifact } from './presentation';
import type { AgentWorkspaceShown } from './AgentResultContext';
import {
    AttachmentView, CalculationView, CollaborationView, DataListView, EvidenceView, MemoryView, MethodCatalogView, MethodView,
    ProfileView, QuestionView, RecordView, WorkspaceTextFallback, WorkspaceToolMeta, WorkspaceToolPending,
} from './AgentWorkspaceViews';
import { WorkspaceOverview, WorkspaceProcessSection, type WorkspaceRunInfo } from './AgentWorkspaceSections';
const ChartPreview = lazy(() => import('./AgentChartPreview').then(module => ({ default: module.AgentChartPreview })));
const InteractiveChart = lazy(() => import('./AgentInteractiveChart').then(module => ({ default: module.AgentInteractiveChart })));

const desktopQuery = '(min-width: 1280px)';
const MAX_TABS = 20;
const DEFAULT_WIDTH = 660;
const SECTION_LABELS: Record<AgentWorkspaceSection, string> = { results: '概览', process: '过程' };
const TAB_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
const LIVE_LABELS = { running: '正在更新', waiting: '等待回答' } as const;
const isSection = (id: string | null): id is AgentWorkspaceSection => id !== null && (AGENT_WORKSPACE_SECTIONS as readonly string[]).includes(id);

function subscribeToViewport(onChange: () => void) {
    const media = window.matchMedia(desktopQuery);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
}

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
function ResourceView({ resource, model, data, answers, questionIds, userId, artifacts, saved, numbers, followModel, live, namedToolId, cite, citedParagraph, draftScope, onManual, onOpen, onChartQuestion }: {
    resource: AgentWorkspaceResource; model: AgentWorkspaceModel; data?: AgentMessageData;
    answers: ReadonlyMap<string, AgentQuestionAnswer>; questionIds: ReadonlyMap<string, string>; userId: string | null;
    artifacts: AgentArtifact[];
    /** Artifact IDs the conversation saved as final results. */
    saved: ReadonlySet<string>;
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
    onManual: () => void; onOpen: (id: string) => void; onChartQuestion?: (text: string) => void;
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
            const opened = named && reference ? getChartFocus(named) : null;
            const pinned = opened?.reference === reference ? opened : null;
            const focus = pinned ?? (reference ? getLatestChartFocus(model.tools, reference) : null);
            // The calculation that produced the reading, or the saved chart it read back.
            const source = tools.find(tool => isAgentChartTool(tool.name) && getAgentChart(tool)) ?? reading;
            const kicker = describeAgentChartSteps({ reading: source, focus: focus ? model.tools.findLast(tool => getChartFocus(tool) === focus) : undefined, numbers, state: source ? getAgentReadingState(source, saved) : null });
            body = value && reading
                ? <Suspense fallback={<p role="status">加载命盘…</p>}>
                    <InteractiveChart key={`${reference ?? reading.id}:${pinned ? named!.id : ''}`} value={value} tool={reading} reference={reference}
                        focus={focus} followModel={followModel} live={live} pinned={pinned !== null} kicker={kicker} subject={describeAgentChartSubject(source ?? reading, value)}
                        onManual={onManual} onAsk={onChartQuestion} />
                </Suspense>
                : latest && latest.status === 'completed' ? <WorkspaceTextFallback tool={latest} note="命盘数据不完整，已保留工具返回内容。" />
                : latest && <><WorkspaceToolMeta tool={latest} runStatus={runStatus} /><WorkspaceToolPending tool={latest} runStatus={runStatus} running="正在排盘…" /></>;
            break;
        }
        case 'saved': {
            const artifact = artifacts.find(item => 'chart:' + item.id === resource.id);
            body = artifact && <Suspense fallback={<p>加载预览…</p>}>
                <ChartPreview artifact={artifact} tools={model.tools} followModel={followModel} onManual={onManual} onAsk={onChartQuestion} />
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
        case 'attachment': body = <AttachmentView id={resource.id.slice('attachment:'.length)} title={resource.title} tools={tools} />; break;
        case 'methods': body = latest && <MethodCatalogView tool={latest} runStatus={runStatus} step={step(latest)} />; break;
        case 'method': body = <MethodView tools={tools} runStatus={runStatus} step={step(tools.findLast(tool => tool.status === 'completed') ?? latest)} />; break;
        case 'question': {
            const questionId = latest && questionIds.get(latest.id);
            body = latest && <QuestionView tool={latest} runStatus={runStatus} step={step(latest)} model={model}
                answer={questionId ? answers.get(questionId) : undefined} draftKey={questionId && data ? questionDraftKey(`${draftScope}:${data.runId}`, questionId) : null} />;
            break;
        }
        case 'collaboration': {
            // A collaboration opened from its step shows that call; step numbers belong to the latest task.
            const tool = tools.find(item => item.id === namedToolId) ?? latest;
            body = tool && <CollaborationView tool={tool} runStatus={runStatus} step={step(tool)} />;
            break;
        }
        case 'memory': body = <MemoryView tools={tools} runStatus={runStatus} userId={userId} step={step(latest)} />; break;
        case 'tool': body = latest && <AgentToolCard tool={latest} runStatus={runStatus} />; break;
    }
    return latest ? <ChartErrorBoundary resetKey={latest} fallback={<WorkspaceTextFallback tool={latest} note="这个视图暂时无法显示，已改为工具返回的规范文本。" />}>{body}</ChartErrorBoundary> : <>{body}</>;
}

export function AgentWorkspacePanel({ parts, artifacts, data, run, attachmentIds, answers, userId, conversationId = null, onClose, workspaceKey, requestedResource, onChartQuestion, onShownChange, citedParagraph }: {
    workspaceKey: string;
    /** Agent parts of the visible conversation branch, in transcript order. */
    parts: AgentPart[];
    artifacts: AgentArtifact[];
    data?: AgentMessageData;
    run?: WorkspaceRunInfo;
    attachmentIds: string[];
    answers?: ReadonlyMap<string, AgentQuestionAnswer>;
    userId?: string | null;
    /** The saved conversation, which can be exported; new conversations cannot. */
    conversationId?: string | null;
    onClose: () => void;
    requestedResource?: { id: string; version: number };
    onChartQuestion?: (text: string) => void;
    /** Reports the tool view on screen so the chat can mark its step and result card. */
    onShownChange?: (shown: AgentWorkspaceShown | null) => void;
    /** The paragraph of the answer that cites a number, counted from 1. */
    citedParagraph?: (cite: number) => number | null;
}) {
    const desktop = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(desktopQuery).matches, () => false);
    const panelRef = useRef<HTMLElement>(null);
    const dragRef = useRef<{ start: number; width: number } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const ids = useId();
    const [moreOpen, setMoreOpen] = useState(false);
    const [width, setWidth] = useState(DEFAULT_WIDTH);
    const model = useMemo(() => buildAgentWorkspace({ parts, artifacts, attachmentIds }), [parts, artifacts, attachmentIds]);
    const questionIds = useMemo(() => getAgentToolQuestionIds(parts), [parts]);
    const numbers = useMemo(() => getAgentStepNumbers(data?.parts ?? []), [data]);
    const saved = useMemo(() => new Set([...artifacts.map(artifact => artifact.id), ...model.tools.flatMap(tool => getAgentFinalSelection(tool) ?? [])]), [artifacts, model]);
    const resolve = (id: string | null | undefined) => id ? resolveAgentWorkspaceLocation(model, id) : null;
    const [followModel, setFollowModel] = useState(() => !requestedResource && readSavedWorkspace(workspaceKey).followModel !== false);
    const [tabs, setTabs] = useState<string[]>(() => readSavedWorkspace(workspaceKey).tabs ?? []);
    const [selected, setSelected] = useState<string | null>(() => requestedResource ? resolve(requestedResource.id) ?? requestedResource.id : readSavedWorkspace(workspaceKey).selected ?? null);
    const status = data?.status ?? null;
    const working = isAgentRunWorking(status);
    const sections = getAgentWorkspaceSections(status);
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
    const tabIds = [...new Set([...tabs.flatMap(id => resolve(id) ?? []), ...(activeResource ? [activeResource.id] : [])])].filter(id => !isSection(id));
    const visibleTabs = tabIds.flatMap(id => model.resources.find(resource => resource.id === id) ?? []);
    const subtitle = working ? '随任务实时更新' : status === 'awaiting_input' ? '问题与已知资料' : '本对话';

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
        setSelected(target);
    };
    useEffect(() => {
        if (!requestedResource) return;
        let current = true;
        queueMicrotask(() => { if (current) open(requestedResource.id); });
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
    const adjustWidth = (next: number) => setWidth(Math.max(280, Math.min(next, Math.min(780, (panelRef.current?.parentElement?.clientWidth ?? 1040) - 360))));
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
        setTabs(current => current.filter(item => item !== resource.id));
        if (activeResource?.id === resource.id) setSelected(visibleTabs[index - 1]?.id ?? visibleTabs[index + 1]?.id ?? section);
    };

    // One tab list: the sections, then the resources. Arrow keys move along it; Alt+Arrow reorders resources.
    const tabOrder = [...sections, ...visibleTabs.map(resource => resource.id)];
    const selectedTab = activeResource?.id ?? section;
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
    const tab = (id: string, label: ReactNode, extra?: { live?: keyof typeof LIVE_LABELS | null; icon?: ReactNode }) => <button key={id} type="button" role="tab" id={tabId(id)}
        aria-selected={selectedTab === id} aria-controls={`${ids}-panel`} tabIndex={selectedTab === id ? 0 : -1} aria-describedby={extra?.live ? `${ids}-${extra.live}` : undefined}
        onClick={() => open(id)} onKeyDown={event => onTabKey(event, id)}>
        {extra?.icon}{label}{extra?.live && <span className="agent-ws-tab-live" data-state={extra.live} aria-hidden="true" />}
    </button>;

    const content = <div className="agent-panel-content">
        <div className="agent-panel-header">
            <h2 id="agent-workspace-heading">工作区</h2>
            <span className="agent-ws-subtitle">{subtitle}</span>
            <div className="agent-ws-header-actions">
                {working && <button type="button" className="agent-follow-chart" aria-pressed={followModel} disabled={!followTarget} title={followModel ? '跟随中：显示模型最新调用的工具' : '已暂停跟随'} onClick={() => {
                    if (followModel) setSelected(location);
                    setFollowModel(!followModel);
                }}><LocateFixed size={15} aria-hidden="true" />跟随模型</button>}
                <button ref={moreRef} type="button" className="agent-icon-button" aria-label="工作区更多操作" title="工作区更多操作" aria-haspopup="menu" aria-expanded={moreOpen}
                    onClick={() => setMoreOpen(value => !value)}><Ellipsis size={18} aria-hidden="true" /></button>
                <button type="button" onClick={onClose} aria-label="关闭工作区" title="关闭工作区" className="agent-icon-button"><X size={18} aria-hidden="true" /></button>
            </div>
        </div>
        <FloatingPanel open={moreOpen} anchorRef={moreRef} onClose={() => setMoreOpen(false)} label="工作区更多操作" align="end" className="chat-header-menu">
            <button type="button" role="menuitem" disabled={!visibleTabs.length} onClick={() => { setMoreOpen(false); setFollowModel(false); setTabs([]); setSelected(sections[0]); }}>关闭全部标签</button>
            {desktop && <button type="button" role="menuitem" disabled={width === DEFAULT_WIDTH} onClick={() => { setMoreOpen(false); setWidth(DEFAULT_WIDTH); }}>恢复默认宽度</button>}
            {conversationId && <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); requestConversationExport(); }}>导出对话</button>}
        </FloatingPanel>
        <div className="agent-ws-tabs" role="tablist" aria-label="工作区资源">
            {sections.map(id => tab(id, SECTION_LABELS[id], { icon: id === 'process' ? <ListChecks size={15} aria-hidden="true" /> : undefined }))}
            {visibleTabs.length > 0 && <span className="agent-ws-tab-separator" aria-hidden="true" />}
            {visibleTabs.map((resource, index) => <div key={resource.id} role="presentation" className="agent-ws-resource-tab" data-selected={activeResource?.id === resource.id || undefined} draggable
                onDragStart={event => event.dataTransfer.setData('text/plain', resource.id)} onDragOver={event => event.preventDefault()} onDrop={event => {
                    event.preventDefault();
                    const from = event.dataTransfer.getData('text/plain');
                    if (!tabs.includes(from)) return;
                    setTabs(current => { const next = current.filter(item => item !== from); next.splice(index, 0, from); return next; });
                }}>
                {tab(resource.id, resource.title, { live: liveState(resource) })}
                {/* Only the open tab's close button is in the Tab order; Delete closes the focused tab. */}
                <button type="button" className="agent-ws-tab-close" aria-label={`关闭${resource.title}标签`} title="关闭标签（Delete）" tabIndex={activeResource?.id === resource.id ? 0 : -1}
                    onClick={() => closeTab(resource, index)}><X size={12} aria-hidden="true" /></button>
            </div>)}
            {Object.entries(LIVE_LABELS).map(([key, text]) => <span key={key} id={`${ids}-${key}`} hidden>{text}</span>)}
        </div>
        <div ref={scrollRef} id={`${ids}-panel`} className="agent-panel-scroll" role="tabpanel" aria-labelledby={tabId(selectedTab)} data-workspace-view={activeResource?.view ?? section}>
            {activeResource
                ? <ResourceView resource={activeResource} model={model} data={data} answers={answers ?? new Map()} questionIds={questionIds} userId={userId ?? null}
                    artifacts={artifacts} saved={saved} numbers={numbers} followModel={following} live={working} namedToolId={inView(namedTool)} cite={activeCite} citedParagraph={citedParagraph}
                    draftScope={workspaceKey} onManual={() => { setSelected(activeResource.id); setFollowModel(false); }} onOpen={open} onChartQuestion={onChartQuestion} />
                : section === 'results'
                    ? <WorkspaceOverview model={model} artifacts={artifacts} saved={saved} data={data} run={run} onOpen={open} conversationId={conversationId} />
                    : <WorkspaceProcessSection model={model} data={data} run={run} stepId={openedTool} onOpen={open} />}
        </div>
    </div>;
    return desktop ? <aside ref={panelRef} id="agent-workspace-panel" className="agent-workspace-panel" style={{ width }} aria-labelledby="agent-workspace-heading">
        <div className="agent-panel-resizer" role="separator" tabIndex={0} aria-label="调整工作区宽度" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={280} aria-valuemax={780}
            onPointerDown={event => { dragRef.current = { start: event.clientX, width: panelRef.current?.getBoundingClientRect().width ?? width }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={event => { const drag = dragRef.current; if (drag) adjustWidth(drag.width + drag.start - event.clientX); }}
            onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); adjustWidth((panelRef.current?.getBoundingClientRect().width ?? width) + (event.key === 'ArrowLeft' ? 24 : -24)); } }} />
        {content}</aside>
        : <Modal open id="agent-workspace-panel" onClose={onClose} className="agent-workspace-dialog" labelledBy="agent-workspace-heading">{content}</Modal>;
}
