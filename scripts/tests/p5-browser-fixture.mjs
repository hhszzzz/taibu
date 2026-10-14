/**
 * Serverless browser-component acceptance for P5.
 * Run: pnpm test:browser (uses the pinned Playwright Chromium runtime).
 * Build only: node scripts/tests/p5-browser-fixture.mjs /tmp/taibu-p5-browser
 * Build + run with an already-installed Playwright module (never installs):
 *   node scripts/tests/p5-browser-fixture.mjs /tmp/taibu-p5-browser /absolute/path/to/playwright/index.mjs
 * Or pass generated acceptance.playwright.js as MCP browser_run_code_unsafe.filename.
 * Programmatic use with an existing Playwright page:
 *   const { run } = await import('file:///absolute/repo/scripts/tests/p5-browser-fixture.mjs');
 *   return run(page, '/tmp/taibu-p5-browser/fixture.js');
 *
 * Actual components: SettingsCenterPage/SettingsCenterHost/GeneralSettingsPanel/ChartsPanel, AIModelPanel,
 * AnnouncementManagementPanel, KeyManagementPanel, ConversationListProvider, ChartPickerModal,
 * useSelectedBaziChart, useComposerState, HistoryDrawer/HistoryPageTemplate, RecordsPage and useAnalysisSnapshot.
 * Actual root ClientProviders owns the shared Query client and handles synthetic auth I/O.
 * Fixture-only boundaries: auth I/O/profile/feature flags, unrelated lazy panels,
 * framework navigation, viewport notifications, held fetch/JSON completion and HTTP responses.
 * Unused Node-only random-calculation crypto fails closed; real Bazi projections are bundled.
 * No Next router, Supabase, Auth, PostgREST, paid model or CSS/layout acceptance is claimed.
 * No .env loading, listening socket, server process or unhandled network access.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'https://taibu-fixture.invalid';

const entry = String.raw`
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useQueryClient } from '@tanstack/react-query';
import { ClientProviders, useSessionSafe } from '@/components/providers/ClientProviders';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { SettingsCenterHost } from '@/components/settings/SettingsCenterHost';
import { SettingsCenterPage } from '@/components/settings/SettingsCenterPage';
import { usePathname } from 'next/navigation';
import { openSettingsCenter } from '@/lib/settings-center';
import { AIModelPanel } from '@/components/admin/AIModelPanel';
import { AnnouncementManagementPanel } from '@/components/admin/AnnouncementManagementPanel';
import { KeyManagementPanel } from '@/components/admin/KeyManagementPanel';
import { ConversationListProvider, useConversationList } from '@/lib/chat/ConversationListContext';
import { useChatState } from '@/lib/chat/use-chat-state';
import { useChatMessaging } from '@/lib/chat/use-chat-messaging';
import { ChatStreamManager } from '@/lib/chat/chat-stream-manager';
import { ChartPickerModal } from '@/components/common/ChartPickerModal';
import { useComposerState } from '@/components/chat/composer/useComposerState';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';
import RecordsPage from '@/app/records/page';
import * as chartClient from '@/lib/user/charts-client';
import { useSelectedBaziChart } from '@/lib/hooks/useUserCharts';
import { TimeInputModal } from '@/components/bazi/form/TimeInputModal';
import { AgentQuestionDialog } from '@/components/chat/agent/AgentQuestionDialog';
import { AgentMessage } from '@/components/chat/AgentMessage';
import { AgentWorkspacePanel } from '@/components/chat/agent/AgentWorkspacePanel';
import { AgentResultContext } from '@/components/chat/agent/AgentResultContext';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { AgentContextDetails } from '@/components/chat/agent/AgentContextUsage';
import { getAgentChart } from '@/lib/agent/tool-presentation';
import { getChartTargets } from '@/lib/agent/chart-interaction';
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
const initialToolParts = AGENT_TOOL_FIXTURE_PARTS;
function AnalysisSnapshotProbe() {
  // Result pages pass a fresh callbacks object on every render; a settled lookup must not start another one.
  const [analysis, setAnalysis] = useState('');
  const [settled, setSettled] = useState(0);
  const loading = useAnalysisSnapshot({
    conversationId: null,
    recordId: 'fixture-snapshot-reading',
    divinationType: 'tarot',
    sessionKey: 'fixture_snapshot_result',
    hasExistingAnalysis: Boolean(analysis),
    callbacks: { onAnalysis: setAnalysis, onComplete: () => setSettled(count => count + 1) },
  });
  return <output data-testid="analysis-snapshot">{(loading ? 'loading' : 'idle') + ':' + settled}</output>;
}
function AgentResultsProbe() {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState(undefined);
  const [parts, setParts] = useState(initialToolParts);
  const [runtime, setRuntime] = useState(undefined);
  const { user } = useSessionSafe();
  const data = { version: 1, runId: 'ui-results', status: 'completed', parts, runtime };
  window.fixture.agentTiming = () => {
    setRuntime(JSON.parse(JSON.stringify({ responses: [{ id: 'reply-1', durationMs: 1500 }, { id: 'reply-2', durationMs: 500 }] })));
    setParts(previous => JSON.parse(JSON.stringify(previous.map(tool => tool.id === initialToolParts.find(part => part.name === 'bazi').id ? { ...tool, durationMs: 1500, startedAt: 1000, endedAt: 6000 } : tool))));
  };
  window.fixture.collaborationResults = completed => setParts(previous => [...previous.filter(part => part.id !== 'collaboration'), {
    ...initialToolParts[0], id: 'collaboration', name: 'parallel_analysis', title: '协作分析', status: completed ? 'completed' : 'running',
    output: JSON.parse(JSON.stringify({ analyses: [
      { system: 'bazi', conversationId: 10, name: '八字分析', modelName: '分析模型', status: 'completed', answer: '已核对天干与日支。' },
      { system: 'bazi', conversationId: 11, name: '独立复核', modelName: '复核模型', status: completed ? 'completed' : 'running', ...(completed ? { answer: '生克关系复核完成。' } : {}) },
    ] })),
  }]);
  window.fixture.chartTargets = kind => getChartTargets(getAgentChart(parts.find(tool => tool.name === kind)));
  window.fixture.chartFocus = (kind, ids, caption, savedReference) => {
    const original = parts.find(tool => tool.name === kind);
    const reference = savedReference ?? 'artifact:' + (kind === 'bazi' ? '11111111-1111-4111-8111-111111111111' : kind === 'ziwei' ? '22222222-2222-4222-8222-222222222222' : String(initialToolParts.indexOf(initialToolParts.find(tool => tool.name === kind)) + 1).padStart(8, '0') + '-1111-4111-8111-111111111111');
    const inspect = { ...original, id: 'inspect-' + kind, name: 'inspect_chart', output: { chartReference: reference, chartKind: kind, result: original.output.result } };
    const focus = { type: 'tool', id: 'focus-' + (window.fixture.chartRevision = (window.fixture.chartRevision ?? 0) + 1), name: 'focus_chart', title: '定位分析位置', status: 'completed',
      output: { chartFocus: { version: 1, reference, targetIds: ids, includeRelated: true, caption } } };
    setParts(previous => [...previous.filter(tool => tool.id !== inspect.id), inspect, focus]);
  };
  window.fixture.chartInspect = (changed = false) => {
    const original = parts.find(tool => tool.name === 'bazi');
    const inspect = { ...original, id: 'reinspect-bazi-' + (window.fixture.chartRevision = (window.fixture.chartRevision ?? 0) + 1), name: 'inspect_chart',
      output: { chartReference: 'bazi_chart:11111111-1111-4111-8111-111111111111', chartKind: 'bazi', result: changed ? REVISED_BAZI_FIXTURE_RESULT : original.output.result } };
    setParts(previous => [...previous, inspect]);
  };
  window.fixture.traditionalTaiyi = () => setParts(previous => previous.filter(tool => tool.id !== 'inspect-taiyi').map(tool => tool.name === 'taiyi' ? TRADITIONAL_TAIYI_FIXTURE_PART : tool));
  return <section data-testid="agent-results"><AgentResultContext.Provider value={{ openResource(id) { setRequest(previous => ({ id, version: (previous?.version ?? 0) + 1 })); setOpen(true); } }}>
    <AgentMessage data={data} />
    <button onClick={() => { setRequest(previous => ({ id: 'chart:bazi', version: (previous?.version ?? 0) + 1 })); setOpen(true); }}>恢复已有成果标签</button>
    {open && <AgentWorkspacePanel workspaceKey={(user?.id ?? 'visitor') + ':ui-fixture'} artifacts={[{ type: 'artifact', id: 'bazi', title: '已保存八字', chartType: 'bazi', chartId: 'saved-bazi' }]} sources={[]} historyTools={parts} attachmentIds={[]} data={data} requestedResource={request} onChartQuestion={text => { window.fixture.chartQuestion = text; }} onClose={() => setOpen(false)} />}
  </AgentResultContext.Provider></section>;
}

import { calculateZiweiChartBundle, getHoroscope } from '@/lib/divination/ziwei';
function BirthRulesProbe() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: 'Birth rules', gender: 'male', calendarType: 'solar', birthYear: 2024, birthMonth: 3, birthDay: 10, birthHour: 2, birthMinute: 30, timezone: 'Asia/Shanghai', disambiguation: 'reject' });
  const [result, setResult] = useState(null);
  window.fixture.birthForm = form;
  window.fixture.birthResult = result;
  return <section data-testid="birth-rules">
    <button onClick={() => setOpen(true)}>Open birth time rules</button>
    <button onClick={() => {
      try {
        const { output, astrolabe } = calculateZiweiChartBundle(form);
        setResult({ options: output.calculationOptions, day: getHoroscope(output, astrolabe, new Date('2024-06-01T02:00:00Z'))?.daily.period });
      } catch (error) { setResult({ error: error.message }); }
    }}>Calculate actual Ziwei</button>
    <TimeInputModal isOpen={open} onClose={() => setOpen(false)} formData={form} unknownTime={false} allowUnknownTime={false}
      onToggleUnknownTime={() => {}} onUpdate={(field, value) => setForm(previous => ({ ...previous, [field]: value }))} />
  </section>;
}
import { queryKeys } from '@/lib/query/keys';
import { deleteHistorySummary } from '@/lib/history/client';
import { removeKnowledgeBaseArchive } from '@/lib/knowledge-base/browser-client';
const sourceTypes = ['bazi_chart'];
const empty = [];
function StructuredQuestionProbe() {
  const { user } = useSessionSafe();
  const [attachments, setAttachments] = useState({ webSearchEnabled: false });
  return <AgentQuestionDialog question="选择分析范围" questionId="same-tool-call" scopeKey={(user?.id ?? '') + ':structured'}
    questions={[
      { id: 'topics', question: '选择分析范围', options: [{ id: 'work', label: '工作' }, { id: 'life', label: '生活' }], multiple: true, allowCustom: true },
      { id: 'optional', question: '补充其他资料', allowCustom: true, allowSkip: true },
    ]} disabled={false} attachmentState={attachments} onAttachmentChange={setAttachments} onStop={() => window.fixture.mount.question(false)}
    onAnswer={async (text, answers) => { window.fixture.structuredAnswers = { text, answers }; window.fixture.mount.question(false); }} />;
}
function AgentChatProbe() {
  const { user } = useSessionSafe();
  const router = useMemo(() => ({ replace() {}, push() {} }), []);
  const searchParams = useMemo(() => new URLSearchParams(), []);
  const state = useChatState({ userId: user?.id ?? null, sessionLoading: false, bootstrapLoading: false, router, searchParams });
  const messaging = useChatMessaging({ state, userId: user?.id ?? null, user, membership: { type: 'plus', isActive: true }, credits: 20,
    refreshViewerState: async () => {}, markViewerCreditsExhausted() {}, showToast: (...args) => { window.fixture.agentToasts.push(args); }, router, searchParams });
  window.fixture.agentChat = { state, messaging };
  return <section data-testid="agent-chat"><input aria-label="Agent fixture draft" value={state.inputValue} onChange={event => state.setInputValue(event.target.value)} />
    <ModelSelector selectedModel={state.selectedModel} onModelChange={state.setSelectedModel} reasoningEnabled={state.reasoningEnabled} onReasoningChange={state.setReasoningEnabled}
      reasoningEffort={state.reasoningEffort} onReasoningEffortChange={state.setReasoningEffort} collaborators={state.collaborators} onCollaboratorsChange={state.setCollaborators}
      userId={user?.id} membershipType="plus" contextDetails={<AgentContextDetails runtime={messaging.agent.run?.message.agent?.runtime} />} toolbarStyle />
    <output data-testid="agent-status">{messaging.agent.run?.status ?? 'none'}</output>
    <output data-testid="agent-messages">{JSON.stringify(state.messages)}</output></section>;
}
function ComposerProbe() {
  const { user } = useSessionSafe();
  const state = useComposerState({ userId: user?.id, isLoading: true, membershipType: 'pro',
    enabledDataSourceTypes: sourceTypes, mentions: empty, contextMessages: empty, promptKnowledgeBases: empty });
  window.fixture.composer = state;
  return <section data-testid="composer">
    <output data-testid="composer-loading">{String(state.mentionLoading)}</output>
    <ul data-testid="composer-sources">{state.mentionDataSources.map(item => <li key={item.id}>{item.name}</li>)}</ul>
    <ul data-testid="composer-knowledge">{state.mentionKnowledgeBases.map(item => <li key={item.id}>{item.name}</li>)}</ul>
    <output data-testid="composer-error">{state.mentionLoadError}</output>
  </section>;
}
function SelectedChartProbe() {
  const { user } = useSessionSafe();
  const selected = useSelectedBaziChart(user?.id);
  window.fixture.selectedChart = selected;
  return <output data-testid="selected-chart">{selected.chart?.name ?? ''}</output>;
}
const historyConfig = { sourceType: 'tarot', title: 'Fixture actual history',
  renderCard: (item, actions) => <article data-history-id={item.id}>
    <span>{item.title}</span><button onClick={actions.onDelete}>Delete history {item.id}</button>
  </article> };
let client;
const manager = new ChatStreamManager();
const invalidations = [];

window.fixture = { user: 'alice', invalidations, client, manager, agentToasts: [] };
function Shell() {
  const queryClient = useQueryClient();
  const { user } = useSessionSafe();
  if (client !== queryClient) {
    client = queryClient;
    const invalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = (...args) => { invalidations.push(args[0]); return invalidate(...args); };
    window.fixture.client = client;
  }
  const setUser = id => window.fixtureAuth.change(id);
  window.fixture.user = user?.id ?? null;
  const list = useConversationList();
  const route = usePathname();
  const [stream, setStream] = useState(null);
  const [operation, setOperation] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composerMounted, setComposerMounted] = useState(false);
  const [historyMounted, setHistoryMounted] = useState(false);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [recordsMounted, setRecordsMounted] = useState(false);
  const [selectedMounted, setSelectedMounted] = useState(false);
  const [agentMounted, setAgentMounted] = useState(false);
  const [questionMounted, setQuestionMounted] = useState(false);
  const [resultsMounted, setResultsMounted] = useState(false);
  const [snapshotMounted, setSnapshotMounted] = useState(false);
  const [modelMountKey, setModelMountKey] = useState(0);
  window.fixture.remountModels = () => setModelMountKey(current => current + 1);
  window.fixture.mount = { composer: setComposerMounted, history: setHistoryMounted, drawer: setDrawerMounted,
    records: setRecordsMounted, picker: setPickerOpen, selected: setSelectedMounted, agent: setAgentMounted, question: setQuestionMounted, results: setResultsMounted,
    snapshot: setSnapshotMounted };
  window.fixture.chartKey = queryKeys.userCharts;
  window.fixture.chartClient = chartClient;
  window.fixture.deleteHistory = deleteHistorySummary;
  window.fixture.archiveChanged = () => removeKnowledgeBaseArchive('fixture-archive');
  window.fixture.list = () => list.conversationsRef.current;
  window.fixture.context = list;
  useEffect(() => manager.subscribe(event => {
    setStream(event.task);
    if (event.type === 'task_updated') {
      list.setConversations(current => current.map(row => row.id === event.task.conversationId
        ? { ...row, title: 'Stream: ' + event.task.content } : row));
    }
  }), [list.setConversations]);
  const navigate = path => { history.pushState(null, '', path); window.dispatchEvent(new Event('fixture:navigate')); };
  const start = () => manager.startTask({
    conversationId: 'alice-1', requestHeaders: {}, requestBody: {},
    baseMessages: [{ id: 'user-message', role: 'user', content: 'fixture question', createdAt: '2026-01-01' }],
    assistantMessage: { id: 'assistant-message', role: 'assistant', content: '', createdAt: '2026-01-01' },
    runner: async ({ signal, appendContentDelta }) => {
      appendContentDelta('partial');
      await new Promise((done, fail) => {
        window.fixture.finishStream = () => { appendContentDelta(' completed'); done(); };
        signal.addEventListener('abort', () => fail(new DOMException('Stopped', 'AbortError')), { once: true });
      });
    },
  });
  return <>
    <header>
      <button onClick={() => navigate('/chat')}>Fixture Chat route</button>
      <button onClick={() => navigate('/other')}>Fixture Other route</button>
      <button onClick={() => navigate('/models')}>Fixture Models route</button>
      <button onClick={() => navigate('/announcements')}>Fixture Announcements route</button>
      <button onClick={() => navigate('/keys')}>Fixture Keys route</button>
      <button onClick={() => openSettingsCenter('general')}>Open actual settings</button>
      <button onClick={() => setUser('alice')}>Fixture Alice</button>
      <button onClick={() => setUser('bob')}>Fixture Bob</button>
      <button onClick={() => setUser(null)}>Fixture Logout</button>
    </header>
    <output data-testid="route">{route}</output>
    <section aria-label="Fixture conversation controls">
      <button onClick={() => list.refreshConversationList()}>Refresh actual list</button>
      <button onClick={() => list.loadMoreConversations()}>Load more actual list</button>
      <button onClick={async () => setOperation(String(await list.handleRenameConversation(list.conversationsRef.current[0].id, 'Renamed fixture')))}>Rename actual first</button>
      <button onClick={async () => setOperation(String(await list.handleDeleteConversation(list.conversationsRef.current[0].id)))}>Delete actual first</button>
      <output data-testid="operation">{operation}</output>
      <output data-testid="list-error">{list.conversationListError ?? ''}</output>
      <ul data-testid="conversation-list">{list.conversations.map(row => <li key={row.id} data-id={row.id}>{row.title}</li>)}</ul>
    </section>
    {route === '/chat' && <section aria-label="Fixture stream controls">
      <button onClick={start}>Start actual stream manager</button>
      <button onClick={start}>Regenerate actual stream manager</button>
    </section>}
    <button onClick={() => manager.stopTask('alice-1')}>Stop actual stream manager</button>
    <output data-testid="stream">{stream ? stream.status + ':' + stream.content : 'idle'}</output>
    {route === '/models' && <section data-testid="models"><AIModelPanel key={modelMountKey} /></section>}
    {route === '/announcements' && <section data-testid="announcements"><AnnouncementManagementPanel /></section>}
    {route === '/keys' && <section data-testid="activation-keys"><KeyManagementPanel /></section>}
    {composerMounted && <ComposerProbe />}
    {selectedMounted && <SelectedChartProbe />}
    {agentMounted && <AgentChatProbe />}
    {questionMounted && <StructuredQuestionProbe />}
    {resultsMounted && <AgentResultsProbe />}
    {historyMounted && <section data-testid="history-page"><HistoryPageTemplate {...historyConfig} /></section>}
    {drawerMounted && <section data-testid="history-drawer"><HistoryDrawer type="tarot" /></section>}
    {recordsMounted && <section data-testid="records"><RecordsPage /></section>}
    {snapshotMounted && <AnalysisSnapshotProbe />}
    <section data-testid="chart-picker"><ChartPickerModal isOpen={pickerOpen} userId={user?.id ?? ''}
      onClose={() => setPickerOpen(false)} onSelect={chart => { window.fixture.pickedChart = chart; }} /></section>
    <BirthRulesProbe />
    <SettingsCenterHost />
    {route.startsWith('/settings/') && <SettingsCenterPage>{null}</SettingsCenterPage>}
  </>;
}
function App() {
  return <ClientProviders><ThemeProvider><ConversationListProvider><Shell /></ConversationListProvider></ThemeProvider></ClientProviders>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
`;

export async function build(outputDirectory) {
  const { build: bundle } = await import('esbuild');
  await mkdir(outputDirectory, { recursive: true });
  const outfile = resolve(outputDirectory, 'fixture.js');
  const { executeTool, buildToolSuccessPayload, listToolDefinitions } = await import('taibu-core/mcp');
  const toolParts = [];
  for (const name of ['bazi', 'ziwei', 'qimen', 'liuyao', 'meihua', 'daliuren', 'xiaoliuren', 'tarot', 'taiyi', 'astrology', 'almanac']) {
    const definition = listToolDefinitions().find(tool => tool.name === name);
    const input = { ...definition.inputSchema.examples[0] };
    if (definition.inputSchema.properties?.seed) input.seed = 'browser-ui-contract';
    if (name === 'tarot') input.referenceYear = 2026;
    if (name === 'astrology') Object.assign(input, { latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai' });
    const rendered = buildToolSuccessPayload(name, await executeTool(name, input), { detailLevel: ['almanac', 'astrology', 'liuyao', 'meihua'].includes(name) ? 'full' : 'default' });
    toolParts.push({ type: 'tool', id: name, name, title: definition.title, status: 'completed', input,
      output: { artifactId: name, result: rendered.structuredContent }, canonicalText: rendered.content.map(item => item.text).join('\n') });
  }
  toolParts.push({ type: 'tool', id: 'incomplete', name: 'bazi', title: '字段不足的命盘', status: 'completed', output: {}, canonicalText: '规范文本仍可访问' });
  const traditional = buildToolSuccessPayload('taiyi', await executeTool('taiyi', { system: 'traditional', mode: 'hour', date: '2026-04-10', hour: 9, timezone: 'Asia/Shanghai' }));
  const traditionalPart = { ...toolParts.find(tool => tool.name === 'taiyi'), output: { artifactId: 'taiyi', result: traditional.structuredContent }, canonicalText: traditional.content.map(part => part.text).join('\n') };
  const revisedBazi = buildToolSuccessPayload('bazi', await executeTool('bazi', { ...toolParts.find(tool => tool.name === 'bazi').input, birthYear: 2001, birthMonth: 10, birthDay: 1 }));

  await bundle({
    stdin: { contents: entry.replace('AGENT_TOOL_FIXTURE_PARTS', JSON.stringify(toolParts)).replace('TRADITIONAL_TAIYI_FIXTURE_PART', JSON.stringify(traditionalPart)).replace('REVISED_BAZI_FIXTURE_RESULT', JSON.stringify(revisedBazi.structuredContent)), loader: 'jsx', resolveDir: root, sourcefile: 'p5-browser-entry.jsx' },
    outfile, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    tsconfig: resolve(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'explicit-fixture-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/auth$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/providers\/(ChatTaskToastBridge|AnnouncementPopupHost)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/lib\/hooks\/(useFeatureToggles|useCurrentUserProfile)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/settings\/panels\// }, args => /\/(GeneralSettingsPanel|AISettingsPanel|ChartsPanel)$/.test(args.path) ? null : ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^(?:node:)?crypto$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/settings\/AccountAdminPanels$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        let contents = 'export default function UnexercisedPanel() { return null; }';
        // Core's unrelated tarot/liuyao random calculators import Node crypto via barrels.
        // Fail closed if acceptance accidentally exercises them; do not fake calculations.
        if (/^(?:node:)?crypto$/.test(args.path)) contents = `export default { createHash() { throw new Error('Node crypto is outside browser fixture scope'); } };`;
        if (args.path === 'next/navigation') contents = `
          import { useSyncExternalStore } from 'react';
          const signal = () => window.dispatchEvent(new Event('fixture:navigate'));
          const navigate = url => { history.pushState(null, '', url); signal(); };
          const router = { push: navigate, replace: url => { history.replaceState(null, '', url); signal(); }, back: () => history.back(), prefetch() {} };
          const subscribe = callback => { window.addEventListener('fixture:navigate', callback); window.addEventListener('popstate', callback); return () => { window.removeEventListener('fixture:navigate', callback); window.removeEventListener('popstate', callback); }; };
          export const useRouter = () => router;
          export const usePathname = () => useSyncExternalStore(subscribe, () => location.pathname, () => '/chat');
          export const useSearchParams = () => new URLSearchParams(location.search);
        `;
        if (args.path === 'next/link') contents = `
          import React from 'react';
          import { useRouter } from 'next/navigation';
          export default function Link({ href, children, prefetch, replace, scroll, onClick, ...props }) {
            const router = useRouter();
            const url = typeof href === 'string' ? href : href.pathname;
            return <a {...props} href={url} onClick={event => { onClick?.(event); if (event.defaultPrevented || props.target === '_blank' || event.metaKey || event.ctrlKey) return; event.preventDefault(); if (replace) router.replace(url); else router.push(url); }}>{children}</a>;
          }
        `;
        if (args.path === '@/lib/auth') contents = `
          const listeners = new Set();
          const session = () => window.fixtureAuth.cookieUser ? { user: { id: window.fixtureAuth.cookieUser, email: window.fixtureAuth.cookieUser + '@fixture.invalid' } } : null;
          window.fixtureAuth = { cookieUser: 'alice', revalidations: 0, change(id) { this.cookieUser = id; for (const cb of listeners) cb('SIGNED_IN', session()); } };
          export const authSessionCacheConstants = { SESSION_REVALIDATE_EVENT_COOLDOWN_MS: 0 };
          export const supabase = { auth: {
            getSession: async () => ({ data: { session: session() }, error: null }),
            revalidateSession: async () => { window.fixtureAuth.revalidations++; return { data: { session: session() }, error: null }; },
            onAuthStateChange: cb => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
          } };
        `;
        if (args.path.endsWith('/ChatTaskToastBridge')) contents = 'export function ChatTaskToastBridge() { return null; }';
        if (args.path.endsWith('/AnnouncementPopupHost')) contents = 'export function AnnouncementPopupHost({ children }) { return children; }';
        if (args.path.endsWith('/useFeatureToggles')) contents = 'const enabled = () => true; export function useFeatureToggles() { return { loaded: true, isLoading: false, isFeatureEnabled: enabled }; }';
        if (args.path.endsWith('/useCurrentUserProfile')) contents = "import { useSessionSafe } from '@/lib/hooks/session-context'; export function useCurrentUserProfile() { const {user} = useSessionSafe(); return { profile: user ? { is_admin: user.id === 'alice' } : null, loading: false, error: null }; }";
        if (args.path.endsWith('/AccountAdminPanels')) contents = "export { AIModelPanel as AdminAIServicesContent } from '@/components/admin/AIModelPanel'; export const AdminAnnouncementsContent = () => null; export const AdminFeaturesContent = () => null;";
        return { contents, loader: 'jsx', resolveDir: root };
      });
    } }],
  });
  const browserBundle = await readFile(outfile, 'utf8');
  const runner = resolve(outputDirectory, 'acceptance.playwright.js');
  // MCP's code VM intentionally has no imports/filesystem; embed only fixture code.
  const runSource = run.toString().replace("const bundle = await readFile(bundlePath, 'utf8');", `const bundle = ${JSON.stringify(browserBundle)};`);
  await writeFile(runner, `async (page) => { const origin = ${JSON.stringify(origin)}; const assert = { ok(value, message) { if (!value) throw new Error(message); } }; const initialModel = ${initialModel.toString()}; const run = ${runSource}; return run(page); }`);
  return { bundle: outfile, runner };
}

function initialModel() {
  return {
    id: 'model-1', modelKey: 'fixture-model', displayName: 'Fixture Model', vendor: 'deepseek',
    usageType: 'chat', routingMode: 'auto', isEnabled: true, sortOrder: 0, requiredTier: 'free',
    supportsReasoning: true, reasoningRequiredTier: 'plus', isReasoningDefault: false, supportsVision: false,
    defaultTemperature: 0.7, defaultTopP: null, defaultPresencePenalty: null, defaultFrequencyPenalty: null,
    defaultMaxTokens: null, defaultReasoningEffort: 'high', reasoningEffortFormat: 'reasoning_object',
    customParameters: null, description: null,
    sources: [{ id: 'source-1', sourceKey: 'newapi', sourceName: 'NewAPI', apiUrl: 'https://unused.invalid', apiKeyEnvVar: 'FIXTURE_UNUSED', hasApiKey: true, modelIdOverride: null, reasoningModelId: null, isActive: true, isEnabled: true, priority: 0, notes: null }],
  };
}

export async function run(existingPage, bundlePath) {
  const browser = existingPage.context().browser();
  assert.ok(browser, 'An existing Playwright browser is required');
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 1000 } });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  // Route fulfillment remains available offline; any missed route cannot reach a socket.
  await context.setOffline(true);
  await context.addInitScript(() => {
    // Keep actual fetch/Response behavior; only hold JSON completion when a test asks.
    const nativeFetch = window.fetch.bind(window);
    // In-memory Agent HTTP boundary supplies real Response/ReadableStream objects
    // to the production chat hooks, including held receipts and cross-tab SSE.
    const agentIO = window.fixtureAgentIO = { requests: [], runs: {}, commands: {}, streams: [], held: [], holdNext: false, failReceipts: 0, resumeOnCommand: false };
    agentIO.view = (conversationId, status = 'running', id = 'run-' + conversationId, cursor = 1) => ({
      id, conversationId, status, cursor, createdAt: '2026-10-06T00:00:00Z',
      message: { id: 'agent:' + id, role: 'assistant', content: '', createdAt: '2026-10-06T00:00:00Z', agent: { version: 1, runId: id, status, parts: [] } },
    });
    agentIO.emit = view => {
      agentIO.runs[view.conversationId] = view;
      for (const stream of agentIO.streams) if (!stream.closed && stream.runId === view.id) {
        stream.controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify(view) + '\n\n'));
        if (['completed', 'cancelled', 'failed'].includes(view.status)) { stream.closed = true; stream.controller.close(); }
      }
    };
    window.fixtureNetwork = { next: 0, requests: {}, jsonGate: null };
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname.startsWith('/api/agent/')) {
        const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(init.body) : null;
        agentIO.requests.push({ url: url.pathname, search: url.search, method, body });
        if (url.pathname === '/api/agent/status') return Response.json({ enabled: true, ready: true, webAvailable: false, customAvailable: true });
        if (url.pathname === '/api/agent/runs' && method === 'GET') return Response.json(agentIO.runs[url.searchParams.get('conversationId')] ?? null);
        const events = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)\/events$/);
        if (events) {
          let stream;
          return new Response(new ReadableStream({
            start(controller) {
              stream = { controller, runId: events[1], closed: false };
              agentIO.streams.push(stream);
              const view = Object.values(agentIO.runs).find(view => view.id === events[1]);
              if (view) controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify(view) + '\n\n'));
            }, cancel() { stream.closed = true; },
          }), { headers: { 'Content-Type': 'text/event-stream' } });
        }
        let payload;
        if (url.pathname === '/api/agent/runs' && method === 'POST') {
          const existing = Object.values(agentIO.runs).find(view => view.clientRequestId === body.clientRequestId);
          payload = existing ?? { ...agentIO.view(body.conversationId, 'queued', 'created-' + body.conversationId), clientRequestId: body.clientRequestId,
            userMessage: { ...body.message, role: 'user', createdAt: '2026-10-06T00:00:00Z' } };
          agentIO.runs[body.conversationId] = payload;
        } else {
          const command = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)\/messages$/);
          if (!command) throw new Error('Unhandled Agent fixture: ' + url.pathname);
          const key = command[1] + ':' + body.clientRequestId;
          let receipt = agentIO.commands[key];
          if (!receipt) {
            const view = Object.values(agentIO.runs).find(view => view.id === command[1]);
            const resumed = { ...view, cursor: view.cursor + 1, status: agentIO.resumeOnCommand ? 'running' : view.status };
            resumed.message = { ...resumed.message, agent: { ...resumed.message.agent, status: resumed.status } };
            receipt = agentIO.commands[key] = { message: { id: 'command:' + body.clientRequestId, role: 'user', content: body.content, createdAt: '2026-10-06T00:00:00Z' }, run: resumed };
            agentIO.emit(resumed);
          }
          payload = receipt;
        }
        if (agentIO.holdNext) { agentIO.holdNext = false; await new Promise(resolve => agentIO.held.push(resolve)); }
        if (agentIO.failReceipts > 0) { agentIO.failReceipts--; throw new TypeError('lost committed receipt'); }
        return Response.json(payload);
      }
      const network = window.fixtureNetwork;
      const id = String(++network.next);
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('x-fixture-request-id', id);
      const state = network.requests[id] = { phase: 'fetch', url: String(input) };
      try {
        const response = await nativeFetch(input, { ...init, headers });
        state.phase = 'headers';
        const json = response.json.bind(response);
        response.json = async () => {
          try {
            const value = await json();
            const gate = network.jsonGate;
            if (gate && new URL(response.url).pathname === gate.pathname && !gate.intercepted) {
              gate.intercepted = true;
              await new Promise(done => { gate.release = done; });
            }
            state.phase = 'done';
            return value;
          } catch (error) { state.phase = 'failed'; throw error; }
        };
        return response;
      } catch (error) { state.phase = 'failed'; throw error; }
    };
    // Explicit viewport notifications drive the real pagination observer callbacks.
    const observers = new Set();
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); observers.add(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); observers.delete(this); }
      takeRecords() { return []; }
    };
    window.fixtureIntersect = selector => {
      for (const observer of observers) for (const target of observer.targets) {
        if (target.closest(selector)) observer.callback([{ target, isIntersecting: true }], observer);
      }
    };
  });
  const bundle = await readFile(bundlePath, 'utf8');
  const requests = [];
  const configurations = new Map();
  const blocked = [];
  const browserErrors = [];
  const queryWarnings = [];
  const checks = [];
  const controls = [];
  let holdSettingsReads = false;
  const holdReads = new Set();
  const holdNext = (pathname, method, fail = false) => {
    const control = { pathname, method, fail, release: null, intercepted: false };
    controls.push(control);
    return control;
  };
  const intercepted = async control => {
    for (let attempt = 0; !control.intercepted && attempt < 200; attempt++) await page.waitForTimeout(10);
    assert.ok(control.intercepted, 'Controlled request intercepted: ' + control.method + ' ' + control.pathname);
  };
  let models = [initialModel()];
  let announcements = [];
  let failAnnouncementWrite = false;
  const activationKey = (id, code, extra) => ({ id, key_code: code, key_type: 'membership', membership_type: 'plus', credits_amount: null,
    is_used: false, used_by: null, used_at: null, created_at: '2026-01-02T00:00:00Z', ...extra });
  let activationKeys = [
    activationKey('key-unused', 'sk-fixtureunused001'),
    activationKey('key-used', 'sk-fixtureused00002', { key_type: 'credits', membership_type: null, credits_amount: 50, is_used: true, used_by: 'alice', used_at: '2026-01-05T00:00:00Z' }),
  ];
  let failKeyCreate = false;
  let settingsReads = 0;
  let holdList = false;
  let releaseList;
  let failRename = false;
  let failDelete = false;
  let delayedRename = false;
  let releaseRename;
  const rows = Object.fromEntries(['alice', 'bob'].map(user => [user, Array.from({ length: user === 'alice' ? 9 : 2 }, (_, index) => ({
    id: user + '-' + (index + 1), user_id: user, personality: 'general', title: user + ' conversation ' + (index + 1),
    created_at: '2026-01-01', updated_at: '2026-01-01', source_type: 'chat',
  }))]));
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('No queryFn was passed')) queryWarnings.push(message.text());
  });
  const settings = { notificationsEnabled: true, language: 'zh', expressionStyle: 'direct', customInstructions: '', chartPromptDetailLevel: 'default', userProfile: null, promptKbIds: [], notifyEmail: true, notifySite: true, defaultBaziChartId: null, defaultZiweiChartId: null, chatPreferences: { width: 760, fontScale: 100, desktopNotifications: false } };
  const settingsByUser = { alice: { ...settings }, bob: { ...settings, customInstructions: 'Bob preferences', notificationsEnabled: false } };
  const chart = (id, name) => ({ id, name, gender: 'male', birth_date: '1990-01-01', birth_time: '12:00',
    birth_place: 'Beijing', longitude: 116.4, calendar_type: 'solar', is_leap_month: false, created_at: '2026-01-01T00:00:00Z' });
  const charts = { alice: { baziCharts: [chart('chart-alice', 'Alice confirmed chart')], ziweiCharts: [], defaultChartIds: { bazi: 'chart-alice', ziwei: null } },
    bob: { baziCharts: [chart('chart-bob', 'Bob only chart')], ziweiCharts: [], defaultChartIds: { bazi: 'chart-bob', ziwei: null } } };
  const source = (id, name) => ({ id, name, type: 'bazi_chart', createdAt: '2026-01-01T00:00:00Z', preview: name });
  const sources = { alice: [source('source-a', 'Alice source A')], bob: [source('source-bob', 'Bob only source')] };
  const staleSources = structuredClone(sources);
  const knowledge = { alice: [{ id: 'kb-alice', name: 'Alice knowledge', description: '' }], bob: [{ id: 'kb-bob', name: 'Bob knowledge', description: '' }] };
  const histories = Object.fromEntries(['alice', 'bob'].map(user => [user, Array.from({ length: user === 'alice' ? 14 : 2 }, (_, index) => ({
    id: user + '-history-' + (index + 1), title: user + ' history ' + (index + 1), type: 'tarot', createdAt: '2026-01-01T00:00:00Z',
  }))]));
  const record = (id, title, category) => ({ id, title, category, user_id: 'alice', content: title, tags: [], event_date: null,
    related_chart_type: null, related_chart_id: null, is_pinned: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
  const records = [record('record-general', 'General saved record', 'general'), record('record-event', 'Event saved record', 'event')];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin !== origin) { blocked.push(request.url()); return route.abort('blockedbyclient'); }
    if (url.pathname === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/chat' && method === 'GET') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>[hidden],.hidden{display:none!important}button,input,select,textarea{margin:4px;padding:4px}svg{width:16px;height:16px}.relative{position:relative}body{font-family:sans-serif}</style><div id="root"></div><script src="/fixture.js"></script>' });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    if (url.pathname.startsWith('/_next/image') || url.pathname.startsWith('/tarot_cards/')) return route.fulfill({ status: 200, contentType: 'image/png', body: new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,4,0,0,0,181,28,12,2,0,0,0,11,73,68,65,84,120,218,99,252,255,31,0,3,3,2,0,239,154,6,167,0,0,0,0,73,69,78,68,174,66,96,130]) });
    if (url.pathname === '/api/notifications' && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { notifications: [] }, error: null }) });
    if (url.pathname === '/api/notifications/popup' && method === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { claimed: false }, error: null }) });
    const body = request.postDataJSON();
    requests.push({ method, pathname: url.pathname, search: url.search, body, expectedUserId: request.headers()['x-expected-user-id'] });
    if (holdSettingsReads && url.pathname === '/api/user/settings' && method === 'GET') holdNext(url.pathname, method);
    if (holdReads.has(url.pathname) && method === 'GET' && !controls.some(item => !item.intercepted && item.pathname === url.pathname && item.method === method)) holdNext(url.pathname, method);
    const control = controls.find(item => !item.intercepted && item.pathname === url.pathname && item.method === method);
    if (control) control.requestId = request.headers()['x-fixture-request-id'];
    const wait = control ? new Promise(done => { control.release = done; control.intercepted = true; }) : Promise.resolve();
    const ok = async (data, raw = false) => {
      const value = control?.snapshot ?? data;
      const payload = JSON.stringify(raw ? value : { data: value, error: null });
      await wait;
      if (control?.fail) return denied();
      return route.fulfill({ status: 200, contentType: 'application/json', body: payload }).catch(() => {});
    };
    const denied = () => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ data: null, error: { message: 'Controlled fixture failure' } }) });
    if (url.pathname === '/api/app/bootstrap' && method === 'GET') return ok({ viewerLoaded: true,
      viewerSummary: { userId: await page.evaluate(() => window.fixtureAuth.cookieUser), isAdmin: false, nickname: 'fixture', membership: 'plus', aiChatCount: 20 },
      membership: { type: 'plus', isActive: true }, featureToggles: {}, featureTogglesLoaded: true, unreadCount: 0, unreadCountLoaded: true });
    if (url.pathname === '/api/models' && method === 'GET') return ok({ models: [
      { id: 'fixture-analysis', name: '分析模型', vendor: 'other', supportsReasoning: true, reasoningEffortFormat: 'reasoning_effort', allowed: true, reasoningAllowed: true },
      { id: 'fixture-review', name: '复核模型', vendor: 'other', supportsReasoning: true, reasoningEffortFormat: 'reasoning_object', allowed: true, reasoningAllowed: true },
      { id: 'fixture-denied', name: '受限模型', vendor: 'other', supportsReasoning: true, allowed: false, blockedReason: '会员限制', reasoningAllowed: false },
      { id: 'fixture-toggle', name: '仅支持推理开关', vendor: 'other', supportsReasoning: true, allowed: true, reasoningAllowed: true },
    ] });
    if (['/api/user/settings','/api/reminders','/api/user/agent-memory'].includes(url.pathname)) {
      const cookieUser = await page.evaluate(() => window.fixtureAuth.cookieUser);
      if (request.headers()['x-expected-user-id'] && request.headers()['x-expected-user-id'] !== cookieUser) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Account changed' } }) });
      }
      if (url.pathname === '/api/user/agent-memory' && method === 'GET') return ok({ memories: [] });
      if (url.pathname === '/api/user/settings') {
        const owned = settingsByUser[cookieUser] ?? settings;
        if (method === 'GET') { settingsReads++; return ok({ settings: owned }); }
        if (!control?.fail) Object.assign(owned, body);
        return ok({ settings: owned });
      }
    }
    if (url.pathname === '/api/reminders') return ok({ subscriptions: ['solar_term', 'fortune', 'key_date'].map(reminderType => ({ reminderType, enabled: false, notifySite: true, notifyEmail: false })) });
    if (url.pathname === '/api/user/charts' || /^\/api\/(bazi|ziwei)\/charts(?:\/update)?$/.test(url.pathname)) {
      const user = await page.evaluate(() => window.fixtureAuth.cookieUser);
      const owned = charts[user];
      if (!owned) return route.fulfill({ status: 401, json: { error: { message: 'Login required' } } });
      if (request.headers()['x-expected-user-id'] && request.headers()['x-expected-user-id'] !== user) {
        return route.fulfill({ status: 409, json: { error: { message: 'Account changed' } } });
      }
      const type = url.pathname.includes('/ziwei/') ? 'ziwei' : body?.type || url.searchParams.get('type') || 'bazi';
      const listKey = type + 'Charts';
      if (method === 'GET') return ok(url.pathname === '/api/user/charts' ? owned : { chart: owned[listKey].find(item => item.id === url.searchParams.get('id')) ?? null }, true);
      if (method === 'PATCH') {
        if (!control?.fail) owned.defaultChartIds[type] = body.id;
        return ok({ defaultChartIds: owned.defaultChartIds }, true);
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!control?.fail) {
          owned[listKey] = owned[listKey].filter(item => item.id !== id);
          if (owned.defaultChartIds[type] === id) owned.defaultChartIds[type] = null;
        }
        return ok({ success: true, defaultChartIds: owned.defaultChartIds }, true);
      }
      if (url.pathname.endsWith('/update')) {
        if (!control?.fail) Object.assign(owned[listKey].find(item => item.id === body.chartId), body.payload);
        return ok({ success: true }, true);
      }
      const id = body.payload.id;
      if (!control?.fail) owned[listKey].push({ ...chart(id, body.payload.name), ...body.payload });
      return ok({ id }, true);
    }
    if (url.pathname === '/api/data-sources') {
      const user = await page.evaluate(() => window.fixtureAuth.cookieUser);
      // Model the real 15-second server index cache without waiting for its TTL.
      return ok({ items: (url.searchParams.get('fresh') === '1' ? sources : staleSources)[user] ?? [], errors: [] }, true);
    }
    if (url.pathname === '/api/knowledge-base') {
      const user = await page.evaluate(() => window.fixtureAuth.cookieUser);
      return ok({ knowledgeBases: knowledge[user] ?? [] }, true);
    }
    if (url.pathname === '/api/knowledge-base/archive/fixture-archive' && method === 'DELETE') return ok({ success: true, sourceType: 'ming_record' }, true);
    if (url.pathname === '/api/history-summaries') {
      const user = await page.evaluate(() => window.fixtureAuth.cookieUser);
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!control?.fail) histories[user] = histories[user].filter(item => item.id !== id);
        return ok({ success: true, type: url.searchParams.get('type'), id }, true);
      }
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const all = histories[user] ?? [];
      return ok({ items: all.slice(offset, offset + limit), pagination: { hasMore: offset + limit < all.length, nextOffset: offset + limit < all.length ? offset + limit : null } }, true);
    }
    if (url.pathname === '/api/notes') return ok({ notes: [] }, true);
    if (url.pathname === '/api/records') {
      const category = url.searchParams.get('category');
      const filtered = records.filter(item => !category || item.category === category);
      return ok({ records: filtered, total: filtered.length }, true);
    }
    if (url.pathname === '/api/conversations' && method === 'GET') {
      const user = await page.evaluate(() => window.fixture.user);
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const list = rows[user] ?? [];
      const payload = { conversations: list.slice(offset, offset + limit), pagination: { hasMore: offset + limit < list.length, nextOffset: offset + limit < list.length ? offset + limit : null } };
      if (holdList) { holdList = false; await new Promise(done => { releaseList = done; }); }
      return ok(payload).catch(() => {}); // An intentionally aborted old-account request may be closed.
    }
    if (/^\/api\/conversations\/[^/]+\/configuration$/.test(url.pathname)) {
      const user = await page.evaluate(() => window.fixtureAuth.cookieUser);
      const key = user + ':' + url.pathname;
      if (method === 'PATCH') configurations.set(key, body);
      return ok(method === 'GET' ? { configuration: configurations.get(key) ?? null } : { saved: true });
    }
    const conversation = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversation) {
      if (method === 'GET') {
        const user = await page.evaluate(() => window.fixtureAuth.cookieUser);
        return ok({ conversation: { id: conversation[1], user_id: user, personality: 'general', title: 'Agent test', messages: [], created_at: '2026-01-01', updated_at: '2026-01-01', source_type: 'chat' } });
      }
      if (control?.fail) return ok({ saved: false });
      if (method === 'DELETE') {
        if (failDelete) { failDelete = false; return denied(); }
        for (const user of Object.keys(rows)) rows[user] = rows[user].filter(row => row.id !== conversation[1]);
      } else if (body?.title) {
        if (delayedRename) { delayedRename = false; await new Promise(done => { releaseRename = done; }); return denied(); }
        if (failRename) { failRename = false; return denied(); }
        for (const user of Object.keys(rows)) rows[user] = rows[user].map(row => row.id === conversation[1] ? { ...row, title: body.title } : row);
      }
      return ok({ saved: true });
    }
    if (/^\/api\/admin\/announcements(?:\/[^/]+)?$/.test(url.pathname)) {
      if (method === 'GET') return ok({ announcements });
      if (failAnnouncementWrite) { failAnnouncementWrite = false; return denied(); }
      if (method === 'DELETE') { announcements = []; return ok({ deleted: true }); }
      const announcement = { id: 'announcement-fixture', content: body.content, publishedAt: '2026-01-01T00:00:00Z' };
      announcements = [announcement];
      return ok({ announcement });
    }
    // The real route answers with raw payloads: GET { success, data }, POST/DELETE { success, ... }.
    if (url.pathname === '/api/activation-keys') {
      if (method === 'GET') return ok({ success: true, data: activationKeys }, true);
      if (method === 'DELETE') {
        activationKeys = activationKeys.filter(key => key.id !== url.searchParams.get('id'));
        return ok({ success: true }, true);
      }
      if (failKeyCreate) { failKeyCreate = false; return ok({ success: false, error: 'Fixture key limit' }, true); }
      const created = Array.from({ length: body.count }, (_, index) => activationKey('key-new-' + index, 'sk-fixturecreated0' + index, {
        key_type: body.keyType, membership_type: body.membershipType ?? null, credits_amount: body.creditsAmount ?? null, created_at: '2026-01-06T00:00:00Z',
      }));
      activationKeys = [...created, ...activationKeys];
      return ok({ success: true, keys: created.map(key => key.key_code) }, true);
    }
    if (url.pathname === '/api/admin/ai-models/cache') return ok({ cleared: true });
    if (url.pathname === '/api/admin/ai-models') {
      if (method === 'GET') return ok({ models });
      models.push({ ...initialModel(), ...body, id: 'created-model', sources: [] });
      return ok({ model: models.at(-1) });
    }
    const source = url.pathname.match(/^\/api\/admin\/ai-models\/([^/]+)\/sources(?:\/([^/]+))?$/);
    if (source) {
      const model = models.find(item => item.id === source[1]);
      if (!source[2]) model.sources.push({ ...initialModel().sources[0], ...body, id: 'source-2', sourceName: 'Octopus', isActive: false });
      else if (method === 'PATCH') Object.assign(model.sources.find(item => item.id === source[2]), body);
      else if (method === 'DELETE') model.sources = model.sources.filter(item => item.id !== source[2]);
      else model.sources.forEach(item => { item.isActive = item.id === source[2]; });
      return ok({ saved: true });
    }
    const model = url.pathname.match(/^\/api\/admin\/ai-models\/([^/]+)$/);
    if (model) {
      if (method === 'DELETE') models = models.filter(item => item.id !== model[1]);
      else Object.assign(models.find(item => item.id === model[1]), body);
      return ok({ saved: true });
    }
    blocked.push(request.url());
    return route.abort('blockedbyclient');
  });
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  const until = async (predicate, argument) => page.waitForFunction(predicate, argument, { timeout: 10000 });
  const renderBarrier = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const release = async control => {
    control.release();
    await until(id => ['done', 'failed'].includes(window.fixtureNetwork.requests[id]?.phase), control.requestId);
    await renderBarrier();
  };
  const releaseReads = async (pathname, from) => {
    holdReads.delete(pathname);
    for (const control of controls.slice(from).filter(item => item.pathname === pathname && item.intercepted)) await release(control);
  };
  try {
    await page.goto(origin + '/chat');
    await until(() => window.fixture?.list?.().length === 7);
    const birthProbe = page.getByTestId('birth-rules');
    await birthProbe.getByRole('button', { name: 'Open birth time rules' }).click();
    await birthProbe.getByLabel('出生地时区（IANA）').fill('America/New_York');
    await birthProbe.getByLabel('夏令时重复／缺失时间').selectOption('later');
    await birthProbe.locator('input[type=time]').fill('03:15');
    await birthProbe.getByRole('button', { name: '取消', exact: true }).click();
    check('Cancelling birth-time draft preserves all original fields', await page.evaluate(() => window.fixture.birthForm.timezone === 'Asia/Shanghai' && window.fixture.birthForm.disambiguation === 'reject' && window.fixture.birthForm.birthHour === 2 && window.fixture.birthForm.birthMinute === 30));
    await birthProbe.getByRole('button', { name: 'Open birth time rules' }).click();
    await birthProbe.getByLabel('出生地时区（IANA）').fill('invalid/timezone');
    await birthProbe.getByRole('button', { name: '确定', exact: true }).click();
    check('Invalid IANA zone keeps the time editor open and does not commit', await birthProbe.getByLabel('出生地时区（IANA）').isVisible() && await page.evaluate(() => window.fixture.birthForm.timezone === 'Asia/Shanghai'));
    await birthProbe.getByLabel('出生地时区（IANA）').fill('America/New_York');
    await birthProbe.getByRole('button', { name: '确定', exact: true }).click();
    await birthProbe.getByRole('button', { name: 'Calculate actual Ziwei' }).click();
    await until(() => Boolean(window.fixture.birthResult?.error));
    checks.push('Actual browser Ziwei rejects nonexistent birth time without explicit resolution');
    await birthProbe.getByRole('button', { name: 'Open birth time rules' }).click();
    await birthProbe.getByLabel('夏令时重复／缺失时间').selectOption('later');
    await birthProbe.getByRole('button', { name: '确定', exact: true }).click();
    await birthProbe.getByRole('button', { name: 'Calculate actual Ziwei' }).click();
    await until(() => window.fixture.birthResult?.options?.disambiguation === 'later');
    check('Actual browser Ziwei preserves birth timezone into lazy flow calculation', await page.evaluate(() => window.fixture.birthResult.options.timezone === 'America/New_York' && window.fixture.birthResult.day === '2024-05-31'));
    await page.getByRole('button', { name: 'Load more actual list', exact: true }).click();
    await until(() => window.fixture.list().length === 9);
    check('Query pagination retains API order and 7+2 rows', (await page.locator('[data-testid="conversation-list"] li').allTextContents()).join('|') === rows.alice.map(row => row.title).join('|'));

    await page.getByRole('button', { name: 'Open actual settings', exact: true }).click();
    await page.getByText('推送通知', { exact: true }).waitFor();
    check('Actual settings navigation enters an independent page address', new URL(page.url()).pathname === '/settings/general' && new URL(page.url()).hash === '');
    await page.evaluate(() => { document.querySelector('[role="switch"]').dataset.fixtureIdentity = 'original-node'; window.fixture.invalidations.length = 0; });
    await page.getByRole('switch').first().click();
    // 设置写入同时失效聊天引导与任务通知读取的设置缓存，各一次且只限当前账号
    await until(() => window.fixture.invalidations.length === 2);
    await renderBarrier();
    check('GeneralSettings mutation invalidates each scoped settings query exactly once', JSON.stringify(await page.evaluate(() => window.fixture.invalidations)) === JSON.stringify([{ queryKey: ['chat', 'bootstrap', 'alice'] }, { queryKey: ['user', 'settings', 'alice'] }]));
    let readsBeforeClose = settingsReads;
    await page.getByRole('link', { name: '账户', exact: true }).click();
    await until(() => location.pathname === '/settings/profile');
    await page.getByRole('button', { name: 'Open actual settings', exact: true }).click();
    await page.getByText('推送通知', { exact: true }).waitFor();
    check('Category switching preserves mounted settings DOM and avoids GET refetch', settingsReads === readsBeforeClose && await page.getByRole('switch').first().getAttribute('data-fixture-identity') === 'original-node');
    check('Optimistic saved switch state survives reopen', await page.getByRole('switch').first().getAttribute('aria-checked') === 'false');
    await page.goBack();
    await until(() => location.pathname === '/settings/profile');
    checks.push('Browser back returns to the prior settings category');

    await page.evaluate(() => { history.replaceState(null, '', '#settings/personalization'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const instructions = page.getByPlaceholder('例如：先给结论，再给依据；避免空话和术语堆叠。', { exact: true });
    await instructions.fill('Dirty same-account draft');
    const readsBeforeFocus = settingsReads;
    const focusBefore = await page.evaluate(() => window.fixtureAuth.revalidations);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await until(before => window.fixtureAuth.revalidations > before, focusBefore);
    await page.waitForTimeout(50);
    check('Real ClientProviders focus refresh preserves AI dirty draft and does not reload settings', await instructions.inputValue() === 'Dirty same-account draft' && settingsReads === readsBeforeFocus);
    await page.getByRole('button', { name: 'Open actual settings', exact: true }).click();
    await page.getByLabel('早报投递时间').fill('10:15');
    page.removeAllListeners('dialog');
    let leavePrompts = 0;
    page.on('dialog', dialog => { leavePrompts += 1; return dialog.dismiss(); });
    await page.getByRole('link', { name: '返回太卜', exact: true }).click();
    check('Cancelling leave keeps drafts from several settings categories', new URL(page.url()).pathname === '/settings/general' && await page.getByLabel('早报投递时间').inputValue() === '10:15' && leavePrompts === 1);
    await page.evaluate(() => { history.replaceState(null, '', '#settings/personalization'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    check('AI draft survives switching categories and cancelling leave', await instructions.inputValue() === 'Dirty same-account draft');
    page.removeAllListeners('dialog');
    leavePrompts = 0;
    page.on('dialog', dialog => { leavePrompts += 1; return dialog.accept(); });
    await page.getByRole('link', { name: '返回太卜', exact: true }).click();
    await until(() => location.pathname === '/bazi');
    check('Several dirty forms produce one confirmation on accepted leave', leavePrompts === 1);
    readsBeforeClose = settingsReads;

    failRename = true;
    await page.getByRole('button', { name: 'Rename actual first', exact: true }).click();
    await until(() => document.querySelector('[data-testid="operation"]').textContent === 'false');
    check('Failed rename rolls back the Query-owned list', await page.locator('[data-id="alice-1"]').textContent() === 'alice conversation 1');
    failDelete = true;
    await page.getByRole('button', { name: 'Delete actual first', exact: true }).click();
    await until(() => window.fixture.list().length === 9);
    check('Failed delete restores original ordering', await page.locator('[data-testid="conversation-list"] li').first().getAttribute('data-id') === 'alice-1');

    await page.getByRole('button', { name: 'Fixture Chat route', exact: true }).click();
    await page.getByRole('button', { name: 'Start actual stream manager', exact: true }).click();
    await until(() => document.querySelector('[data-testid="stream"]').textContent === 'running:partial');
    await page.getByRole('button', { name: 'Fixture Other route', exact: true }).click();
    check('Actual stream manager and Query update survive fixture route unmount', await page.locator('[data-testid="stream"]').textContent() === 'running:partial' && await page.locator('[data-id="alice-1"]').textContent() === 'Stream: partial');
    await page.getByRole('button', { name: 'Stop actual stream manager', exact: true }).click();
    await until(() => document.querySelector('[data-testid="stream"]').textContent === 'stopped:partial');
    await page.getByRole('button', { name: 'Fixture Chat route', exact: true }).click();
    await page.getByRole('button', { name: 'Regenerate actual stream manager', exact: true }).click();
    await until(() => document.querySelector('[data-testid="stream"]').textContent === 'running:partial');
    await page.evaluate(() => window.fixture.finishStream());
    await until(() => document.querySelector('[data-testid="stream"]').textContent === 'completed:partial completed');
    const saves = requests.filter(item => item.pathname === '/api/conversations/alice-1' && item.body?.messages);
    check('Stopped partial and regenerated completion each persist exactly once', saves.length === 2 && saves[0].body.messages.at(-1).content === 'partial' && saves[1].body.messages.at(-1).content === 'partial completed');
    check('Parent list and stream rerenders do not reload mounted settings for the same user', settingsReads === readsBeforeClose);

    await page.getByRole('button', { name: 'Open actual settings', exact: true }).click();
    await page.getByText('推送通知', { exact: true }).waitFor();
    readsBeforeClose = settingsReads;
    holdList = true;
    await page.getByRole('button', { name: 'Refresh actual list', exact: true }).click();
    for (let attempt = 0; !releaseList && attempt < 100; attempt++) await page.waitForTimeout(10);
    assert.ok(releaseList, 'Controlled list request was intercepted');
    delayedRename = true;
    await page.getByRole('button', { name: 'Rename actual first', exact: true }).click();
    for (let attempt = 0; !releaseRename && attempt < 100; attempt++) await page.waitForTimeout(10);
    assert.ok(releaseRename, 'Controlled rename request was intercepted');
    const nextSettingsResponse = () => page.waitForResponse(response => response.url().endsWith('/api/user/settings') && response.request().method() === 'GET');
    const bobSettings = nextSettingsResponse();
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.list().length === 2 && window.fixture.list()[0].id === 'bob-1');
    await (await bobSettings).finished();
    check('Changing users remounts account-owned settings panels', settingsReads >= readsBeforeClose + 2);
    const readsAfterBob = settingsReads;
    const lateRenameResponse = page.waitForResponse(response => response.url().endsWith('/api/conversations/alice-1') && response.request().method() === 'PATCH');
    releaseList(); releaseRename();
    await (await lateRenameResponse).finished();
    check('Old-account load and failed rename cannot contaminate new-account data', (await page.locator('[data-testid="conversation-list"] li').allTextContents()).join('|') === rows.bob.map(row => row.title).join('|'));
    check('Account change removes old-user Query data', await page.evaluate(() => window.fixture.client.getQueryData(['chat', 'conversations', 'alice']) === undefined));
    await page.getByRole('button', { name: 'Fixture Logout', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.list().length === 0);
    check('Logout clears previous-user Query data', await page.evaluate(() => window.fixture.client.getQueryData(['chat', 'conversations', 'bob']) === undefined));
    check('Logout does not load authenticated settings', settingsReads === readsAfterBob);

    const aliceSettings = nextSettingsResponse();
    await page.evaluate(() => window.fixtureAuth.change('alice'));
    await (await aliceSettings).finished();
    check('Signing back in reloads account panels without remounting the settings host', settingsReads >= readsAfterBob + 2);
    await page.getByRole('button', { name: 'Fixture Models route', exact: true }).click();
    await page.getByText('Fixture Model', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新增模型', exact: true }).click();
    const creation = page.locator('[data-testid="models"] > div > div').filter({ has: page.getByRole('heading', { name: '创建模型', exact: true }) });
    await page.getByPlaceholder('deepseek-v3.2', { exact: true }).fill('  created-fixture  ');
    await page.getByPlaceholder('DeepSeek V3.2', { exact: true }).fill('Created Fixture');
    await page.getByRole('button', { name: '新增模型', exact: true }).click();
    await page.getByRole('button', { name: '新增模型', exact: true }).click();
    check('Create draft survives controlled form hide/reopen', await page.getByPlaceholder('deepseek-v3.2', { exact: true }).inputValue() === '  created-fixture  ');
    await creation.locator('select').nth(2).selectOption('octopus');
    check('Actual create form couples fixed routing to primary gateway', await creation.locator('select').nth(3).inputValue() === 'octopus');
    await creation.getByRole('checkbox', { name: '支持推理', exact: true }).check();
    await creation.getByRole('button', { name: '高级设置', exact: true }).click();
    await creation.locator('select').filter({ has: page.locator('option[value="max"]') }).selectOption('max');
    await page.getByRole('button', { name: '创建模型', exact: true }).click();
    await page.getByText('Created Fixture', { exact: true }).waitFor();
    const created = requests.find(item => item.pathname === '/api/admin/ai-models' && item.method === 'POST');
    check('Actual create handler submits trimmed identity and preserved defaults', created?.body.modelKey === 'created-fixture' && created.body.primaryGatewayKey === 'octopus' && created.body.defaultTemperature === 0.7 && created.body.defaultTopP === null);
    check('Actual create form submits the native maximum reasoning level', created.body.defaultReasoningEffort === 'max');
    await page.getByText('Fixture Model', { exact: true }).click();
    await page.getByRole('button', { name: '保存模型设置', exact: true }).waitFor();
    const modelInput = page.locator('[data-testid="models"] input[type="text"]').filter({ visible: true });
    await modelInput.nth(1).fill('Edited Fixture Model');
    const effortSelect = page.locator('[data-testid="models"] select').filter({ has: page.locator('option[value="xhigh"]') }).filter({ visible: true });
    await effortSelect.selectOption('xhigh');
    await page.getByText('Fixture Model', { exact: true }).click();
    await page.getByText('Fixture Model', { exact: true }).click();
    check('Edit draft survives collapsing the controlled model view', await modelInput.nth(1).inputValue() === 'Edited Fixture Model');
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.getByText('Edited Fixture Model', { exact: true }).waitFor();
    check('Actual edit form persists controlled model draft', requests.some(item => item.pathname === '/api/admin/ai-models/model-1' && item.method === 'PATCH' && item.body.displayName === 'Edited Fixture Model'));
    check('Actual edit form saves and restores extra-high reasoning', requests.some(item => item.pathname === '/api/admin/ai-models/model-1' && item.method === 'PATCH' && item.body.defaultReasoningEffort === 'xhigh') && await effortSelect.inputValue() === 'xhigh');
    await modelInput.nth(1).fill('Unsaved model while editing source');
    await page.getByRole('button', { name: '添加备用来源', exact: true }).click();
    await page.getByPlaceholder('留空则跟随模型 ID（fixture-model）', { exact: true }).fill(' upstream-fixture ');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('Octopus', { exact: true }).waitFor();
    check('Source reload preserves unsaved model settings', await modelInput.nth(1).inputValue() === 'Unsaved model while editing source');
    check('Actual source form submits normalized override and remaining gateway', requests.some(item => item.pathname === '/api/admin/ai-models/model-1/sources' && item.body.sourceKey === 'octopus' && item.body.modelIdOverride === 'upstream-fixture'));
    await page.getByRole('button', { name: '编辑来源', exact: true }).nth(1).click();
    await page.getByPlaceholder('留空则跟随模型 ID（fixture-model）', { exact: true }).fill('fixture-model');
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByText('来源已更新', { exact: true }).waitFor();
    check('Actual inline source editor normalizes matching model ID to inheritance', requests.some(item => item.pathname === '/api/admin/ai-models/model-1/sources/source-2' && item.method === 'PATCH' && item.body.modelIdOverride === null));
    const modelWrites = requests.filter(item => item.pathname === '/api/admin/ai-models/model-1' && item.method === 'PATCH').length;
    await page.locator('[data-testid="models"] textarea').fill('[]');
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.getByText('自定义参数必须是 JSON 对象', { exact: true }).waitFor();
    check('Invalid model JSON is rejected before HTTP mutation', requests.filter(item => item.pathname === '/api/admin/ai-models/model-1' && item.method === 'PATCH').length === modelWrites);
    await page.getByRole('button', { name: 'Fixture Announcements route', exact: true }).click();
    const announcementPanel = page.getByTestId('announcements');
    await announcementPanel.getByText('还没有任何公告', { exact: true }).waitFor();
    await announcementPanel.getByRole('button', { name: '新建公告', exact: true }).click();
    await announcementPanel.locator('textarea').fill('Fixture announcement');
    await page.evaluate(() => { window.fixture.invalidations.length = 0; });
    failAnnouncementWrite = true;
    await announcementPanel.getByRole('button', { name: '发布公告', exact: true }).click();
    await page.getByText('Controlled fixture failure', { exact: true }).last().waitFor();
    check('Failed announcement creation does not invalidate queries', (await page.evaluate(() => window.fixture.invalidations)).length === 0);
    for (const [button, content, toast] of [
      ['发布公告', 'Fixture announcement', '公告已发布'],
      ['保存修改', 'Updated fixture announcement', '公告已更新'],
    ]) {
      await announcementPanel.locator('textarea').fill(content);
      await page.evaluate(() => { window.fixture.invalidations.length = 0; });
      await announcementPanel.getByRole('button', { name: button, exact: true }).click();
      await page.getByText(toast, { exact: true }).waitFor();
      const effects = await page.evaluate(() => window.fixture.invalidations);
      check(`Announcement ${button} invalidates once (observed ${effects.length})`, JSON.stringify(effects) === JSON.stringify([{ queryKey: ['announcements'] }]));
    }
    await announcementPanel.getByRole('button', { name: '返回历史', exact: true }).click();
    const deleteDialog = page.getByRole('dialog');
    await announcementPanel.getByTitle('删除', { exact: true }).click();
    await deleteDialog.getByRole('button', { name: '取消', exact: true }).click();
    check('Announcement deletion waits for confirmation', !requests.some(item => item.pathname === '/api/admin/announcements/announcement-fixture' && item.method === 'DELETE'));
    await announcementPanel.getByTitle('删除', { exact: true }).click();
    for (const rejected of [true, false]) {
      failAnnouncementWrite = rejected;
      await page.evaluate(() => { window.fixture.invalidations.length = 0; });
      const deleted = page.waitForResponse(response => response.url().endsWith('/api/admin/announcements/announcement-fixture') && response.request().method() === 'DELETE');
      // A failed deletion keeps the dialog open, so the second pass confirms again.
      await deleteDialog.getByRole('button', { name: '确认删除', exact: true }).click();
      await (await deleted).finished();
      if (rejected) {
        await until(() => document.querySelector('[data-testid="announcements"] button[title="删除"]')?.disabled === false);
        check('Failed announcement deletion preserves the row without invalidation', (await page.evaluate(() => window.fixture.invalidations)).length === 0 && await announcementPanel.getByText('Updated fixture announcement', { exact: true }).isVisible() && await deleteDialog.isVisible());
      } else {
        await announcementPanel.getByText('还没有任何公告', { exact: true }).waitFor();
        check('Announcement DELETE invalidates once', JSON.stringify(await page.evaluate(() => window.fixture.invalidations)) === JSON.stringify([{ queryKey: ['announcements'] }]));
      }
    }
    await page.getByRole('button', { name: 'Fixture Keys route', exact: true }).click();
    const keyPanel = page.getByTestId('activation-keys');
    const keyReads = () => requests.filter(item => item.pathname === '/api/activation-keys' && item.method === 'GET').length;
    await keyPanel.getByText('sk-fixtureunused001', { exact: true }).waitFor();
    check('Activation key list renders keys from the { success, data } payload', await keyPanel.getByText('sk-fixtureused00002', { exact: true }).isVisible());
    const readsBeforeFilter = keyReads();
    await keyPanel.getByRole('button', { name: '已使用 1', exact: true }).click();
    check('Activation key filters narrow the loaded list without refetching', await keyPanel.getByText('sk-fixtureunused001', { exact: true }).count() === 0
      && await keyPanel.getByRole('button', { name: '已使用 1', exact: true }).getAttribute('aria-pressed') === 'true' && keyReads() === readsBeforeFilter);
    await keyPanel.getByRole('button', { name: '批量创建', exact: true }).click();
    await keyPanel.getByLabel('类型').selectOption('credits');
    await keyPanel.getByLabel('每个积分数量').fill('30');
    await keyPanel.getByLabel('生成数量').fill('1.5');
    check('Activation key form blocks fractional counts', await keyPanel.getByRole('button', { name: '生成', exact: true }).isDisabled());
    await keyPanel.getByLabel('生成数量').fill('2');
    failKeyCreate = true;
    await keyPanel.getByRole('button', { name: '生成', exact: true }).click();
    await page.getByText('Fixture key limit', { exact: true }).last().waitFor();
    check('Activation key creation surfaces the server reason and keeps the form', await keyPanel.getByLabel('生成数量').inputValue() === '2');
    await keyPanel.getByRole('button', { name: '生成', exact: true }).click();
    await keyPanel.getByText('sk-fixturecreated01', { exact: true }).waitFor();
    check('Activation key creation posts the batch, shows all keys and reloads', requests.some(item => item.pathname === '/api/activation-keys' && item.method === 'POST'
      && item.body.count === 2 && item.body.keyType === 'credits' && item.body.creditsAmount === 30) && await keyPanel.getByText('已生成 2 个激活码', { exact: true }).isVisible()
      && await keyPanel.getByRole('button', { name: '全部 4', exact: true }).getAttribute('aria-pressed') === 'true');
    await keyPanel.getByRole('button', { name: '删除激活码 sk-fixtureused00002', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click();
    await until(() => !document.querySelector('[data-testid="activation-keys"] table')?.textContent.includes('sk-fixtureused00002'));
    check('Activation key deletion confirms first and removes only that key', requests.some(item => item.pathname === '/api/activation-keys' && item.method === 'DELETE' && item.search === '?id=key-used')
      && await keyPanel.getByText('sk-fixtureunused001', { exact: true }).isVisible());
    // Explicitly remount while a real loadModels receipt is held. React's
    // development effect replay count varies for later conditional mounts.
    const oldModelLoad = holdNext('/api/admin/ai-models', 'GET');
    oldModelLoad.snapshot = { models: models.map(model => model.id === 'model-1' ? { ...model, displayName: 'Stale older reload' } : model) };
    await page.getByRole('button', { name: 'Fixture Models route', exact: true }).click();
    await intercepted(oldModelLoad);
    await page.evaluate(() => window.fixture.remountModels());
    await page.getByText('Edited Fixture Model', { exact: true }).waitFor();
    oldModelLoad.release();
    await page.waitForTimeout(40);
    check('Older model reload cannot overwrite a newer completed reload', await page.getByText('Stale older reload', { exact: true }).count() === 0 && await page.getByText('Edited Fixture Model', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Fixture Announcements route', exact: true }).click();

    // Actual Host/panels and root auth Provider; only auth I/O is synthetic.
    const aiDraft = page.getByPlaceholder('例如：先给结论，再给依据；避免空话和术语堆叠。');
    await page.evaluate(() => { history.replaceState(null, '', '#settings/personalization'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await aiDraft.waitFor();
    await aiDraft.fill('Submitted snapshot');
    const saveDuringEdit = holdNext('/api/user/settings', 'PATCH');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await intercepted(saveDuringEdit);
    await aiDraft.fill('Edited while save pending');
    saveDuringEdit.release();
    await until(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '保存' && !button.disabled));
    check('AI save response advances baseline without replacing later edits', await aiDraft.inputValue() === 'Edited while save pending');
    check('Settings clients send expected account header for reads and writes', requests.filter(item => item.pathname === '/api/user/settings').every(item => item.expectedUserId === 'alice' || item.expectedUserId === 'bob'));
    await page.evaluate(() => { window.fixtureAuth.cookieUser = 'bob'; });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('保存失败', { exact: true }).first().waitFor();
    check('Cookie change before Provider sync rejects old account draft', settingsByUser.bob.customInstructions === 'Bob preferences' && await aiDraft.inputValue() === 'Edited while save pending');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await until(() => window.fixture.user === 'bob');
    await until(() => document.querySelector('textarea[placeholder^="例如：先给结论"]')?.value === 'Bob preferences');
    check('Cross-account real focus replaces old settings', await aiDraft.inputValue() === 'Bob preferences');
    // These fixture events represent auth changes in another tab, outside the modal.
    await page.evaluate(() => window.fixtureAuth.change(null));
    await until(() => window.fixture.user === null);
    const readsStart = controls.length;
    holdSettingsReads = true;
    const staleRead = holdNext('/api/user/settings', 'GET');
    await page.evaluate(() => window.fixtureAuth.change('bob'));
    await intercepted(staleRead);
    await page.waitForTimeout(30);
    holdSettingsReads = false;
    const staleReads = controls.splice(readsStart);
    await page.evaluate(() => window.fixtureAuth.change('alice'));
    await until(() => window.fixture.user === 'alice');
    await aiDraft.waitFor();
    await aiDraft.fill('Fresh Alice draft');
    for (const read of staleReads) read.release?.();
    await page.waitForTimeout(30);
    check('Late old-account settings GET cannot overwrite current draft', await aiDraft.inputValue() === 'Fresh Alice draft');
    const staleSave = holdNext('/api/user/settings', 'PATCH');
    await page.getByRole('radio', { name: '暗色高对比', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await intercepted(staleSave);
    await page.evaluate(() => window.fixtureAuth.change(null));
    await until(() => window.fixture.user === null);
    await page.evaluate(() => window.fixtureAuth.change('alice'));
    await until(() => window.fixture.user === 'alice');
    await aiDraft.waitFor();
    await aiDraft.fill('New login same Alice');
    await page.evaluate(() => { localStorage.setItem('chartStyle', 'modern'); window.fixture.invalidations.length = 0; });
    staleSave.release();
    await page.waitForTimeout(40);
    check('Logout/login same-ID stale PATCH cannot reset draft or local preferences', await aiDraft.inputValue() === 'New login same Alice' && await page.evaluate(() => localStorage.getItem('chartStyle')) === 'modern');
    check('Aborted settings completion does not emit old mutation effects', (await page.evaluate(() => window.fixture.invalidations)).length === 0);
    await page.getByRole('link', { name: '返回太卜', exact: true }).click();
    await page.locator('.settings-page').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Open actual settings', exact: true }).click();
    await page.getByText('推送通知', { exact: true }).waitFor();
    const notificationSwitch = page.getByRole('switch').first();
    const beforeNotification = await notificationSwitch.getAttribute('aria-checked');
    const generalFail = holdNext('/api/user/settings', 'PATCH', true);
    await notificationSwitch.click();
    await intercepted(generalFail);
    check('General setting serializes same-field operations while saving', await notificationSwitch.isDisabled());
    const reminderSwitch = page.getByRole('switch', { name: '节气提醒', exact: true });
    await reminderSwitch.click();
    await until(() => document.querySelector('[role="switch"][aria-label="节气提醒"]')?.getAttribute('aria-checked') === 'true');
    generalFail.release();
    await until(() => !document.querySelector('[role="switch"]').disabled);
    check('Failed preference rolls back only its field and preserves successful reminder', await notificationSwitch.getAttribute('aria-checked') === beforeNotification && await reminderSwitch.getAttribute('aria-checked') === 'true');
    const reminderFail = holdNext('/api/reminders', 'POST', true);
    await reminderSwitch.click();
    await intercepted(reminderFail);
    const fortuneSwitch = page.getByRole('switch', { name: '运势提醒', exact: true });
    await fortuneSwitch.click();
    reminderFail.release();
    await until(() => !document.querySelector('[role="switch"][aria-label="节气提醒"]').disabled);
    check('Failed reminder rolls back only its item', await reminderSwitch.getAttribute('aria-checked') === 'true' && await fortuneSwitch.getAttribute('aria-checked') === 'true');
    await page.getByRole('link', { name: '返回太卜', exact: true }).click();

    // Controlled interleavings invoke real ConversationListProvider actions.
    rows.alice = Array.from({ length: 12 }, (_, index) => ({ id: 'race-' + (index + 1), user_id: 'alice', title: 'Race ' + (index + 1), personality: 'general', created_at: '2026-01-01', updated_at: '2026-01-01', source_type: 'chat' }));
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.list()[0]?.id === 'bob-1');
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.list().length === 7 && window.fixture.list()[0]?.id === 'race-1');
    const append = holdNext('/api/conversations', 'GET');
    await page.getByRole('button', { name: 'Load more actual list', exact: true }).click();
    await intercepted(append);
    await page.getByRole('button', { name: 'Refresh actual list', exact: true }).click();
    await until(() => !window.fixture.context.refreshingConversations);
    append.release();
    await page.waitForTimeout(30);
    check('Refresh preemption clears superseded append loading state', !await page.evaluate(() => window.fixture.context.loadingMoreConversations));
    await page.getByRole('button', { name: 'Load more actual list', exact: true }).click();
    await until(() => window.fixture.list().length === 12);
    checks.push('Pagination can continue after refresh preempts an append');
    const renameA = holdNext('/api/conversations/race-1', 'PATCH', true);
    await page.evaluate(() => { window.fixture.ops = {}; window.fixture.context.handleRenameConversation('race-1', 'Pending A').then(result => { window.fixture.ops.a = result; }); });
    await intercepted(renameA);
    const overlap = await page.evaluate(() => window.fixture.context.handleRenameConversation('race-1', 'Duplicate A'));
    check('Same-ID overlapping writes are explicitly rejected', overlap === false);
    const deleteOverlap = await page.evaluate(() => window.fixture.context.handleDeleteConversation('race-1'));
    check('Same-ID delete cannot overtake a pending rename', deleteOverlap === false);
    await page.evaluate(() => window.fixture.context.handleRenameConversation('race-2', 'Successful B'));
    renameA.release();
    await until(() => window.fixture.ops.a === false);
    check('Failed rename A preserves concurrently successful rename B', await page.locator('[data-id="race-2"]').textContent() === 'Successful B');
    const deleteA = holdNext('/api/conversations/race-1', 'DELETE', true);
    await page.evaluate(() => { window.fixture.context.handleDeleteConversation('race-1').then(result => { window.fixture.ops.deletedA = result; }); });
    await intercepted(deleteA);
    await page.evaluate(() => window.fixture.context.handleDeleteConversation('race-2'));
    rows.alice.push({ ...rows.alice[0], id: 'race-new', title: 'New page arrival' });
    await page.evaluate(() => window.fixture.context.refreshConversationList());
    check('Refresh cannot resurrect a pending deletion', await page.locator('[data-id="race-1"]').count() === 0);
    deleteA.release();
    await until(() => window.fixture.ops.deletedA === false);
    check('Failed delete restores only A, preserving successful B deletion and refreshed rows', await page.locator('[data-id="race-1"]').count() === 1 && await page.locator('[data-id="race-2"]').count() === 0 && await page.locator('[data-id="race-new"]').count() === 1);

    const staleRefresh = holdNext('/api/conversations', 'GET');
    await page.getByRole('button', { name: 'Refresh actual list', exact: true }).click();
    await intercepted(staleRefresh);
    await page.evaluate(() => window.fixture.context.handleDeleteConversation('race-3'));
    staleRefresh.release();
    await page.waitForTimeout(40);
    check('Refresh snapshot captured before successful delete cannot resurrect deleted row', await page.locator('[data-id="race-3"]').count() === 0);

    // No-reload regressions use real hooks/components with held API/body completions.
    const sourceStart = controls.length;
    holdReads.add('/api/data-sources');
    const initialSource = holdNext('/api/data-sources', 'GET');
    await page.evaluate(() => window.fixture.mount.composer(true));
    await intercepted(initialSource);
    sources.alice = [source('source-b', 'Alice source B')];
    holdReads.delete('/api/data-sources');
    await page.evaluate(() => window.fixture.archiveChanged());
    await page.getByTestId('composer-sources').getByText('Alice source B', { exact: true }).waitFor();
    await releaseReads('/api/data-sources', sourceStart);
    check('Composer mutation refresh B survives older initial A in UI and localStorage',
      await page.getByTestId('composer-sources').innerText() === 'Alice source B' &&
      await page.evaluate(() => JSON.parse(localStorage.getItem('taibu.data_sources.alice.v1')).value.items[0].name) === 'Alice source B');

    await page.evaluate(() => window.fixture.mount.composer(false));
    await page.getByTestId('composer').waitFor({ state: 'detached' });
    const remountStart = requests.length;
    const remountedSource = holdNext('/api/data-sources', 'GET');
    await page.evaluate(() => window.fixture.mount.composer(true));
    await intercepted(remountedSource);
    check('Composer remount immediately requests fresh=1 without waiting for server index TTL',
      requests.slice(remountStart).filter(item => item.pathname === '/api/data-sources').every(item => new URLSearchParams(item.search).get('fresh') === '1'));
    await release(remountedSource);
    await until(() => !window.fixture.composer.mentionLoading);
    check('Cached composer remount cannot regress to nonfresh server snapshot', await page.getByTestId('composer-sources').innerText() === 'Alice source B');

    await page.evaluate(() => { window.fixtureNetwork.jsonGate = { pathname: '/api/data-sources', intercepted: false }; void window.fixture.composer.refreshMentionData(true); });
    await until(() => window.fixtureNetwork.jsonGate.intercepted);
    sources.alice = [source('source-c', 'Alice source C')];
    await page.evaluate(() => window.fixture.archiveChanged());
    await page.getByTestId('composer-sources').getByText('Alice source C', { exact: true }).waitFor();
    await page.evaluate(() => { window.fixtureNetwork.jsonGate.release(); window.fixtureNetwork.jsonGate = null; });
    await renderBarrier();
    check('Composer checks generation after pending JSON, not only after fetch headers',
      await page.getByTestId('composer-sources').innerText() === 'Alice source C' &&
      await page.evaluate(() => JSON.parse(localStorage.getItem('taibu.data_sources.alice.v1')).value.items[0].name) === 'Alice source C');

    const oldSource = holdNext('/api/data-sources', 'GET');
    await page.evaluate(() => { void window.fixture.composer.refreshMentionData(true); });
    await intercepted(oldSource);
    const newAccountSource = holdNext('/api/data-sources', 'GET');
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).evaluate(button => button.click());
    await intercepted(newAccountSource);
    check('Composer clears Alice sources immediately while Bob request remains pending',
      await page.getByTestId('composer-sources').innerText() === '');
    await release(newAccountSource);
    await page.getByTestId('composer-sources').getByText('Bob only source', { exact: true }).waitFor();
    await release(oldSource);
    check('Composer old-account completion cannot overwrite Bob data or restore Alice cache',
      await page.getByTestId('composer-sources').innerText() === 'Bob only source' &&
      await page.evaluate(() => localStorage.getItem('taibu.data_sources.alice.v1') === null));
    const logoutSource = holdNext('/api/data-sources', 'GET');
    await page.evaluate(() => { void window.fixture.composer.refreshMentionData(true); });
    await intercepted(logoutSource);
    await page.getByRole('button', { name: 'Fixture Logout', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.user === null);
    await release(logoutSource);
    check('Composer logout clears visible sources, knowledge bases and account cache while mounted',
      await page.getByTestId('composer-sources').innerText() === '' && await page.getByTestId('composer-knowledge').innerText() === '' &&
      await page.evaluate(() => localStorage.getItem('taibu.data_sources.bob.v1') === null));
    await page.evaluate(() => window.fixture.mount.composer(false));
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.user === 'alice');

    const openCharts = async () => {
      await page.evaluate(() => { history.replaceState(null, '', '#settings/charts'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    };
    // 行内操作按钮与跳转链接是同级元素，按包含该链接的列表项定位整行。
    const chartRow = id => page.locator('li').filter({ has: page.locator('a[href="/bazi/result?chart=' + id + '"]') });
    const createChart = (id, name) => page.evaluate(({ id, name }) =>
      window.fixture.chartClient.createSavedChart('bazi', { id, name, gender: 'male', birth_date: '1990-01-01', birth_time: '12:00',
        fixtureRaw: 'retained raw field' }, { expectedUserId: window.fixture.user }), { id, name });
    await openCharts();
    await chartRow('chart-alice').waitFor();
    await chartRow('chart-alice').evaluate(node => { node.dataset.fixtureIdentity = 'preserved-chart-node'; });
    await page.getByRole('link', { name: '常规', exact: true }).click();
    await createChart('chart-created', 'Created without reload');
    await openCharts();
    await chartRow('chart-created').waitFor();
    check('Hidden actual ChartsPanel receives real createSavedChart and reopens on the same DOM',
      await chartRow('chart-alice').getAttribute('data-fixture-identity') === 'preserved-chart-node');
    await page.evaluate(() => { window.fixture.mount.selected(true); window.fixture.mount.picker(true); });
    const picker = page.getByTestId('chart-picker');
    await picker.getByText('Created without reload', { exact: true }).waitFor();
    await page.getByTestId('selected-chart').getByText('Alice confirmed chart', { exact: true }).waitFor();
    const rawChart = await page.evaluate(() => window.fixture.chartClient.loadSavedChart('bazi', 'chart-created', { expectedUserId: 'alice' }));
    check('Raw saved-chart facade retains non-summary edit fields', rawChart?.fixtureRaw === 'retained raw field');
    await page.evaluate(() => window.fixture.chartClient.updateSavedChart('bazi', 'chart-created', { name: 'Edited without reload' }, { expectedUserId: 'alice' }));
    await chartRow('chart-created').getByText('Edited without reload', { exact: true }).waitFor();
    await picker.getByText('Edited without reload', { exact: true }).waitFor();
    check('Actual chart edit facade synchronizes mounted panel and open picker',
      requests.some(item => item.pathname === '/api/bazi/charts/update' && item.body?.chartId === 'chart-created' && item.body.payload?.name === 'Edited without reload'));

    const defaultFailure = holdNext('/api/user/charts', 'PATCH', true);
    await chartRow('chart-created').getByTitle('设为默认', { exact: true }).click();
    await intercepted(defaultFailure);
    check('Pending default mutation keeps the confirmed default marker', await chartRow('chart-alice').getByText('默认', { exact: true }).count() === 1);
    await release(defaultFailure);
    await page.getByText('设置默认命盘失败', { exact: true }).last().waitFor();
    check('Failed default mutation preserves confirmed marker and selected-chart helper',
      await chartRow('chart-alice').getByText('默认', { exact: true }).count() === 1 && await page.getByTestId('selected-chart').innerText() === 'Alice confirmed chart');
    await chartRow('chart-created').getByTitle('设为默认', { exact: true }).click();
    await chartRow('chart-created').getByText('默认', { exact: true }).waitFor();
    await page.getByTestId('selected-chart').getByText('Edited without reload', { exact: true }).waitFor();
    check('Confirmed default change propagates without reopening picker or selected-chart consumer',
      await picker.getByText('Edited without reload', { exact: true }).isVisible());
    await page.evaluate(() => window.fixture.selectedChart.selectChart('chart-alice'));
    await page.getByTestId('selected-chart').getByText('Alice confirmed chart', { exact: true }).waitFor();
    for (const id of ['chart-alice', 'chart-created']) {
      await page.evaluate(id => window.fixture.chartClient.setDefaultUserChart('bazi', id, { expectedUserId: 'alice' }), id);
      await chartRow(id).getByText('默认', { exact: true }).waitFor();
    }
    check('Explicit chart selection survives changes to the account default',
      await page.getByTestId('selected-chart').innerText() === 'Alice confirmed chart');
    await page.evaluate(() => window.fixture.chartClient.updateSavedChart('bazi', 'chart-alice', { name: 'Selected chart edited' }, { expectedUserId: 'alice' }));
    await page.getByTestId('selected-chart').getByText('Selected chart edited', { exact: true }).waitFor();
    check('Explicit selected ID resolves refreshed fields rather than retaining a copied chart',
      await chartRow('chart-alice').getByRole('heading', { name: 'Selected chart edited', exact: true }).isVisible());
    await page.evaluate(() => window.fixture.chartClient.updateSavedChart('bazi', 'chart-alice', { name: 'Alice confirmed chart' }, { expectedUserId: 'alice' }));
    await page.getByTestId('selected-chart').getByText('Alice confirmed chart', { exact: true }).waitFor();
    await chartRow('chart-created').getByTitle('删除命盘', { exact: true }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await chartRow('chart-created').waitFor({ state: 'detached' });
    await picker.getByText('Edited without reload', { exact: true }).waitFor({ state: 'detached' });
    await page.getByTestId('selected-chart').getByText('Alice confirmed chart', { exact: true }).waitFor();
    check('Delete removes the chart from panel, open picker and selected-chart helper',
      !await page.evaluate(() => window.fixture.selectedChart.data?.baziCharts.some(item => item.id === 'chart-created')));

    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).evaluate(button => button.click());
    await chartRow('chart-bob').waitFor();
    charts.alice = { baziCharts: [], ziweiCharts: [], defaultChartIds: { bazi: null, ziwei: null } };
    const emptyChartStart = controls.length;
    holdReads.add('/api/user/charts');
    const emptyChartLoad = holdNext('/api/user/charts', 'GET');
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button.click());
    await intercepted(emptyChartLoad);
    holdReads.delete('/api/user/charts');
    await createChart('chart-first', 'First chart after empty load');
    await chartRow('chart-first').waitFor();
    await releaseReads('/api/user/charts', emptyChartStart);
    check('Creation cancels an initial empty Query read so its old response cannot erase fresh data',
      await chartRow('chart-first').isVisible() && await picker.getByText('First chart after empty load', { exact: true }).isVisible());
    const previousChartLoad = holdNext('/api/user/charts', 'GET');
    await page.evaluate(() => { void window.fixture.client.invalidateQueries({ queryKey: window.fixture.chartKey('alice') }); });
    await intercepted(previousChartLoad);
    await createChart('chart-second', 'Second chart after prior snapshot');
    await chartRow('chart-second').waitFor();
    await release(previousChartLoad);
    check('Creation also preempts a stale refetch when Query already has previous chart data',
      await chartRow('chart-first').isVisible() && await chartRow('chart-second').isVisible());

    const aliceChartLoad = holdNext('/api/user/charts', 'GET');
    await page.evaluate(() => { void window.fixture.client.invalidateQueries({ queryKey: window.fixture.chartKey('alice') }); });
    await intercepted(aliceChartLoad);
    const aliceChartMutation = holdNext('/api/user/charts', 'PATCH');
    await chartRow('chart-second').getByTitle('设为默认', { exact: true }).click();
    await intercepted(aliceChartMutation);
    const bobChartLoad = holdNext('/api/user/charts', 'GET');
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).evaluate(button => button.click());
    await intercepted(bobChartLoad);
    // Bob was visited above; his own cached chart may remain visible during revalidation.
    // Only Alice's rows/selection are forbidden, not a valid same-account cache hit.
    const pendingSelection = await page.getByTestId('selected-chart').innerText();
    check('Chart consumers hide Alice immediately while the new-account Query is pending',
      await chartRow('chart-first').count() === 0 && await chartRow('chart-second').count() === 0 &&
      !(await picker.innerText()).includes('Second chart after prior snapshot') &&
      (pendingSelection === '' || pendingSelection === 'Bob only chart'));
    await release(bobChartLoad);
    await chartRow('chart-bob').waitFor();
    await picker.getByText('Bob only chart', { exact: true }).waitFor();
    await page.getByTestId('selected-chart').getByText('Bob only chart', { exact: true }).waitFor();
    await page.evaluate(() => { window.fixture.invalidations.length = 0; });
    await release(aliceChartLoad);
    await release(aliceChartMutation);
    check('Old-account chart reads and successful mutation completions cannot expose Alice after Bob',
      await chartRow('chart-first').count() === 0 && await chartRow('chart-second').count() === 0 &&
      await picker.getByText('Second chart after prior snapshot', { exact: true }).count() === 0 &&
      await page.getByTestId('selected-chart').innerText() === 'Bob only chart');
    check('Old chart Query state is removed and aborted default completion emits no invalidation',
      await page.evaluate(() => window.fixture.client.getQueryData(window.fixture.chartKey('alice')) === undefined && window.fixture.invalidations.length === 0));
    check('Chart reads and writes carry expected-user fences through real facades',
      requests.filter(item => item.pathname === '/api/user/charts' || /^\/api\/bazi\/charts/.test(item.pathname))
        .every(item => item.expectedUserId === 'alice' || item.expectedUserId === 'bob'));
    await page.getByRole('link', { name: '返回太卜', exact: true }).click();
    await page.evaluate(() => { window.fixture.mount.picker(false); window.fixture.mount.selected(false); });
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.user === 'alice');

    const historyPage = page.getByTestId('history-page');
    const initialHistory = holdNext('/api/history-summaries', 'GET');
    await page.evaluate(() => window.fixture.mount.history(true));
    await intercepted(initialHistory);
    histories.alice = histories.alice.filter(item => item.id !== 'alice-history-1');
    await page.evaluate(() => window.fixture.archiveChanged());
    await historyPage.locator('[data-history-id="alice-history-2"]').waitFor();
    await release(initialHistory);
    check('HistoryPageTemplate refresh supersedes its held initial response without resurrecting old rows',
      await historyPage.locator('[data-history-id="alice-history-1"]').count() === 0 &&
      await historyPage.locator('[data-history-id]').count() === 12);
    await historyPage.getByText('继续下滑加载更多', { exact: true }).waitFor();
    await renderBarrier();
    const historyAppend = holdNext('/api/history-summaries', 'GET');
    await page.evaluate(() => window.fixtureIntersect('[data-testid="history-page"]'));
    await intercepted(historyAppend);
    histories.alice = histories.alice.filter(item => item.id !== 'alice-history-14');
    await page.evaluate(() => window.fixture.archiveChanged());
    await historyPage.locator('[data-history-id="alice-history-2"]').waitFor();
    await release(historyAppend);
    check('History refresh preempts append and cannot append the old deleted tail',
      await historyPage.locator('[data-history-id="alice-history-14"]').count() === 0 &&
      await historyPage.locator('[data-history-id]').count() === 12 &&
      await historyPage.getByText('继续下滑加载更多', { exact: true }).count() === 0);
    const historyBeforeDelete = holdNext('/api/history-summaries', 'GET');
    await page.evaluate(() => window.fixture.archiveChanged());
    await intercepted(historyBeforeDelete);
    await page.evaluate(() => window.fixture.deleteHistory('tarot', 'alice-history-3'));
    await release(historyBeforeDelete);
    check('History deletion event fences an already captured initial refresh snapshot',
      await historyPage.locator('[data-history-id="alice-history-3"]').count() === 0);
    await historyPage.getByRole('button', { name: 'Delete history alice-history-2', exact: true }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await historyPage.locator('[data-history-id="alice-history-2"]').waitFor({ state: 'detached' });
    check('Real history card action and confirmation still delete through the production facade',
      requests.some(item => item.pathname === '/api/history-summaries' && item.method === 'DELETE' && new URLSearchParams(item.search).get('id') === 'alice-history-2'));
    await page.evaluate(() => window.fixture.mount.history(false));
    await historyPage.waitFor({ state: 'detached' });

    const drawer = page.getByTestId('history-drawer');
    await page.evaluate(() => window.fixture.mount.drawer(true));
    await drawer.getByTitle('历史记录', { exact: true }).evaluate(button => button.click());
    await drawer.getByText('alice history 4', { exact: true }).waitFor();
    const bobDrawer = holdNext('/api/history-summaries', 'GET');
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).evaluate(button => button.click());
    await intercepted(bobDrawer);
    check('Open HistoryDrawer clears rendered Alice rows before Bob response arrives',
      !(await drawer.innerText()).includes('alice history'));
    await release(bobDrawer);
    await drawer.getByText('bob history 1', { exact: true }).waitFor();
    const lateDrawer = holdNext('/api/history-summaries', 'GET');
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button.click());
    await intercepted(lateDrawer);
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).evaluate(button => button.click());
    await drawer.getByText('bob history 1', { exact: true }).waitFor();
    await release(lateDrawer);
    check('Open HistoryDrawer rejects old-account response after switching back to Bob',
      !(await drawer.innerText()).includes('alice history') && await drawer.getByText('bob history 2', { exact: true }).isVisible());
    await page.evaluate(() => window.fixture.mount.drawer(false));
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.user === 'alice');

    const snapshotRequestsStart = requests.length;
    const snapshotLookups = () => requests.slice(snapshotRequestsStart).filter(item =>
      item.pathname === '/api/history-summaries' && new URLSearchParams(item.search).get('id') === 'fixture-snapshot-reading').length;
    await page.evaluate(() => window.fixture.mount.snapshot(true));
    await page.getByTestId('analysis-snapshot').filter({ hasText: /^idle:[1-9]/ }).waitFor();
    await renderBarrier();
    const settledSnapshotLookups = snapshotLookups();
    await page.waitForTimeout(500);
    // StrictMode replays the mount effect once, so a single mount may look the record up at most twice.
    check('Analysis snapshot with inline callbacks looks up a record once per mount instead of looping',
      settledSnapshotLookups >= 1 && settledSnapshotLookups <= 2 && snapshotLookups() === settledSnapshotLookups &&
      await page.getByTestId('analysis-snapshot').innerText() === 'idle:1');
    await page.evaluate(() => window.fixture.mount.snapshot(false));

    const recordPanel = page.getByTestId('records');
    await page.evaluate(() => window.fixture.mount.records(true));
    await recordPanel.getByRole('heading', { name: 'General saved record', exact: true }).waitFor();
    const oldRecordFilter = holdNext('/api/records', 'GET');
    await recordPanel.locator('select').selectOption('general');
    await intercepted(oldRecordFilter);
    await recordPanel.locator('select').selectOption('event');
    await recordPanel.getByRole('heading', { name: 'Event saved record', exact: true }).waitFor();
    await release(oldRecordFilter);
    check('Rapid actual record filters cannot render older response under the new filter',
      await recordPanel.locator('select').inputValue() === 'event' &&
      await recordPanel.getByRole('heading', { name: 'Event saved record', exact: true }).isVisible() &&
      await recordPanel.getByRole('heading', { name: 'General saved record', exact: true }).count() === 0);
    const oldRecordRefresh = holdNext('/api/records', 'GET');
    await page.evaluate(() => window.fixture.archiveChanged());
    await intercepted(oldRecordRefresh);
    records[1].title = 'Event refreshed record';
    await page.evaluate(() => window.fixture.archiveChanged());
    await recordPanel.getByRole('heading', { name: 'Event refreshed record', exact: true }).waitFor();
    await release(oldRecordRefresh);
    check('Records archive refresh B survives older refresh A without reloading the page',
      await recordPanel.getByRole('heading', { name: 'Event refreshed record', exact: true }).isVisible() &&
      await recordPanel.getByRole('heading', { name: 'Event saved record', exact: true }).count() === 0);
    await page.evaluate(() => window.fixture.mount.records(false));

    await page.evaluate(() => window.fixture.mount.question(true));
    let structuredDialog = page.getByRole('dialog', { name: '需要你的补充', exact: true });
    await structuredDialog.getByLabel('工作', { exact: true }).check();
    await structuredDialog.getByLabel('生活', { exact: true }).check();
    await structuredDialog.getByLabel('自行填写', { exact: true }).fill('具体项目');
    await structuredDialog.getByRole('button', { name: '下一步', exact: true }).click();
    await structuredDialog.getByRole('button', { name: '跳过', exact: true }).click();
    const answerSummary = page.getByRole('dialog', { name: '确认回答', exact: true });
    await answerSummary.getByText('已跳过', { exact: true }).waitFor();
    await answerSummary.getByRole('button', { name: '选择分析范围 · 修改', exact: true }).click();
    check('Structured question summary returns to stable choices and custom input', await structuredDialog.getByLabel('工作', { exact: true }).isChecked() && await structuredDialog.getByLabel('生活', { exact: true }).isChecked() && await structuredDialog.getByLabel('自行填写', { exact: true }).inputValue() === '具体项目');
    await page.evaluate(() => window.fixture.mount.question(false));
    await structuredDialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.fixture.mount.question(true));
    structuredDialog = page.getByRole('dialog', { name: '需要你的补充', exact: true });
    check('Remounting the same question restores its choices and draft', await structuredDialog.getByLabel('工作', { exact: true }).isChecked() && await structuredDialog.getByLabel('自行填写', { exact: true }).inputValue() === '具体项目');
    await structuredDialog.getByRole('button', { name: '下一步', exact: true }).click();
    await structuredDialog.getByRole('button', { name: '跳过', exact: true }).click();
    await answerSummary.getByRole('button', { name: '提交并继续', exact: true }).click();
    await answerSummary.waitFor({ state: 'hidden' });
    check('Structured answer submission binds selected IDs and explicit skip to the tool call', await page.evaluate(() => JSON.stringify(window.fixture.structuredAnswers.answers) === JSON.stringify({ topics: ['work', 'life', '具体项目'], optional: null }) && localStorage.getItem('taibu.question:alice:structured:same-tool-call') === null));

    await page.evaluate(() => window.fixture.mount.agent(true));
    await until(() => window.fixture.agentChat?.messaging.agent.capabilities.ready);
    await page.evaluate(() => window.fixture.agentChat.messaging.agent.setMode('agent'));
    const selectAgentConversation = async (id, status = null) => {
      await page.evaluate(async ({ id, status }) => {
        const io = window.fixtureAgentIO;
        if (status) io.runs[id] = io.view(id, status, io.runs[id]?.id ?? 'run-' + id, (io.runs[id]?.cursor ?? 0) + 1);
        await window.fixture.agentChat.state.handleSelectConversation(id);
      }, { id, status });
      await until(({ id, status }) => window.fixture.agentChat.state.activeConversationId === id &&
        !window.fixture.agentChat.messaging.agent.restoring &&
        (status ? window.fixture.agentChat.messaging.agent.run?.conversationId === id : !window.fixture.agentChat.messaging.agent.run), { id, status });
      await renderBarrier();
    };
    const sendHeldAgent = async (queue = false) => {
      await page.evaluate(queue => {
        window.fixtureAgentIO.holdNext = true;
        window.fixture.agentSend = queue ? window.fixture.agentChat.messaging.handleQueueMessage() : window.fixture.agentChat.messaging.handleSend();
      }, queue);
      await until(() => window.fixtureAgentIO.held.length > 0);
    };
    const releaseAgent = async () => {
      await page.evaluate(async () => { window.fixtureAgentIO.held.shift()(); await window.fixture.agentSend; });
      await renderBarrier();
    };
    await selectAgentConversation('agent-settings');
    const settingsTrigger = page.locator('[data-testid="agent-chat"]').getByRole('button', { name: /^选择模型：/ });
    await settingsTrigger.click();
    const modelSettings = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
    await modelSettings.waitFor();
    check('Model settings retain disabled membership choices', await modelSettings.getByRole('menuitemradio', { name: /受限模型/ }).isDisabled());
    await modelSettings.getByRole('menuitemradio', { name: '分析模型', exact: true }).focus();
    await page.keyboard.press('End');
    check('Model keyboard navigation skips disabled models', await modelSettings.getByRole('menuitemradio', { name: '仅支持推理开关', exact: true }).evaluate(button => button === document.activeElement));
    await modelSettings.getByRole('menuitemradio', { name: '仅支持推理开关', exact: true }).click();
    await settingsTrigger.click();
    check('Models with only a reasoning switch do not offer unsupported effort levels', await modelSettings.getByLabel('推理档位', { exact: true }).locator('option').count() === 2);
    await modelSettings.getByRole('menuitemradio', { name: '分析模型', exact: true }).click();
    await settingsTrigger.click();
    await modelSettings.getByLabel('推理档位', { exact: true }).selectOption('max');
    await modelSettings.locator('.chat-collaboration-settings > summary').click();
    await modelSettings.getByLabel('启用多模型协作', { exact: true }).check();
    await modelSettings.getByLabel('Agent 1 名称', { exact: true }).fill('八字分析');
    await modelSettings.getByLabel('Agent 1 分工', { exact: true }).fill('核对天干、日支与生克关系');
    await modelSettings.getByLabel('Agent 1 推理档位', { exact: true }).selectOption('high');
    await modelSettings.getByLabel('Agent 2 名称', { exact: true }).fill('跨术数复核');
    await modelSettings.getByLabel('Agent 2 模型', { exact: true }).selectOption('fixture-review');
    const settingsSaved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/conversations/agent-settings/configuration' && response.request().postDataJSON()?.collaborators?.[1]?.reasoningEffort === 'xhigh');
    await modelSettings.getByLabel('Agent 2 推理档位', { exact: true }).selectOption('xhigh');
    await modelSettings.getByLabel('上下文用量', { exact: true }).click();
    check('Context, reasoning and collaborators share the model dialog', await modelSettings.locator('.agent-context-details[open]').count() === 1 && await modelSettings.getByLabel('推理档位', { exact: true }).inputValue() === 'max');
    await page.keyboard.press('Escape');
    check('Closing the combined settings dialog restores model trigger focus', await settingsTrigger.evaluate(button => button === document.activeElement));
    await until(() => window.fixture.agentChat.state.collaborators[1]?.reasoningEffort === 'xhigh');
    assert.ok((await settingsSaved).ok());
    // Switching away and back reloads the saved whole configuration, rather than sharing a mutable running-task config.
    await selectAgentConversation('agent-settings-other');
    await page.evaluate(() => { window.fixture.agentChat.state.setReasoningEffort('low'); window.fixture.agentChat.state.setCollaborators([]); });
    await selectAgentConversation('agent-settings');
    await until(() => window.fixture.agentChat.state.reasoningEffort === 'max' && window.fixture.agentChat.state.collaborators.length === 2);
    check('Conversation settings restore each collaborator model, effort and focus', await page.evaluate(() => {
      const { collaborators } = window.fixture.agentChat.state;
      return collaborators[0].model === 'fixture-analysis' && collaborators[0].reasoningEffort === 'high' && collaborators[0].focus.includes('日支') && collaborators[1].model === 'fixture-review' && collaborators[1].reasoningEffort === 'xhigh';
    }));
    await page.evaluate(async () => window.fixture.agentChat.messaging.agent.start('agent-byok', {
      id: 'byok-message', role: 'user', content: 'Direct model task', createdAt: '2026-10-10T00:00:00Z',
    }, { model: 'direct-model', reasoning: true, mentions: [], provider: {
      apiUrl: 'https://fixture-direct.invalid/v1', apiKey: 'fixture-only', modelId: 'direct-model',
    } }));
    check('Direct model tasks omit platform collaborators while retaining saved platform settings', await page.evaluate(() => {
      const request = window.fixtureAgentIO.requests.find(item => item.method === 'POST' && item.url === '/api/agent/runs' && item.body.conversationId === 'agent-byok');
      return request.body.customProvider.modelId === 'direct-model' && request.body.collaborators.length === 0 && window.fixture.agentChat.state.collaborators.length === 2;
    }));
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).click();
    await until(() => window.fixture.agentChat.state.collaborators.length === 0 && window.fixture.agentChat.state.reasoningEffort === null);
    check('Account changes clear previous-user collaborator names, focus and reasoning choices', await page.evaluate(() => window.fixture.agentChat.state.collaborators.length === 0 && window.fixture.agentChat.state.reasoningEffort === null));
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).click();
    await selectAgentConversation('agent-settings-other');
    await selectAgentConversation('agent-settings');
    await until(() => window.fixture.agentChat.state.collaborators.length === 2);
    await settingsTrigger.click();
    await modelSettings.locator('.chat-collaboration-settings > summary').click();
    await modelSettings.getByRole('button', { name: '添加 Agent', exact: true }).click();
    await modelSettings.getByRole('button', { name: '添加 Agent', exact: true }).click();
    check('Collaboration supports four independently configurable members and a bounded limit', await modelSettings.locator('fieldset.chat-collaborator').count() === 4 && await modelSettings.getByRole('button', { name: '添加 Agent', exact: true }).isDisabled());
    await modelSettings.getByLabel('启用多模型协作', { exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.fixture.agentChat.state.setReasoningEffort(null));
    await selectAgentConversation('agent-a', 'running');
    await page.getByLabel('Agent fixture draft').fill('supplement for A');
    await sendHeldAgent();
    await selectAgentConversation('agent-b');
    await page.evaluate(() => {
      const state = window.fixture.agentChat.state;
      state.setInputValue('new B draft');
      state.setMentions([{ type: 'bazi_chart', name: 'B reference', preview: 'B', id: '00000000-0000-4000-8000-000000000001' }]);
      state.setAttachmentState({ file: new File(['B'], 'b.txt'), webSearchEnabled: false });
    });
    await renderBarrier();
    await releaseAgent();
    check('Late command receipts cannot append A messages to B or clear B draft, mentions and file', await page.evaluate(() => {
      const state = window.fixture.agentChat.state;
      return state.messages.every(message => !message.id.startsWith('command:')) && state.inputValue === 'new B draft' && state.mentions[0]?.name === 'B reference' && state.attachmentState.file?.name === 'b.txt';
    }));

    await selectAgentConversation('agent-a', 'running');
    await page.getByLabel('Agent fixture draft').fill('old visit A');
    await sendHeldAgent(true);
    await selectAgentConversation('agent-b');
    await selectAgentConversation('agent-a', 'running');
    await page.getByLabel('Agent fixture draft').fill('new visit A');
    await releaseAgent();
    check('A to B to A invalidates the old visit receipt even when the conversation ID matches again', await page.evaluate(() => {
      const state = window.fixture.agentChat.state;
      return state.inputValue === 'new visit A' && !state.messages.some(message => message.content === 'old visit A');
    }));

    await selectAgentConversation('agent-waiting', 'awaiting_input');
    const waitingConnections = await page.evaluate(() => window.fixtureAgentIO.requests.filter(request => request.url.endsWith('/events')).length);
    await page.evaluate(() => {
      const io = window.fixtureAgentIO, current = io.runs['agent-waiting'];
      io.emit({ ...current, status: 'running', cursor: current.cursor + 1, message: { ...current.message, agent: { ...current.message.agent, status: 'running' } } });
    });
    await until(() => window.fixture.agentChat.messaging.agent.run?.status === 'running');
    await page.evaluate(async () => window.fixture.agentChat.state.retryConversationLoad());
    await until(() => !window.fixture.agentChat.messaging.agent.restoring && window.fixture.agentChat.messaging.agent.run?.status === 'running');
    await page.evaluate(() => {
      const io = window.fixtureAgentIO, current = io.runs['agent-waiting'];
      io.emit({ ...current, status: 'cancelled', cursor: current.cursor + 1, message: { ...current.message, agent: { ...current.message.agent, status: 'cancelled' } } });
    });
    await until(() => window.fixture.agentChat.messaging.agent.run?.status === 'cancelled' && !window.fixture.agentChat.messaging.agent.syncing);
    check('Awaiting input keeps observing other-tab resume and cancellation, including a same-conversation reload', await page.evaluate(count =>
      window.fixture.agentChat.messaging.agent.run?.status === 'cancelled' && count > 0, waitingConnections));

    await selectAgentConversation('agent-retry', 'awaiting_input');
    await page.getByLabel('Agent fixture draft').fill('one human reply');
    await page.evaluate(async () => {
      window.fixtureAgentIO.failReceipts = 2;
      window.fixtureAgentIO.resumeOnCommand = true;
      await window.fixture.agentChat.messaging.handleSend();
    });
    await until(() => window.fixture.agentChat.messaging.agent.run?.status === 'running');
    await page.evaluate(async () => window.fixture.agentChat.messaging.handleSend());
    await until(() => window.fixture.agentChat.state.inputValue === '');
    check('Manual retry after both lost receipts and awaiting-to-running transition retains the original reply ID and mode', await page.evaluate(() => {
      const io = window.fixtureAgentIO;
      const attempts = io.requests.filter(request => request.url === '/api/agent/runs/run-agent-retry/messages');
      return attempts.length === 3 && attempts.every(request => JSON.stringify(request.body) === JSON.stringify(attempts[0].body)) &&
        attempts[0].body.mode === 'reply' && Object.values(io.commands).filter(receipt => receipt.run.id === 'run-agent-retry').length === 1;
    }));

    await selectAgentConversation('agent-new-task');
    await page.evaluate(() => { const state = window.fixture.agentChat.state; state.setMentions([]); state.setAttachmentState({ webSearchEnabled: false }); });
    await page.getByLabel('Agent fixture draft').fill('original task');
    await sendHeldAgent();
    await page.evaluate(() => {
      const state = window.fixture.agentChat.state;
      state.setInputValue('next task draft');
      state.setMentions([{ type: 'bazi_chart', name: 'next reference', preview: 'next' }]);
      state.setAttachmentState({ file: new File(['next'], 'next.txt'), webSearchEnabled: false });
    });
    await renderBarrier();
    await releaseAgent();
    check('Successful delayed task creation preserves a newer draft, mention and attachment in the same conversation', await page.evaluate(() => {
      const state = window.fixture.agentChat.state;
      return state.inputValue === 'next task draft' && state.mentions[0]?.name === 'next reference' && state.attachmentState.file?.name === 'next.txt';
    }));

    await selectAgentConversation('agent-account', 'running');
    await page.getByLabel('Agent fixture draft').fill('Alice pending command');
    await sendHeldAgent();
    await page.getByRole('button', { name: 'Fixture Logout', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.user === null);
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button.click());
    await until(() => window.fixture.user === 'alice');
    await selectAgentConversation('agent-account', 'running');
    await page.getByLabel('Agent fixture draft').fill('Alice new session draft');
    await releaseAgent();
    check('Logout and relogin to the same account invalidate old async receipts and draft clearing', await page.evaluate(() =>
      window.fixture.agentChat.state.inputValue === 'Alice new session draft' && !window.fixture.agentChat.state.messages.some(message => message.content === 'Alice pending command')));
    await page.evaluate(() => window.fixture.mount.agent(false));
    await renderBarrier();
    check('Unmount cancels all nonterminal Agent event readers', await page.evaluate(() => window.fixtureAgentIO.streams.every(stream => stream.closed)));


    await until(() => window.fixture.client.isFetching() === 0);
    await renderBarrier();
    // Provider focus refreshes may read bootstrap/settings while these local chart interactions run.
    // Count all writes and other reads so chart loading, recalculation and persistence still fail this check.
    const resultOperations = () => requests.filter(request => !(request.method === 'GET' && ['/api/app/bootstrap', '/api/user/settings'].includes(request.pathname))).length;
    const callsBeforeResults = resultOperations();
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).focus();
    await page.evaluate(() => window.fixture.mount.results(true));
    const results = page.locator('[data-testid="agent-results"]');
    await results.locator('[data-chart-kind="tarot"]').waitFor();
    await results.locator('[data-chart-kind="almanac"]').waitFor();
    check('All eleven real persisted tool results automatically render with the process folded', await results.locator('[data-chart-kind]').count() === 11 && await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') === 'false');
    check('Automatic chart previews do not steal focus', await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button === document.activeElement));
    check('Legacy history with no native measurement does not invent response time', await results.locator('.agent-response-time').count() === 0);
    await page.evaluate(() => window.fixture.agentTiming());
    await results.locator('.agent-response-time').waitFor();
    check('Persisted model response measurements survive a JSON history receipt', await results.locator('.agent-response-time').innerText() === '模型响应 2 秒 · 2 次');
    await results.getByRole('button', { name: /任务过程/ }).click();
    const timedTool = results.locator('.agent-tool-card').filter({ has: page.locator('.agent-tool-time') });
    await timedTool.locator('summary').click();
    check('Tool execution and the wall-clock span remain separately labeled', await timedTool.locator('.agent-tool-time').innerText() === '1.5 秒' && await timedTool.locator('.agent-task-span').innerText() === '执行阶段 5 秒（包含等待和恢复）');
    await results.getByRole('button', { name: /任务过程/ }).click();
    check('Slim Ziwei results render all twelve returned palaces', await results.locator('[data-chart-kind="ziwei"] [role="button"]').count() === 12);
    const baziResult = results.locator('[data-tool-result="bazi"]');
    await baziResult.getByRole('button', { name: '展开命盘', exact: true }).click();
    const chartDialog = page.getByRole('dialog', { name: '八字命盘', exact: true });
    await chartDialog.waitFor();
    check('Expanded chart shows the same persisted four pillars', await chartDialog.innerText().then(text => text.includes('庚辰') && text.includes('己巳')));
    await page.keyboard.press('Escape');
    await chartDialog.waitFor({ state: 'hidden' });
    check('Closing a chart returns focus to its expand button', await baziResult.getByRole('button', { name: '展开命盘', exact: true }).evaluate(button => button === document.activeElement));
    await baziResult.getByRole('button', { name: '固定到工作区', exact: true }).click();
    await page.getByRole('dialog', { name: '任务工作区', exact: true }).waitFor();
    await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').waitFor();
    check('Pinning opens the corresponding real tool result in the workspace', await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').count() === 1);
    check('Workspace counts valid readings once and excludes the incomplete result', await page.locator('#agent-workspace-panel .agent-panel-tabs button').first().innerText() === '命盘11');
    await page.getByRole('button', { name: '关闭任务工作区', exact: true }).click();
    await results.getByRole('button', { name: '恢复已有成果标签', exact: true }).click();
    await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').waitFor();
    check('A restored saved-artifact tab uses the same persisted reading without chart loading or recalculation', resultOperations() === callsBeforeResults && await page.getByRole('tab', { name: '已保存八字', exact: true }).count() === 1);
    await page.getByRole('button', { name: '关闭任务工作区', exact: true }).click();
    await results.locator('[data-tool-result="tarot"]').getByRole('button', { name: '固定到工作区', exact: true }).click();
    check('Workspace supports multiple pinned readings without replacing their data', await page.getByRole('tab', { name: '八字命盘', exact: true }).count() === 1 && await page.locator('#agent-workspace-panel [data-chart-kind="tarot"]').count() === 1);
    await page.getByRole('button', { name: '关闭任务工作区', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 740 });
    await results.locator('[data-tool-result="meihua"]').getByRole('button', { name: '展开命盘', exact: true }).click();
    await page.getByRole('dialog', { name: '梅花卦盘', exact: true }).waitFor();
    check('Mobile expansion keeps the returned hexagrams and moving line', await page.getByRole('dialog', { name: '梅花卦盘', exact: true }).innerText().then(text => text.includes('泽地萃') && text.includes('泽水困') && text.includes('动')));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1200, height: 1000 });
    check('Incomplete chart retains canonical text instead of generating another reading', await results.locator('[data-tool-result="incomplete"]').innerText().then(text => text.includes('命盘数据不完整') && text.includes('规范文本仍可访问')));
    await results.locator('[data-tool-result="bazi"]').getByRole('button', { name: '固定到工作区', exact: true }).click();
    const interactive = page.locator('#agent-workspace-panel');
    await page.evaluate(() => window.fixture.chartFocus('bazi', ['bazi:cell:2:1'], '模型查看日支'));
    await interactive.getByRole('button', { name: '跟随模型', exact: true }).click();
    await interactive.locator('[data-chart-target="bazi:cell:2:1"][aria-pressed=true]').waitFor();
    check('A native chart action highlights the exact day branch', await interactive.locator('.agent-board-focus').innerText().then(text => text.includes('模型查看日支')));
    await interactive.locator('[data-chart-target="bazi:cell:2:0"]').click();
    await page.evaluate(() => window.fixture.chartFocus('bazi', ['bazi:cell:2:1'], '继续查看日支'));
    check('Manual chart exploration pauses model following', await interactive.getByRole('button', { name: '跟随模型', exact: true }).getAttribute('aria-pressed') === 'false' && await interactive.locator('[data-chart-target="bazi:cell:2:0"]').getAttribute('aria-pressed') === 'true');
    await interactive.getByRole('button', { name: '跟随模型', exact: true }).click();
    await interactive.locator('[data-chart-target="bazi:cell:2:1"][aria-pressed=true]').waitFor();
    const relation = interactive.locator('.agent-board-relations button').first();
    await relation.click();
    check('Selecting a bazi relation highlights every returned endpoint', await interactive.locator('.chart-cell-button[aria-pressed=true]').count() >= 2 && await interactive.locator('.agent-board-relation-path').count() === 1);
    await interactive.getByRole('button', { name: '追问当前位置', exact: true }).click();
    check('Chart questions carry the real chart reference into a draft', await page.evaluate(() => window.fixture.chartQuestion.includes('artifact:11111111-1111-4111-8111-111111111111')));
    const starId = await page.evaluate(() => window.fixture.chartTargets('ziwei').find(target => target.kind === 'ziwei_star' && target.group === '主星及四化').id);
    await page.evaluate(id => window.fixture.chartFocus('ziwei', [id], '模型查看紫微星曜'), starId);
    await interactive.getByRole('button', { name: '跟随模型', exact: true }).click();
    const star = interactive.locator('[data-chart-target="' + starId + '"]');
    await star.waitFor();
    check('Ziwei model focus selects the returned palace and its exact star', await star.getAttribute('aria-pressed') === 'true' && await interactive.locator('[data-chart-selected=true]').count() === 1 && await interactive.locator('svg line').count() === 3);
    await interactive.getByRole('checkbox', { name: '三方四正', exact: true }).uncheck();
    check('Ziwei related-palace visibility is an actual chart interaction', await interactive.locator('svg line').count() === 0);
    await star.focus();
    await page.keyboard.press('Enter');
    check('Star selection works from the keyboard without nested palace activation', await star.getAttribute('aria-pressed') === 'true');
    for (const kind of ['qimen', 'liuyao', 'meihua', 'daliuren', 'xiaoliuren', 'tarot', 'taiyi', 'astrology', 'almanac']) {
      const targets = await page.evaluate(kind => window.fixture.chartTargets(kind), kind);
      await page.evaluate(({ kind, id }) => window.fixture.chartFocus(kind, [id], '模型分析' + kind), { kind, id: targets[0].id });
      const following = interactive.getByRole('button', { name: '跟随模型', exact: true });
      if (await following.getAttribute('aria-pressed') !== 'true') await following.click();
      await interactive.locator('[data-chart-kind="' + kind + '"]').waitFor();
      await interactive.locator('[data-chart-target="' + targets[0].id + '"][aria-pressed=true]').waitFor();
      const missing = await interactive.evaluate((panel, targets) => targets.filter(target => ![...panel.querySelectorAll('[data-chart-target]')].some(node => node.dataset.chartTarget === target.id)).map(target => target.id), targets);
      check(kind + ' exposes every returned target in its real chart and follows model focus', missing.length === 0);
      await page.evaluate(({ kind, id }) => window.fixture.chartFocus(kind, [id], '模型定位末项'), { kind, id: targets.at(-1).id });
      await interactive.locator('[data-chart-target="' + targets.at(-1).id + '"][aria-pressed=true]').waitFor();
      await interactive.locator('[data-chart-target="' + targets.at(-1).id + '"]').click();
      await interactive.getByRole('button', { name: '追问当前位置', exact: true }).click();
      check(kind + ' supports manual selection and referenced draft questions', await following.getAttribute('aria-pressed') === 'false' && await page.evaluate(() => window.fixture.chartQuestion.includes('artifact:')));
    }
    await page.evaluate(() => window.fixture.traditionalTaiyi());
    await renderBarrier();
    const traditionalTargets = await page.evaluate(() => window.fixture.chartTargets('taiyi'));
    const traditionalStar = traditionalTargets.find(target => target.id.includes(':palace:') && target.id.includes(':star:'));
    await page.evaluate(id => window.fixture.chartFocus('taiyi', [id], '查看传统太乙星将'), traditionalStar.id);
    await interactive.getByRole('button', { name: '跟随模型', exact: true }).click();
    await interactive.locator('[data-chart-target="' + traditionalStar.id + '"][aria-pressed=true]').waitFor();
    check('Traditional Taiyi keeps its sixteen directions and central palace without inventing a nine-star board', traditionalTargets.filter(target => /^taiyi:palace:\d+$/.test(target.id)).length === 17 && await interactive.locator('[data-chart-kind="taiyi"]').count() === 1);
    await page.evaluate(() => window.fixture.chartFocus('bazi', ['bazi:cell:2:1'], '旧盘焦点', 'bazi_chart:11111111-1111-4111-8111-111111111111'));
    await interactive.locator('[data-chart-target="bazi:cell:2:1"][aria-pressed=true]').waitFor();
    await page.evaluate(() => window.fixture.chartInspect());
    await renderBarrier();
    check('Reinspection clears prior model coordinates and captions before any new focus', await interactive.locator('.agent-board-focus').getAttribute('data-chart-focus') === '' && !(await interactive.locator('.agent-board-focus').innerText()).includes('旧盘焦点'));
    await interactive.locator('[data-chart-target="bazi:cell:2:0"]').click();
    await page.evaluate(() => window.fixture.chartInspect());
    await renderBarrier();
    check('Reinspecting unchanged chart data preserves paused manual exploration', await interactive.locator('[data-chart-target="bazi:cell:2:0"]').getAttribute('aria-pressed') === 'true');
    await page.evaluate(() => window.fixture.chartInspect(true));
    await renderBarrier();
    check('Edited saved chart data invalidates manual coordinates on the same resource tab', await interactive.locator('.agent-board-focus').getAttribute('data-chart-focus') === '' && await interactive.locator('.chart-cell-button[aria-pressed=true]').count() === 0);
    await interactive.getByRole('button', { name: '关闭任务工作区', exact: true }).click();
    await page.evaluate(() => window.fixture.mount.results(false));
    await renderBarrier();
    await page.evaluate(() => window.fixture.mount.results(true));
    await results.locator('[data-chart-kind="tarot"]').waitFor();
    await results.locator('[data-chart-kind="almanac"]').waitFor();
    check('History remount restores all eleven UI readings without new API operations', resultOperations() === callsBeforeResults && await results.locator('[data-chart-kind]').count() === 11);
    await page.evaluate(() => window.fixture.collaborationResults(false));
    const collaboration = results.getByRole('region', { name: '协作分析', exact: true });
    await collaboration.waitFor();
    check('Collaborator models and live progress remain visible when the task process is folded', await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') === 'false' && await collaboration.innerText().then(text => text.includes('分析模型') && text.includes('复核模型') && text.includes('分析中')));
    await page.evaluate(() => window.fixture.collaborationResults(true));
    await collaboration.locator('details').last().locator('summary').click();
    check('Completed collaborator analysis survives JSON history and can be expanded', await collaboration.innerText().then(text => !text.includes('分析中') && text.includes('生克关系复核完成。')) && resultOperations() === callsBeforeResults);
    await page.evaluate(() => window.fixture.mount.results(false));

    check('No unhandled network requests escaped fixtures', blocked.length === 0);
    check('No browser runtime exceptions', browserErrors.length === 0);
    check('Disabled Query observers emit no missing queryFn warnings, including visitor', queryWarnings.length === 0);
    return { checks, requests, blocked, browserErrors, queryWarnings, scope: 'P5 browser-component integration only; synthetic identity/API/model fixtures; no Next/Auth/PostgREST acceptance' };
  } catch (error) {
    throw new Error(JSON.stringify({ message: error.message, checks, blocked, browserErrors, requests, pageText: await page.locator('body').innerText().catch(() => '') }, null, 2), { cause: error });
  } finally {
    releaseList?.(); releaseRename?.();
    for (const control of controls) control.release?.();
    await context.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const useInstalledChrome = args[0] === '--chrome';
  if (useInstalledChrome && args.length !== 1) throw new Error('--chrome does not accept output or module arguments.');
  const explicitOutput = useInstalledChrome ? undefined : args[0];
  const output = explicitOutput ? resolve(explicitOutput) : await mkdtemp(resolve(tmpdir(), 'taibu-browser-'));
  try {
    const artifacts = await build(output);
    const playwrightModule = useInstalledChrome ? undefined : args[1];
    if (explicitOutput && !playwrightModule) {
      console.log(artifacts);
    } else {
      const { chromium } = await import(playwrightModule ? pathToFileURL(resolve(playwrightModule)).href : 'playwright');
      const browser = await chromium.launch({ headless: true, ...(useInstalledChrome || playwrightModule ? { channel: 'chrome' } : {}) });
      try {
        const result = await run(await browser.newPage(), artifacts.bundle);
        console.log(`[browser] ${result.checks.length} checks passed; ${result.requests.length} fixture requests; no external requests or runtime exceptions.`);
        for (const check of result.checks) console.log(`  PASS ${check}`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    if (!explicitOutput) await rm(output, { recursive: true, force: true });
  }
}
