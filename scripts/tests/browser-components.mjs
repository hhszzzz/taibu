/**
 * Browser component acceptance with synthetic API and model fixtures.
 * Run: pnpm test:browser (uses the pinned Playwright Chromium runtime).
 * Build only: node scripts/tests/browser-components.mjs /tmp/taibu-browser
 * Build + run with an already-installed Playwright module (never installs):
 *   node scripts/tests/browser-components.mjs /tmp/taibu-browser /absolute/path/to/playwright/index.mjs
 * Or pass generated acceptance.playwright.js as MCP browser_run_code_unsafe.filename.
 * Programmatic use with an existing Playwright page:
 *   const { run } = await import('file:///absolute/repo/scripts/tests/browser-components.mjs');
 *   return run(page, '/tmp/taibu-browser/fixture.js');
 *
 * Actual components: SettingsCenterPage/SettingsCenterHost/GeneralSettingsPanel/ChartsPanel/SharedLinksPanel, ShareConversationMenu, AIModelPanel,
 * AnnouncementManagementPanel, KeyManagementPanel, AgentTaskPanel, ConversationListProvider, ChartPickerModal,
 * useSelectedBaziChart, useComposerState, HistoryDrawer/HistoryPageTemplate, RecordsPage and useAnalysisSnapshot.
 * Actual root ClientProviders owns the shared Query client and handles synthetic auth I/O.
 * Fixture-only boundaries: auth I/O/profile/feature flags, unrelated lazy panels,
 * framework navigation, viewport notifications, held fetch/JSON completion and HTTP responses.
 * Unused Node-only random-calculation crypto fails closed; real Bazi projections are bundled.
 * Next routing, live authentication, paid models and CSS/layout are outside this fixture's scope.
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
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { AgentTaskPanel } from '@/components/admin/AgentTaskPanel';
import { ConversationListProvider, useConversationList } from '@/lib/chat/ConversationListContext';
import { useChatState } from '@/lib/chat/use-chat-state';
import { useChatMessaging } from '@/lib/chat/use-chat-messaging';
import { ChatStreamManager } from '@/lib/chat/chat-stream-manager';
import { ChartPickerModal } from '@/components/common/ChartPickerModal';
import { useComposerState } from '@/components/chat/composer/useComposerState';
import { HistoryDrawer } from '@/components/layout/HistoryDrawer';
import { HistoryPageTemplate } from '@/components/history/HistoryPageTemplate';
import RecordsPage from '@/app/records/page';
import TarotResultPage from '@/app/tarot/result/page';
import QimenResultPage from '@/app/qimen/result/page';
import AnnualReportPage from '@/app/user/annual-report/page';
import CommunityPage from '@/app/community/page';
import PostDetailPage from '@/app/community/[postId]/page';
import MeihuaResultPage from '@/app/meihua/result/page';
import XiaoliurenResultPage from '@/app/xiaoliuren/result/page';
import DaliurenResultPage from '@/app/daliuren/result/page';
import LiuyaoResultPage from '@/app/liuyao/result/page';
import { calculateMeihuaBundle } from '@/lib/divination/meihua';
import { calculateXiaoliurenBundle } from '@/lib/divination/xiaoliuren';
import { findHexagram } from '@/lib/divination/liuyao';
import { HeaderMenuProvider } from '@/components/layout/HeaderMenuContext';
import { TAROT_CARDS, TAROT_SPREADS, createTarotDrawSession } from '@/lib/divination/tarot';
import { useAgentActivity, refreshAgentActivity } from '@/lib/agent/use-agent-activity';
import * as chartClient from '@/lib/user/charts-client';
import { useSelectedBaziChart } from '@/lib/hooks/useUserCharts';
import { TimeInputModal } from '@/components/bazi/form/TimeInputModal';
import { AgentQuestionDock } from '@/components/chat/agent/AgentQuestionDock';
import { AgentMessage } from '@/components/chat/AgentMessage';
import { AgentWorkspacePanel } from '@/components/chat/agent/AgentWorkspacePanel';
import { SessionDetailsPanel } from '@/components/chat/agent/SessionDetailsPanel';
import { AgentResultContext } from '@/components/chat/agent/AgentResultContext';
import { ChatRecordViewContext } from '@/lib/chat/chat-record-view';
import { ComposerStatusBar } from '@/components/chat/composer/ComposerStatusBar';
import { getAgentChart } from '@/lib/agent/tool-presentation';
import { getChartTargets, getDrilldownTargets } from '@/lib/agent/chart-interaction';
import { getAgentEvidence } from '@/lib/agent/evidence';
import { agentMessageContent } from '@/lib/agent/types';
import { getAgentCitedParagraph } from '@/components/chat/agent/presentation';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileChatDrawer } from '@/components/chat/MobileChatDrawer';
import { FloatingPanel } from '@/components/ui/FloatingPanel';
import { setChatWorkspaceOpen } from '@/lib/chat/chat-sidebar';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { VirtualizedChatMessageList } from '@/components/chat/VirtualizedChatMessageList';
import { useTranscriptScroll } from '@/lib/chat/use-transcript-scroll';
import { scrollToMessageId } from '@/lib/chat/message-navigation';
import { ShareConversationMenu } from '@/components/chat/ShareConversationMenu';
const initialToolParts = AGENT_TOOL_FIXTURE_PARTS;
const BAZI_DRILLDOWN_FIXTURE_PARTS = BAZI_DRILLDOWN_FIXTURE_PARTS_JSON;
const familyParts = () => [
  AGENT_DAYUN_FIXTURE_PART,
  HEPAN_FIXTURE_PART,
  ALMANAC_CLASH_FIXTURE_PART,
  HOUR_CANDIDATES_FIXTURE_PART,
  { type: 'tool', id: 'family-web', name: 'web_search', title: '联网检索', status: 'completed', input: { query: '庚金 月令' }, output: [{ title: '庚金论', url: 'https://example.com/gengjin', content: '庚金带煞，刚健为最。' }, { title: '无效链接', url: 'javascript:alert(1)', content: '不应成为链接' }] },
  { type: 'tool', id: 'family-kb', name: 'search_knowledge', title: '知识库检索', status: 'completed', input: { query: '不存在的资料' }, output: [] },
  { type: 'tool', id: 'family-method', name: 'load_analysis_method', title: '加载分析方法', status: 'completed', input: { id: 'bazi' },
    output: { ...BAZI_METHOD_FIXTURE, tools: ['bazi', 'bazi_dayun'] } },
  { type: 'tool', id: 'family-team', name: 'parallel_analysis', title: '协作分析', status: 'completed', output: { analyses: [
    { system: 'bazi', conversationId: 21, name: '子平', modelName: '分析模型', reasoningEffort: 'high', focus: '格局取用', status: 'completed', answer: '身强取财官。' },
    { system: 'bazi', conversationId: 22, name: '盲派', modelName: '复核模型', reasoningEffort: 'off', status: 'completed', answer: '做功看财星。' },
  ] } },
  { type: 'tool', id: 'family-memory', name: 'remember_user_fact', title: '记住偏好', status: 'completed', output: { id: '33333333-3333-4333-8333-333333333333', title: '历法偏好', content: '以后都用公历时间', kind: 'preference', updated_at: '2026-10-10T00:00:00Z' } },
  { type: 'tool', id: 'family-external', name: 'mcp__archive__lookup', title: '档案检索', status: 'completed', input: { keyword: '庚金' }, output: { rows: 1 } },
  // The user's archive: notes and earlier conversations read, an event recorded from their words, a conclusion to save.
  { type: 'tool', id: 'family-notes', name: 'read_user_notes', title: '读取每日笔记', status: 'completed', input: { since: '2026-10-01' },
    output: { notes: [{ date: '2026-10-02', mood: '开心', content: '面试顺利，下周入职。' }], more: true } },
  { type: 'tool', id: 'family-history', name: 'search_conversations', title: '检索以往对话', status: 'completed', input: { query: '跳槽' },
    output: [{ conversationId: 'conversation-earlier', messageId: 'earlier-question', title: '跳槽的事', updatedAt: '2026-09-01T08:00:00Z', role: 'user', excerpt: '2024年我跳槽去了上海，前途如何？', reply: '从流年看，这次跳槽顺利。', question: null }] },
  { type: 'tool', id: 'family-record', name: 'record_user_event', title: '记入档案', status: 'completed', input: { date: '2024-03', category: '事业', title: '换到新公司', evidence: '2024年3月从老东家离职' },
    output: { target: 'record', id: '44444444-4444-4444-8444-444444444444', event: { date: '2024-03-01', category: '事业', title: '换到新公司', detail: '2024年3月从老东家离职', chart: null } } },
  { type: 'tool', id: 'family-propose', name: 'propose_archive_entry', title: '生成保存卡片', status: 'completed', input: { kind: 'conclusion', title: '明年换岗' },
    output: { runId: 'run-family', callId: 'family-propose', proposal: { kind: 'conclusion', category: 'prediction', title: '明年换岗', content: '官星透出，宜在下半年调整岗位。', date: '2027-06-01', tags: ['事业'], chart: null } } },
  { type: 'tool', id: 'family-tool-search', name: 'tool_search', title: '查找工具', status: 'completed', input: { query: '六爻动爻 择日' },
    output: { loaded: ['liuyao_line', 'almanac_select'], labels: ['六爻逐爻详查', '黄历择日筛选'] } },
  { type: 'reasoning', id: 'family-think', text: '先看命盘，再核对流年；出生时间不确定时先问清楚。' },
  { type: 'tool', id: 'family-ask', name: 'ask_user', title: '补充必要信息', status: 'completed', input: {},
    output: { question: '出生时间？', questions: [{ id: 'birth', question: '出生时间？', options: [{ id: 'morning', label: '早上' }, { id: 'night', label: '晚上' }], allowCustom: true, allowSkip: false }], awaitingUser: true } },
  { type: 'question', id: '9:family-ask', question: '出生时间？' },
];
const fixtureArtifacts = [{ type: 'artifact', id: 'bazi', title: '已保存八字', chartType: 'bazi', chartId: 'saved-bazi' }];
import { useAnalysisSnapshot } from '@/lib/hooks/useAnalysisSnapshot';
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
  const [shown, setShown] = useState(null);
  const [bare, setBare] = useState(false);
  window.fixture.resultsWithoutWorkspace = setBare;
  // ChatLayout 通过 context 下发对话记录视图；夹具直接切换普通 / 详细。
  const [recordView, setRecordView] = useState('normal');
  window.fixture.recordView = setRecordView;
  const [parts, setParts] = useState(initialToolParts);
  const [runtime, setRuntime] = useState(undefined);
  const [answers, setAnswers] = useState(() => new Map());
  const [status, setStatus] = useState('completed');
  const { user } = useSessionSafe();
  window.fixture.agentRunStatus = setStatus;
  window.fixture.workspaceFamilies = () => setParts(previous => [...previous.filter(part => !part.id.includes('family')), ...familyParts()]);
  window.fixture.workspaceStep = (name, status) => setParts(previous => [...previous, { type: 'tool', id: 'step-' + (window.fixture.stepRevision = (window.fixture.stepRevision ?? 0) + 1), name, title: name, status, input: { query: '流年' } }]);
  window.fixture.answerFamilyQuestion = () => setAnswers(new Map([['9:family-ask', { content: '出生时间？\n早上', answers: { birth: ['morning'] } }]]));
  // 旧消息里检索结果还带独立的 source parts；界面现在把它们列在调用框里，不再在正文下另起一段。
  window.fixture.searchSource = (on = true) => setParts(previous => [...previous.filter(part => part.id !== 'family-web:0'),
    ...(on ? [{ type: 'source', id: 'family-web:0', title: '庚金论', url: 'https://example.com/gengjin' }] : [])]);
  // 计划模式：先要求修改、再批准；两次提交与决定都留在计划页。
  window.fixture.planStep = () => setParts(previous => [...previous,
    { type: 'tool', id: 'native-tool:12:plan-1', name: 'submit_plan', title: '提交计划', status: 'completed',
      input: { plan: '## 分析计划\n1. 先排八字。' }, output: { plan: '## 分析计划\n1. 先排八字。', approved: false, feedback: '加上紫微一起看' } },
    { type: 'tool', id: 'native-tool:12:plan-2', name: 'submit_plan', title: '提交计划', status: 'completed',
      input: { plan: '## 分析计划\n1. 先排八字，再看紫微。' }, output: { plan: '## 分析计划\n1. 先排八字，再看紫微。', approved: true } },
  ]);
  window.fixture.codemodeScript = () => setParts(previous => {
    const bazi = initialToolParts.find(part => part.name === 'bazi');
    const script = { type: 'tool', id: 'native-tool:9:script', name: 'codemode', title: '运行脚本', status: 'completed', input: { code: 'for (const birthYear of [1990, 1991]) await tools.bazi({ birthYear });' },
      output: { calls: [{ id: 1, name: 'bazi', args: '{"birthYear":1990}', status: 'ok' }, { id: 2, name: 'bazi', args: '{"birthYear":1991}', status: 'ok' },
        { id: 3, name: 'bazi', args: '{}', status: 'error', error: 'Tool call blocked: 单个脚本最多发起 30 次调用' }], output: '1990: 己巳\n1991: 庚午' } };
    const calls = [1, 2].map(number => ({ ...bazi, id: 'nested:' + (20 + number), parentId: script.id, scriptCall: number }));
    return [...previous.filter(part => part.id !== script.id && !part.id.startsWith('nested:')), script, ...calls];
  });
  const data = { version: 1, runId: 'ui-results', status, parts, runtime };
  window.fixture.agentTiming = () => {
    // The durable runtime always records the model beside its response measurements.
    setRuntime(JSON.parse(JSON.stringify({ model: { id: 'fixture-model', name: '主模型', contextWindow: null, limitSource: 'unknown' }, responses: [{ id: 'reply-1', durationMs: 1500 }, { id: 'reply-2', durationMs: 500 }] })));
    setParts(previous => JSON.parse(JSON.stringify(previous.map(tool => tool.id === initialToolParts.find(part => part.name === 'bazi').id ? { ...tool, durationMs: 1500, startedAt: 1000, endedAt: 6000 } : tool))));
  };
  window.fixture.collaborationResults = completed => setParts(previous => [...previous.filter(part => part.id !== 'collaboration'), {
    ...initialToolParts[0], id: 'collaboration', name: 'parallel_analysis', title: '协作分析', status: completed ? 'completed' : 'running',
    output: JSON.parse(JSON.stringify({ title: '两派会诊', topics: [{ title: '是否变动', options: ['先争取权责', '主动变动'] }, { title: '命局主线' }], analyses: [
      { system: 'bazi', conversationId: 10, name: '八字分析', modelName: '分析模型', reasoningEffort: 'high', status: 'completed', answer: '已核对天干与日支。', positions: { 是否变动: '先争取权责', 命局主线: '正官制身' }, toolCalls: 3, durationMs: 41000 },
      { system: 'bazi', conversationId: 11, name: '独立复核', modelName: '复核模型', reasoningEffort: 'off', status: completed ? 'completed' : 'running',
        ...(completed ? { answer: '生克关系复核完成。成果 ID: 22222222-2222-4222-8222-222222222222', positions: { 是否变动: '主动变动' }, steps: [
          { name: 'bazi', title: '八字排盘', status: 'completed', note: '先排盘，再逐条复核生克。', input: '{"birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9}', output: '# 八字命盘\n- 日主: 庚' },
          { name: 'bazi_wuxing', title: '八字五行旺衰', status: 'completed', output: '# 八字五行旺衰详查', truncated: true },
        ] } : { steps: [{ name: 'bazi', title: '八字排盘', status: 'completed' }, { name: 'read_user_data', title: '读取官禄宫', status: 'running' }] }) },
    ] })),
  }]);
  // A background subagent working on, then answering, the message the main agent sent it; null takes it away again.
  window.fixture.backgroundResults = completed => {
    setRuntime(completed === null ? undefined : JSON.parse(JSON.stringify({ model: { id: 'fixture-model', name: '主模型', contextWindow: null, limitSource: 'unknown' }, activity: { phase: completed ? 'responding' : 'background' } })));
    setParts(previous => [...previous.filter(part => part.id !== 'background'), ...(completed === null ? [] : [{
      type: 'tool', id: 'background', name: 'background_agent', title: '后台子分析', status: completed ? 'completed' : 'running',
      input: { action: 'spawn', name: '八字复核', system: 'bazi', message: '请排盘并看 2027 年事业。' },
      output: JSON.parse(JSON.stringify({ action: 'spawn', name: '八字复核', system: 'bazi', conversationId: 21, reporterId: 7, analyses: [
        { system: 'bazi', conversationId: 21, name: '八字复核', status: completed ? 'completed' : 'running',
          ...(completed ? { answer: '2027 年事业有变动。', toolCalls: 1, durationMs: 9000,
            steps: [{ name: 'bazi', title: '八字排盘', status: 'completed', input: JSON.stringify({ gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 }),
              output: '# 八字命盘\n\n## 基本信息\n- 日主：庚金\n- 生肖：蛇', truncated: true }] }
            : { steps: [{ name: 'bazi', title: '八字排盘', status: 'running' }] }) },
      ] })),
    }])]);
  };
  // An answer citing the two passages its own search returned, numbered after the evidence already shown.
  window.fixture.citedAnswer = () => setParts(previous => {
    const rest = previous.filter(part => !part.id.startsWith('cited-'));
    const base = getAgentEvidence(rest).at(-1)?.n ?? 0;
    window.fixture.cited = [base + 1, base + 2];
    return [...rest,
      { type: 'tool', id: 'cited-kb', name: 'search_knowledge', title: '知识库检索', status: 'completed', input: { query: '庚金 刚健' }, output: [
        { content: '# 《滴天髓》天干论 · 庚金\n庚金带煞，刚健为最。', method: 'fts', cite: base + 1, metadata: { category: '命理古籍' } },
        { content: '# 《子平真诠》论用神\n八字用神，专求月令。', method: 'vector', cite: base + 2, metadata: { category: '命理古籍' } },
      ] },
      { type: 'text', id: 'cited-answer', text: '古籍说庚金刚健[' + (base + 1) + ']。\n\n用神专求月令[' + (base + 2) + ']，[' + (base + 9) + '] 不是本任务的依据。' }];
  });
  window.fixture.chartTool = kind => parts.find(tool => tool.name === kind).output.result;
  window.fixture.chartTargets = kind => getChartTargets(getAgentChart(parts.find(tool => tool.name === kind)));
  window.fixture.chartFocus = (kind, ids, caption, savedReference) => {
    const original = parts.find(tool => tool.name === kind);
    const source = { bazi: 'bazi_chart', ziwei: 'ziwei_chart', qimen: 'qimen_chart', liuyao: 'liuyao_divination', meihua: 'meihua_divination', daliuren: 'daliuren_divination', xiaoliuren: 'xiaoliuren_divination', tarot: 'tarot_reading' }[kind];
    const reference = savedReference ?? (source ? source : 'artifact') + ':' + (kind === 'bazi' ? '11111111-1111-4111-8111-111111111111' : kind === 'ziwei' ? '22222222-2222-4222-8222-222222222222' : String(initialToolParts.indexOf(initialToolParts.find(tool => tool.name === kind)) + 1).padStart(8, '0') + '-1111-4111-8111-111111111111');
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
  // Real Core relation and wuxing drilldowns of the fixture bazi, attached to the chart it was inspected as.
  window.fixture.baziDrilldownResult = name => BAZI_DRILLDOWN_FIXTURE_PARTS.find(tool => tool.name === name).output.result;
  window.fixture.baziDrilldownRunning = () => setParts(previous => [...previous, { type: 'tool', id: 'drill-running', name: 'bazi_relations', title: '八字岁运刑冲合害', status: 'running', input: { reference: 'bazi_chart:11111111-1111-4111-8111-111111111111' } }]);
  // 详查的 targets 由真实入口计算，夹具不手写空数组：盘面随详查点亮字块与关系线。
  window.fixture.baziDrilldowns = (on = true) => setParts(previous => {
    const value = getAgentChart(previous.find(tool => tool.name === 'bazi'));
    const parts = BAZI_DRILLDOWN_FIXTURE_PARTS.map(part => value
      ? { ...part, output: { ...part.output, targets: getDrilldownTargets(value, part.output.result).map(({ id, label }) => ({ id, label })) } }
      : part);
    return [...previous.filter(tool => !tool.id.startsWith('drill-')), ...(on ? parts : [])];
  });
  window.fixture.traditionalTaiyi = () => setParts(previous => previous.filter(tool => tool.id !== 'inspect-taiyi').map(tool => tool.name === 'taiyi' ? TRADITIONAL_TAIYI_FIXTURE_PART : tool));
  // Without a provider the message is what a reader sees outside the chat workspace.
  if (bare) return <section data-testid="agent-results"><AgentMessage data={data} /></section>;
  return <section data-testid="agent-results"><ChatRecordViewContext.Provider value={recordView}><AgentResultContext.Provider value={{ openResource(id) { setRequest(previous => ({ id, version: (previous?.version ?? 0) + 1 })); setOpen(true); }, shown: open ? shown : null }}>
    <AgentMessage data={data} />
    <button onClick={() => { setRequest(previous => ({ id: 'chart:bazi', version: (previous?.version ?? 0) + 1 })); setOpen(true); }}>恢复已有成果标签</button>
    {open && <AgentWorkspacePanel workspaceKey={(user?.id ?? 'visitor') + ':ui-fixture'} artifacts={fixtureArtifacts} parts={parts} attachmentIds={[]} data={data}
      answers={answers} userId={user?.id ?? null} requestedResource={request} onShownChange={setShown} onChartQuestion={ask => { window.fixture.chartQuestion = ask; }} onClose={() => setOpen(false)}
      citedParagraph={cite => getAgentCitedParagraph([{ agent: data, content: agentMessageContent(parts) }], cite)} />}
  </AgentResultContext.Provider></ChatRecordViewContext.Provider>
    {/* 右栏结构探针：隐藏渲染，只用于断言「固定宽度、无拖拽手柄」。 */}
    <div hidden data-testid="session-rail-probe"><SessionDetailsPanel data={data} /></div>
  </section>;
}

// A menu with an item hidden at this width, as the + menu's web switch is above phone widths.
function MenuProbe() {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  return <section data-testid="menu-probe">
    <button ref={anchorRef} type="button" onClick={() => setOpen(true)}>Open fixture menu</button>
    <FloatingPanel open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} label="Fixture menu">
      <button type="button" role="menuitem">Visible first</button>
      <button type="button" role="menuitemcheckbox" aria-checked="true" style={{ display: 'none' }}>Hidden checked</button>
      <button type="button" role="menuitem">Visible last</button>
      <button type="button" role="menuitem" onClick={() => { window.fixture.menuShortcut = 'rename'; setOpen(false); }}>Rename<kbd>R</kbd></button>
    </FloatingPanel>
  </section>;
}

// Header share menu for one saved conversation; a running task locks link writes.
function ShareProbe() {
  const anchorRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState('share-fixture');
  window.fixture.shareBusy = setBusy;
  window.fixture.shareConversation = setConversationId;
  return <section data-testid="share-probe">
    <button ref={anchorRef} type="button">Share fixture anchor</button>
    <FloatingPanel open anchorRef={anchorRef} onClose={() => {}} label="分享">
      <ShareConversationMenu conversationId={conversationId} taskActive={busy} exportBusy={null} onExport={format => { window.fixture.shareExport = format; }} onClose={() => {}} />
    </FloatingPanel>
  </section>;
}

function ActivityProbe({ id }) {
  const { user } = useSessionSafe();
  const markers = useAgentActivity(user?.id ?? null, '11111111-1111-4111-8111-111111111111');
  return <output data-testid={'activity-' + id}>{markers.size}</output>;
}

// Two Agent rounds as the transcript shows them: both stay in place.
const ROUND_START = '2026-10-12T08:00:00.000Z';
const roundAsk = (id, content) => ({ id, role: 'user', content, createdAt: ROUND_START });
const roundReply = (id, runId, parts) => ({ id, role: 'assistant', content: '', createdAt: ROUND_START, agent: { version: 1, runId, status: 'completed', parts } });
const ROUND_MESSAGES = [
  roundAsk('round-u1', '明年适合换工作吗？'),
  roundReply('round-a1', 'round-run-1', [
    { type: 'tool', id: 'round-chart', name: 'bazi', title: '八字排盘', status: 'completed', endedAt: Date.parse(ROUND_START) + 60000 },
    { type: 'tool', id: 'round-luck', name: 'bazi_dayun', title: '八字大运', status: 'completed', endedAt: Date.parse(ROUND_START) + 106000 },
    { type: 'artifact', id: 'round-result', title: '已保存八字', chartType: 'bazi', chartId: 'saved-bazi' },
    { type: 'text', id: 'round-answer-1', text: '2027 丁未年适合变动。' },
  ]),
  roundAsk('round-u2', '你说正官克身是主线，古籍里是怎么讲的？'),
  roundReply('round-a2', 'round-run-2', [{ type: 'text', id: 'round-answer-2', text: Array.from({ length: 40 }, (_, line) => '古籍对庚金的总论，第 ' + (line + 1) + ' 段。').join('\n\n') }]),
];
function RoundsProbe() {
  const scrollRef = useRef(null);
  const followRef = useRef(true);
  const endRef = useRef(null);
  const [messages, setMessages] = useState(ROUND_MESSAGES);
  const [virtual, setVirtual] = useState(false);
  window.fixture.rounds = { setVirtual, append: message => setMessages(current => current.concat([message])), locate: id => scrollToMessageId('rounds-fixture', id) };
  useTranscriptScroll({ scrollRef, followRef, conversationKey: 'rounds-fixture', messages, enabled: true, virtualized: virtual });
  // The app's layout CSS is not loaded here; the transcript needs a bounded scroller.
  return <section data-testid="rounds"><style>{'[data-testid=rounds] .chat-virtual-scroller, [data-testid=rounds] [data-scroller] { height: 360px; overflow: auto; }'}</style>
    {virtual ? <VirtualizedChatMessageList scrollContainerRef={scrollRef} messages={messages} isLoading={false} />
      : <div ref={scrollRef} data-scroller="true"><ChatMessageList messages={messages} isLoading={false} messagesEndRef={endRef} /></div>}
  </section>;
}

// Chat polish (1.A): inline edit box keys, fork guard, code block header and link targets on real ChatMessageList.
const POLISH_MESSAGES = [
  { id: 'polish-u1', role: 'user', content: '第一问', createdAt: ROUND_START },
  { id: 'polish-a1', role: 'assistant', content: '见 [外链](https://example.com/a) 与 [站内](/records)。\n\n\`\`\`ts\nconst answer = 42;\n\`\`\`', createdAt: ROUND_START,
    metadata: { sources: [], webSearch: { status: 'ok', sources: [
      { title: '  黄历\n说明  ', url: 'https://example.com/almanac' },
      { title: '重复', url: 'https://example.com/almanac' },
      { title: '脚本', url: 'javascript:alert(1)' },
      { title: '', url: 'http://example.org/x' },
    ] } } },
  { id: 'polish-u2', role: 'user', content: '第二问', createdAt: ROUND_START },
  { id: 'polish-a2', role: 'assistant', content: '抱歉，服务暂时不可用。', createdAt: ROUND_START, metadata: { unsaved: true, webSearch: { status: 'failed', sources: [] } } },
];
function PolishProbe() {
  const endRef = useRef(null);
  const [disabled, setDisabled] = useState(false);
  window.fixture.polish = { edits: [], setDisabled };
  return <section data-testid="polish"><ChatMessageList messages={POLISH_MESSAGES} isLoading={false} messagesEndRef={endRef} disabled={disabled}
    onEditMessage={async (id, content) => { window.fixture.polish.edits.push([id, content]); }} onRegenerateResponse={() => {}} /></section>;
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
  const [collapsed, setCollapsed] = useState(false);
  return <AgentQuestionDock question="选择分析范围" questionId="same-tool-call" scopeKey={(user?.id ?? '') + ':structured'} collapsed={collapsed} onCollapsedChange={setCollapsed}
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
  const messaging = useChatMessaging({ state, userId: user?.id ?? null, user,
    refreshViewerState: async () => {}, markViewerCreditsExhausted() {}, showToast: (...args) => { window.fixture.agentToasts.push(args); }, router, searchParams });
  const [planMode, setPlanMode] = useState(false);
  const [codeMode, setCodeMode] = useState(false);
  window.fixture.agentChat = { state, messaging, planMode, codeMode };
  return <section data-testid="agent-chat"><input aria-label="Agent fixture draft" value={state.inputValue} onChange={event => state.setInputValue(event.target.value)} />
    <ComposerStatusBar agentMode disabled={false} userId={user?.id} membershipType="plus"
      selectedModel={state.selectedModel} onModelChange={state.setSelectedModel} reasoningEnabled={state.reasoningEnabled} onReasoningChange={state.setReasoningEnabled}
      reasoningEffort={state.reasoningEffort} onReasoningEffortChange={state.setReasoningEffort} collaborators={state.collaborators} onCollaboratorsChange={state.setCollaborators}
      planMode={planMode} onPlanModeChange={setPlanMode} codeMode={codeMode} onCodeModeChange={setCodeMode}
      usage={{ credits: 20, membershipType: 'plus' }} customProviderActive={false} customProviderLabel={null} />
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
  const [sidebarMounted, setSidebarMounted] = useState(false);
  const [phoneDrawerMounted, setPhoneDrawerMounted] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [shareMounted, setShareMounted] = useState(false);
  const [roundsMounted, setRoundsMounted] = useState(false);
  const [polishMounted, setPolishMounted] = useState(false);
  const [snapshotMounted, setSnapshotMounted] = useState(false);
  const [tarotMounted, setTarotMounted] = useState(false);
  const [qimenMounted, setQimenMounted] = useState(false);
  const [activityMounted, setActivityMounted] = useState(false);
  const [annualMounted, setAnnualMounted] = useState(false);
  const [communityMounted, setCommunityMounted] = useState(false);
  const [postMounted, setPostMounted] = useState(false);
  const [castMounted, setCastMounted] = useState(null);
  window.fixture.refreshActivity = refreshAgentActivity;
  window.fixture.seedTarot = () => sessionStorage.setItem('tarot_result', JSON.stringify({
    ...createTarotDrawSession({ spread: TAROT_SPREADS[0], cards: [{ card: TAROT_CARDS[0], orientation: 'upright' }], seed: 'review' }, { question: 'review', birthDate: '' }, '2026-10-23T00:00:00Z'), recordOwnerId: user?.id ?? null,
  }));
  window.fixture.seedQimen = () => sessionStorage.setItem('qimen_result', JSON.stringify({
    year: 2024, month: 6, day: 1, hour: 12, minute: 0, timezone: 'Asia/Shanghai', panType: 'zhuan', juMethod: 'chaibu', zhiFuJiGong: 'jiLiuYi',
    output: QIMEN_RESULT_FIXTURE, createdAt: '2026-10-23T00:00:00Z', chartId: 'alice-qimen', recordOwnerId: 'alice',
  }));
  window.fixture.chatWorkspace = setChatWorkspaceOpen;
  window.fixture.seedCast = name => {
    const owner = { recordOwnerId: 'alice' };
    if (name === 'meihua') sessionStorage.setItem('meihua_result', JSON.stringify({ ...owner, resultData: calculateMeihuaBundle({ method: 'time', date: '2026-10-23T12:00:00', timezone: 'Asia/Shanghai', question: 'review' }) }));
    if (name === 'xiaoliuren') sessionStorage.setItem('xiaoliuren_result', JSON.stringify({ ...owner, resultData: calculateXiaoliurenBundle({ date: '2026-10-23T12:00:00', question: 'review' }) }));
    if (name === 'daliuren') sessionStorage.setItem('daliuren_params', JSON.stringify({ ...owner, date: '2026-10-23', hour: 12, timezone: 'Asia/Shanghai' }));
    if (name === 'liuyao') sessionStorage.setItem('liuyao_result', JSON.stringify({ ...owner, divinationId: 'alice-liuyao', conversationId: 'alice-liuyao-conversation',
      question: 'review', yongShenTargets: ['兄弟'], yaos: Array.from({ length: 6 }, (_, index) => ({ type: 1, change: 'stable', position: index + 1 })),
      hexagram: findHexagram('111111'), changedLines: [], createdAt: '2026-10-23T12:00:00+08:00' }));
  };
  window.fixture.daliurenResult = DALIUREN_RESULT_FIXTURE;
  const [modelMountKey, setModelMountKey] = useState(0);
  window.fixture.remountModels = () => setModelMountKey(current => current + 1);
  window.fixture.mount = { composer: setComposerMounted, history: setHistoryMounted, drawer: setDrawerMounted,
    records: setRecordsMounted, picker: setPickerOpen, selected: setSelectedMounted, agent: setAgentMounted, question: setQuestionMounted, results: setResultsMounted, sidebar: setSidebarMounted, phoneDrawer: setPhoneDrawerMounted, menu: setMenuMounted, rounds: setRoundsMounted, polish: setPolishMounted,
    snapshot: setSnapshotMounted, share: setShareMounted, tarot: setTarotMounted, qimen: setQimenMounted, activity: setActivityMounted,
    annual: setAnnualMounted, community: setCommunityMounted, post: setPostMounted, cast: setCastMounted };
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
      <button onClick={() => navigate('/agent-tasks')}>Fixture Agent tasks route</button>
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
    {route === '/agent-tasks' && <section data-testid="agent-tasks"><AgentTaskPanel /></section>}
    {composerMounted && <ComposerProbe />}
    {selectedMounted && <SelectedChartProbe />}
    {agentMounted && <AgentChatProbe />}
    {questionMounted && <StructuredQuestionProbe />}
    {resultsMounted && <AgentResultsProbe />}
    {sidebarMounted && <Sidebar />}
    {phoneDrawerMounted && <MobileChatDrawer />}
    {menuMounted && <MenuProbe />}
    {shareMounted && <ShareProbe />}
    {roundsMounted && <RoundsProbe />}
    {polishMounted && <PolishProbe />}
    {historyMounted && <section data-testid="history-page"><HistoryPageTemplate {...historyConfig} /></section>}
    {drawerMounted && <section data-testid="history-drawer"><HistoryDrawer type="tarot" /></section>}
    {recordsMounted && <section data-testid="records"><RecordsPage /></section>}
    {snapshotMounted && <AnalysisSnapshotProbe />}
    {tarotMounted && <section data-testid="tarot-result"><HeaderMenuProvider><TarotResultPage /></HeaderMenuProvider></section>}
    {qimenMounted && <section data-testid="qimen-result"><HeaderMenuProvider><QimenResultPage /></HeaderMenuProvider></section>}
    {activityMounted && <><ActivityProbe id="one" /><ActivityProbe id="two" /></>}
    {annualMounted && <section data-testid="annual-report"><AnnualReportPage /></section>}
    {communityMounted && <section data-testid="community"><CommunityPage /></section>}
    {postMounted && <section data-testid="community-post"><PostDetailPage /></section>}
    {castMounted && <section data-testid="cast-result"><HeaderMenuProvider>
      {castMounted === 'meihua' && <MeihuaResultPage />}{castMounted === 'xiaoliuren' && <XiaoliurenResultPage />}
      {castMounted === 'daliuren' && <DaliurenResultPage />}{castMounted === 'liuyao' && <LiuyaoResultPage />}
    </HeaderMenuProvider></section>}
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
  const { executeTool, buildToolSuccessPayload, findAnalysisMethod, listToolDefinitions, renderMethodGuide } = await import('taibu-core/mcp');
  const baziMethod = findAnalysisMethod('bazi');
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
  const dayunInput = listToolDefinitions().find(tool => tool.name === 'bazi_dayun').inputSchema.examples[0];
  const dayun = buildToolSuccessPayload('bazi_dayun', await executeTool('bazi_dayun', dayunInput));
  const drilldownParts = [];
  for (const [name, title, extra] of [['bazi_relations', '八字岁运刑冲合害', { year: 2027 }], ['bazi_wuxing', '八字五行旺衰', {}]]) {
    const input = { ...toolParts.find(tool => tool.name === 'bazi').input, ...extra };
    const rendered = buildToolSuccessPayload(name, await executeTool(name, input));
    drilldownParts.push({ type: 'tool', id: 'drill-' + name, name, title, status: 'completed', input: { reference: 'bazi_chart:11111111-1111-4111-8111-111111111111', ...extra },
      output: { chartReference: 'bazi_chart:11111111-1111-4111-8111-111111111111', chartKind: 'bazi', selection: extra, result: rendered.structuredContent, targets: [] },
      canonicalText: rendered.content.map(part => part.text).join('\n') });
  }
  const dayunPart = { type: 'tool', id: 'family-dayun', name: 'bazi_dayun', title: '八字大运', status: 'completed', input: dayunInput, durationMs: 12,
    output: { artifactId: 'family-dayun', result: dayun.structuredContent }, canonicalText: dayun.content.map(part => part.text).join('\n') };
  // 合盘与多人避冲：两个新工具的推演卡用 Core 的真实结果，浏览器里渲染的就是线上会看到的样子。
  const hepanDefinition = listToolDefinitions().find(tool => tool.name === 'bazi_hepan');
  const hepanInput = { ...hepanDefinition.inputSchema.examples[0] };
  const hepan = buildToolSuccessPayload('bazi_hepan', await executeTool('bazi_hepan', hepanInput));
  const hepanPart = { type: 'tool', id: 'family-hepan', name: 'bazi_hepan', title: hepanDefinition.title, status: 'completed', input: hepanInput,
    output: { artifactId: 'family-hepan', result: hepan.structuredContent }, canonicalText: hepan.content.map(part => part.text).join('\n') };
  const clashInput = { startDate: '2026-02-14', endDate: '2026-02-20', activity: '嫁娶', excludeClash: ['牛', '鸡'] };
  const clash = buildToolSuccessPayload('almanac_select', await executeTool('almanac_select', clashInput));
  const clashPart = { type: 'tool', id: 'family-almanac-clash', name: 'almanac_select', title: '黄历择日筛选', status: 'completed', input: clashInput,
    output: { artifactId: 'family-almanac-clash', result: clash.structuredContent }, canonicalText: clash.content.map(part => part.text).join('\n') };
  // 推算时辰：全天 13 个候选加前事年份，最长的一行（多条关系）要在工作区里换行而不撑宽。
  const hourInput = { gender: 'female', birthYear: 1995, birthMonth: 1, birthDay: 9, eventYears: [2018] };
  const hours = buildToolSuccessPayload('bazi_hour_candidates', await executeTool('bazi_hour_candidates', hourInput));
  const hourPart = { type: 'tool', id: 'family-hour-candidates', name: 'bazi_hour_candidates', title: '推算出生时辰', status: 'completed', input: hourInput,
    output: { artifactId: 'family-hour-candidates', result: hours.structuredContent }, canonicalText: hours.content.map(part => part.text).join('\n') };

  await bundle({
    stdin: { contents: entry.replace('DALIUREN_RESULT_FIXTURE', JSON.stringify(await executeTool('daliuren', { date: '2026-10-23', hour: 12, timezone: 'Asia/Shanghai' }))).replace('QIMEN_RESULT_FIXTURE', JSON.stringify(await executeTool('qimen', { year: 2024, month: 6, day: 1, hour: 12, timezone: 'Asia/Shanghai' }))).replace('AGENT_TOOL_FIXTURE_PARTS', JSON.stringify(toolParts)).replace('TRADITIONAL_TAIYI_FIXTURE_PART', JSON.stringify(traditionalPart)).replace('REVISED_BAZI_FIXTURE_RESULT', JSON.stringify(revisedBazi.structuredContent)).replace('AGENT_DAYUN_FIXTURE_PART', JSON.stringify(dayunPart)).replace('HEPAN_FIXTURE_PART', JSON.stringify(hepanPart)).replace('ALMANAC_CLASH_FIXTURE_PART', JSON.stringify(clashPart)).replace('HOUR_CANDIDATES_FIXTURE_PART', JSON.stringify(hourPart)).replace('BAZI_DRILLDOWN_FIXTURE_PARTS_JSON', JSON.stringify(drilldownParts)).replace('BAZI_METHOD_FIXTURE', JSON.stringify({ ...baziMethod, whenToUse: baziMethod.description, instructions: renderMethodGuide('bazi') })), loader: 'jsx', resolveDir: root, sourcefile: 'browser-components-entry.jsx' },
    outfile, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    tsconfig: resolve(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'explicit-fixture-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/auth$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/providers\/(ChatTaskToastBridge|AnnouncementPopupHost)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/lib\/hooks\/(useFeatureToggles|useCurrentUserProfile)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/settings\/panels\// }, args => /\/(GeneralSettingsPanel|AISettingsPanel|ChartsPanel|SharedLinksPanel)$/.test(args.path) ? null : ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^(?:node:)?crypto$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/settings\/AccountAdminPanels$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      // Signed-out states only need to render their login button; the auth flow itself is outside fixture scope.
      plugin.onResolve({ filter: /^@\/components\/auth\/AuthModal$/ }, args => ({ path: args.path, namespace: 'fixture' }));
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
          export const useParams = () => ({ postId: usePathname().split('/')[2] });
          export const useSearchParams = () => new URLSearchParams(useSyncExternalStore(subscribe, () => location.search, () => ''));
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
          const user = () => window.fixtureAuth.cookieUser ? {
            id: window.fixtureAuth.cookieUser,
            email: window.fixtureAuth.cookieUser + '@fixture.invalid',
            emailVerified: true,
            name: window.fixtureAuth.cookieUser,
            image: null,
          } : null;
          const session = () => { const current = user(); return current ? { id: 'fixture-session', userId: current.id, expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: current } : null; };
          const payload = () => ({ data: { session: session(), user: user() }, error: null });
          window.fixtureAuth = { cookieUser: 'alice', revalidations: 0, change(id) { this.cookieUser = id; for (const cb of listeners) cb('signed-in', payload().data); } };
          export const authSessionCacheConstants = { SESSION_REVALIDATE_EVENT_COOLDOWN_MS: 0 };
          // Sign-in flows are outside this fixture; the sidebar only mounts their components.
          const outsideFixture = async () => { throw new Error('Auth flows are outside the browser fixture'); };
          export const signInWithEmail = outsideFixture, sendOTP = outsideFixture, verifyOTP = outsideFixture, resetPasswordWithOTP = outsideFixture, signOut = outsideFixture;
          export const updateNickname = outsideFixture, updateAvatarUrl = outsideFixture, ensureUserRecord = outsideFixture;
          export const getSessionSnapshot = async () => payload();
          export const getSession = async () => session();
          export const invalidateBrowserSessionCache = () => {};
          export const revalidateBrowserSession = async () => { window.fixtureAuth.revalidations++; return payload(); };
          export const subscribeToAuth = cb => { listeners.add(cb); return () => listeners.delete(cb); };
          export const authClient = {};
        `;
        if (args.path.endsWith('/ChatTaskToastBridge')) contents = 'export function ChatTaskToastBridge() { return null; }';
        if (args.path.endsWith('/AnnouncementPopupHost')) contents = 'export function AnnouncementPopupHost({ children }) { return children; } export function useAnnouncementCenterSafe() { return { openAnnouncementCenter() { window.fixture.announcementCenter = (window.fixture.announcementCenter ?? 0) + 1; }, closeAnnouncementCenter() {}, announcementPromptCount: 0 }; }';
        if (args.path.endsWith('/useFeatureToggles')) contents = 'const enabled = () => true; export function useFeatureToggles() { return { loaded: true, isLoading: false, isFeatureEnabled: enabled }; }';
        if (args.path.endsWith('/useCurrentUserProfile')) contents = "import { useSessionSafe } from '@/lib/hooks/session-context'; export function useCurrentUserProfile() { const {user} = useSessionSafe(); return { profile: user ? { is_admin: user.id === 'alice' } : null, loading: false, error: null }; }";
        if (args.path.endsWith('/AuthModal')) contents = 'export function AuthModal() { return null; }';
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
    id: 'model-1', modelKey: 'fixture-model', displayName: 'Fixture Model', vendor: 'deepseek', description: null,
    usageType: 'chat', isEnabled: true, sortOrder: 0, requiredTier: 'free',
    supportsVision: false, supportsReasoning: true, isReasoningDefault: false, reasoningRequiredTier: 'plus',
    thinkingFormat: 'deepseek', thinkingLevels: ['low', 'high', 'max'], defaultReasoningEffort: 'high',
    contextWindow: 1000000, defaultMaxTokens: 32768,
    defaultTemperature: 0.7, defaultTopP: null, defaultPresencePenalty: null, defaultFrequencyPenalty: null,
    customParameters: null,
    sources: [{ gatewayId: '00000000-0000-4000-8000-0000000000a1', modelIdOverride: null, reasoningModelId: null, isEnabled: true }],
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
        if (url.pathname === '/api/agent/activity') return Response.json(agentIO.activity ?? { runs: [], notices: [] });
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
        // A save card reads its state and saves by its call; what is written comes from the task, never the request.
        const archive = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)\/archive$/);
        if (archive) {
          const saved = agentIO.archive ??= {};
          const key = archive[1] + ':' + (method === 'POST' ? body.callId : url.searchParams.get('callId'));
          if (method === 'POST') saved[key] = { state: 'saved', target: 'record', id: '55555555-5555-4555-8555-555555555555', href: '/records?id=55555555-5555-4555-8555-555555555555' };
          return Response.json(saved[key] ?? { state: 'pending' });
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
  const gateways = [
    { id: '00000000-0000-4000-8000-0000000000a1', gatewayKey: 'newapi', displayName: 'NewAPI', baseUrl: 'https://unused.invalid', isEnabled: true, notes: null, apiKeyHint: 'sk-…abcd', modelCount: 1 },
    { id: '00000000-0000-4000-8000-0000000000a2', gatewayKey: 'octopus', displayName: 'Octopus', baseUrl: 'https://unused-2.invalid', isEnabled: true, notes: null, apiKeyHint: 'sk-…wxyz', modelCount: 0 },
  ];
  let announcements = [];
  let failAnnouncementWrite = false;
  const activationKey = (id, code, extra) => ({ id, key_code: code, key_type: 'membership', membership_type: 'plus', credits_amount: null,
    is_used: false, used_by: null, used_at: null, created_at: '2026-01-02T00:00:00Z', ...extra });
  let activationKeys = [
    activationKey('key-unused', 'sk-fixtureunused001'),
    activationKey('key-used', 'sk-fixtureused00002', { key_type: 'credits', membership_type: null, credits_amount: 50, is_used: true, used_by: 'alice', used_at: '2026-01-05T00:00:00Z' }),
  ];
  let failKeyCreate = false;
  // The admin Agent task routes answer raw payloads: { runs } and { run, tree }.
  const agentTaskRun = { id: '7b1d4c3e-2f6a-4b8c-9d0e-1a2b3c4d5e6f', conversationId: '0c9b8a7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d', userId: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d',
    userEmail: 'alice@example.com', status: 'running', billing: 'charged', title: '看事业', model: 'fixture-analysis',
    modes: { codeMode: false, planMode: false, compact: false, web: false, collaborators: 1 }, workerId: 'worker-fixture', fence: 2,
    leaseUntil: '2026-10-21T00:01:00.000Z', cancelRequested: false, createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:30.000Z' };
  const agentTaskStart = Date.parse('2026-10-21T00:00:00.000Z');
  const agentTask = (id, role, status, extra = {}) => ({ id, kind: { generation: 'pi.generation', tool: 'pi.tool', subagent: 'taibu.background-anchor', report: 'taibu.background-reporter' }[role],
    role, status, changedAt: '2026-10-21T00:00:30.000Z', tasks: [], conversations: [], ...extra });
  const agentTaskTree = () => ({ commits: 42, lastCommitAt: '2026-10-21T00:00:30.000Z', truncated: false, counts: { live: 4, completed: 2, failed: 1, aborted: 0 }, conversations: [{
    id: 1, role: 'main', submissions: [{ id: 1, type: 'input', status: 'done', requestId: 'initial' }, { id: 9, type: 'input', status: 'unanswered', requestId: 'command:3', reason: 'model_error' }], tasks: [
      agentTask(3, 'generation', 'waiting', { phase: 'tools', waitingOn: [4, 5], policy: 'failFast', startedAt: agentTaskStart, tasks: [
        agentTask(4, 'tool', 'terminal', { tool: 'bazi', outcome: 'completed', startedAt: agentTaskStart, endedAt: agentTaskStart + 400 }),
        agentTask(5, 'tool', 'running', { tool: 'parallel_analysis', phase: 'execute', startedAt: agentTaskStart + 500, conversations: [{ id: 2, role: 'member',
          submissions: [{ id: 2, type: 'input', status: 'placed', requestId: 'analysis:5:0' }], tasks: [agentTask(6, 'generation', 'running', { phase: 'request', model: 'fixture-review', startedAt: agentTaskStart + 600 })] }] }),
      ] }),
      agentTask(7, 'subagent', 'terminal', { background: true, outcome: 'completed', startedAt: agentTaskStart, endedAt: agentTaskStart + 10, conversations: [{ id: 3, role: 'subagent', name: '八字复核', submissions: [],
        tasks: [agentTask(8, 'generation', 'terminal', { outcome: 'failed', reason: '模型调用失败：超时', startedAt: agentTaskStart + 20, endedAt: agentTaskStart + 2020 })] }] }),
      agentTask(10, 'report', 'running', { subagent: '八字复核', background: true, phase: 'deliver', startedAt: agentTaskStart + 30 }),
    ] }] });
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
    // 会话分类（视图列 has_agent_run）：夹具页面以 Agent 方式运行，列表里的会话按 Agent 会话提供。
    has_agent_run: true,
  }))]));
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', message => {
    if (message.text().includes('No queryFn was passed')) queryWarnings.push(message.text());
    // Unfolding a round before a jump flushes React synchronously; misuse is reported as an error.
    if (message.type() === 'error' && message.text().includes('flushSync')) browserErrors.push(message.text());
  });
  const settings = { notificationsEnabled: true, language: 'zh', expressionStyle: 'direct', customInstructions: '', chartPromptDetailLevel: 'default', userProfile: null, promptKbIds: [], notifyEmail: true, notifySite: true, defaultBaziChartId: null, defaultZiweiChartId: null, chatPreferences: { width: 700, fontScale: 100, desktopNotifications: false } };
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
  // Public share link of conversation share-fixture, as /api/conversations/[id]/share and /api/shares return it.
  let fixtureShare = null;
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
    const control = controls.find(item => !item.intercepted && item.pathname === url.pathname && item.method === method && (!item.action || item.action === body?.action));
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
      { id: 'fixture-analysis', name: '分析模型', vendor: 'other', supportsReasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultThinkingLevel: 'medium', allowed: true, reasoningAllowed: true },
      { id: 'fixture-review', name: '复核模型', vendor: 'other', supportsReasoning: true, thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultThinkingLevel: 'high', allowed: true, reasoningAllowed: true },
      { id: 'fixture-denied', name: '受限模型', vendor: 'other', supportsReasoning: true, allowed: false, blockedReason: '会员限制', reasoningAllowed: false },
      { id: 'fixture-toggle', name: '仅支持推理开关', vendor: 'other', supportsReasoning: true, allowed: true, reasoningAllowed: true },
    ] });
    if (url.pathname === '/api/user/profile' && method === 'GET') return ok({ profile: { id: await page.evaluate(() => window.fixtureAuth.cookieUser), is_admin: false } });
    if (url.pathname === '/api/annual-report' && method === 'GET') {
      const userId = await page.evaluate(() => window.fixtureAuth.cookieUser);
      const year = Number(url.searchParams.get('year'));
      return ok({ success: true, data: { report: { userId, year, generatedAt: '2026-10-23T00:00:00Z',
        usage: { totalAnalyses: (userId === 'alice' ? 11111 : 22222) + year, totalChats: 1, activeMonths: 1, firstUseDate: null, lastUseDate: null },
        featureUsage: { bazi: 1 }, activity: { monthlyUsage: [{ month: 1, count: 1 }], weekdayDistribution: [], peakHour: 10 },
        checkin: { totalDays: 1, totalCreditsEarned: 1 } } } }, true);
    }
    if (url.pathname.startsWith('/api/community/posts') && method === 'GET') {
      const userId = await page.evaluate(() => window.fixtureAuth.cookieUser);
      const id = url.pathname.split('/').at(-1);
      const post = { id, author_name: 'fixture author', author_avatar_url: null, title: '讨论 ' + id,
        content: '社区验收内容', category: 'general', tags: [], view_count: 1, upvote_count: 0, downvote_count: 0,
        comment_count: 0, is_pinned: false, is_featured: false, is_deleted: false,
        created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z' };
      if (id === 'posts') return ok({ posts: [{ ...post, id: 'list-item', title: '检索 ' + (url.searchParams.get('search') || '初始') }], total: 1 });
      return ok({ post, comments: [], viewer: { isAuthenticated: !!userId, isAuthor: userId === 'alice' }, viewerVotes: { post: null, comments: {} } });
    }
    if (['/api/user/settings','/api/reminders','/api/user/agent-memory'].includes(url.pathname)) {
      const cookieUser = await page.evaluate(() => window.fixtureAuth.cookieUser);
      if (request.headers()['x-expected-user-id'] && request.headers()['x-expected-user-id'] !== cookieUser) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Account changed' } }) });
      }
      if (url.pathname === '/api/user/agent-memory' && method === 'GET') return ok({ memories: [] });
      if (url.pathname === '/api/user/agent-memory' && method === 'DELETE') return ok({ deleted: true });
      if (url.pathname === '/api/user/settings') {
        const owned = settingsByUser[cookieUser] ?? settings;
        if (method === 'GET') { settingsReads++; return ok({ settings: owned }); }
        if (!control?.fail) Object.assign(owned, body);
        return ok({ settings: owned });
      }
    }
    if (url.pathname === '/api/conversations/share-fixture/share') {
      if (method === 'POST') fixtureShare = { token: fixtureShare?.token ?? 'S'.repeat(43), path: '/share/' + 'S'.repeat(43), includeCharts: body?.includeCharts === true, createdAt: '2026-10-19T08:00:00Z', updatedAt: '2026-10-19T08:0' + (fixtureShare ? '5' : '0') + ':00Z' };
      if (method === 'DELETE') { const revoked = fixtureShare !== null; fixtureShare = null; return ok({ revoked }, true); }
      return ok({ share: fixtureShare }, true);
    }
    if (/^\/api\/conversations\/retry-[ab]\/share$/.test(url.pathname)) {
      const token = url.pathname.includes('retry-b') ? 'B'.repeat(43) : 'A'.repeat(43);
      return ok({ share: { token, path: '/share/' + token, includeCharts: false, createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' } }, true);
    }
    if (['/api/tarot', '/api/qimen'].includes(url.pathname) && method === 'POST' && body.action === 'save') {
      const user = await page.evaluate(() => window.fixtureAuth.cookieUser);
      return ok(url.pathname === '/api/tarot' ? { readingId: user + '-tarot' } : { chartId: user + '-qimen' }, true);
    }
    if (['/api/meihua', '/api/xiaoliuren', '/api/daliuren', '/api/liuyao'].includes(url.pathname) && method === 'POST') {
      if (body.action === 'calculate' && url.pathname === '/api/daliuren') return ok(await page.evaluate(() => window.fixture.daliurenResult));
      if (body.action === 'save') return ok({ divinationId: await page.evaluate(() => window.fixtureAuth.cookieUser) + '-' + url.pathname.split('/').at(-1) }, true);
    }
    if (url.pathname === '/api/shares' && method === 'GET') return ok({ shares: fixtureShare ? [{ ...fixtureShare, conversationId: 'share-fixture', title: '分享夹具对话' }] : [] }, true);
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
      // Result pages and the Agent board post no id; the server assigns one, as here.
      const id = body.payload.id ?? `${type}-saved-${owned[listKey].length + 1}`;
      if (!control?.fail) owned[listKey].push({ ...chart(id, body.payload.name), ...body.payload, id });
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
    if (url.pathname === '/api/notes' && method === 'POST') {
      const body = request.postDataJSON();
      return ok({ id: 'fixture-note', user_id: 'alice', note_date: body.note_date, content: body.content, mood: body.mood,
        created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }, true);
    }
    if (url.pathname === '/api/notes') return ok({ notes: [] }, true);
    if (url.pathname === '/api/notifications' && method === 'PATCH') return ok({ success: true });
    if (url.pathname === '/api/search' && method === 'GET') return ok({ results: [], charts: [] });
    if (url.pathname === '/api/records') {
      const category = url.searchParams.get('category');
      const filtered = records.filter(item => !category || item.category === category);
      return ok({ records: filtered, total: filtered.length }, true);
    }
    if (url.pathname.startsWith('/api/records/') && method === 'GET') return ok(records.find(item => item.id === url.pathname.split('/').at(-1)) ?? null, true);
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
    if (url.pathname === '/api/admin/agent-runs' && method === 'GET') return ok({ runs: [agentTaskRun] }, true);
    if (url.pathname === `/api/admin/agent-runs/${agentTaskRun.id}` && method === 'GET') return ok({ run: agentTaskRun, tree: agentTaskTree() }, true);
    if (url.pathname === '/api/admin/ai-models/cache') return ok({ cleared: true });
    if (url.pathname === '/api/admin/ai-gateways' && method === 'GET') return ok({ gateways });
    if (url.pathname === '/api/admin/ai-gateways/probe' && method === 'POST') return ok({ ok: true, models: ['fixture-model', 'upstream-fixture'], latencyMs: 12 });
    if (url.pathname === '/api/admin/ai-models') {
      if (method === 'GET') return ok({ models });
      models.push({ ...body, id: 'created-model' });
      return ok({ id: 'created-model' });
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
    const modelPanel = page.getByTestId('models');
    const fixtureRow = modelPanel.locator('.ai-catalog-row').filter({ hasText: 'Fixture Model' });
    await fixtureRow.waitFor();
    check('A model row reads its window, output limit, thinking levels and sources', await fixtureRow.innerText().then(text =>
      text.includes('1M 上下文 · 32K 输出') && text.includes('思考 低/高/最高') && text.includes('NewAPI')));
    const modelWrites = () => requests.filter(item => item.pathname.startsWith('/api/admin/ai-models') && item.method !== 'GET').length;

    await modelPanel.getByRole('button', { name: '添加模型', exact: true }).click();
    let editor = page.locator('dialog.ai-catalog-dialog');
    await editor.getByRole('heading', { name: '添加模型', exact: true }).waitFor();
    await editor.getByLabel('显示名称', { exact: true }).fill('Created Fixture');
    await editor.getByLabel('模型 ID', { exact: true }).fill('  created-fixture  ');
    check('The model ID drops surrounding spaces as it is typed', await editor.getByLabel('模型 ID', { exact: true }).inputValue() === 'created-fixture');
    await editor.getByRole('group', { name: '上下文窗口', exact: true }).getByRole('button', { name: '1M', exact: true }).click();
    await editor.getByRole('group', { name: '最大输出', exact: true }).getByRole('button', { name: '32K', exact: true }).click();
    check('A window preset writes its number and reads as pressed', await editor.getByRole('spinbutton', { name: /^上下文窗口/ }).inputValue() === '1000000'
      && await editor.getByRole('group', { name: '上下文窗口', exact: true }).getByRole('button', { name: '1M', exact: true }).getAttribute('aria-pressed') === 'true');
    await editor.getByRole('switch', { name: '支持思考', exact: true }).click();
    const levels = editor.getByRole('group', { name: '可选思考等级', exact: true });
    for (const level of ['最高', '低', '高']) await levels.getByRole('button', { name: level, exact: true }).click();
    await editor.getByRole('combobox', { name: /^参数格式/ }).selectOption('deepseek');
    check('The thinking format names the request fields it writes', await editor.getByText('thinking.type + reasoning_effort', { exact: true }).isVisible());
    await editor.getByRole('combobox', { name: /^默认等级/ }).selectOption('max');
    check('The default level offers only the ticked levels', (await editor.getByRole('combobox', { name: /^默认等级/ }).locator('option').allTextContents()).join('|') === '低|高|最高');
    await editor.getByRole('combobox', { name: '添加来源', exact: true }).selectOption('00000000-0000-4000-8000-0000000000a2');
    await editor.getByRole('button', { name: '添加模型', exact: true }).click();
    await modelPanel.locator('.ai-catalog-row').filter({ hasText: 'Created Fixture' }).waitFor();
    const created = requests.find(item => item.pathname === '/api/admin/ai-models' && item.method === 'POST');
    check('Creating a model submits the identity, limits and preserved sampling defaults', created?.body.modelKey === 'created-fixture'
      && created.body.contextWindow === 1000000 && created.body.defaultMaxTokens === 32768 && created.body.defaultTemperature === 0.7 && created.body.defaultTopP === null);
    check('Creating a model submits the thinking ladder in order with a listed default', JSON.stringify(created?.body.thinkingLevels) === '["low","high","max"]'
      && created.body.defaultReasoningEffort === 'max' && created.body.thinkingFormat === 'deepseek' && created.body.supportsReasoning === true);
    check('A new model starts on the first gateway and keeps the added backup in order', created?.body.sources.map(source => source.gatewayId).join(',') === '00000000-0000-4000-8000-0000000000a1,00000000-0000-4000-8000-0000000000a2');

    await fixtureRow.getByRole('button', { name: '编辑 Fixture Model', exact: true }).click();
    editor = page.locator('dialog.ai-catalog-dialog');
    await editor.getByRole('heading', { name: 'Fixture Model', exact: true }).waitFor();
    check('An unchanged model cannot be saved', await editor.getByRole('button', { name: '保存', exact: true }).isDisabled());
    await editor.getByLabel('显示名称', { exact: true }).fill('Edited Fixture Model');
    await editor.getByRole('group', { name: '可选思考等级', exact: true }).getByRole('button', { name: '最高', exact: true }).click();
    check('Unticking a level keeps the default on a listed level', await editor.getByRole('combobox', { name: /^默认等级/ }).inputValue() === 'high');
    await editor.getByRole('combobox', { name: /^默认等级/ }).selectOption('low');
    await editor.getByRole('combobox', { name: '添加来源', exact: true }).selectOption('00000000-0000-4000-8000-0000000000a2');
    const upstream = editor.locator('.ai-catalog-source').getByLabel('上游模型 ID', { exact: true });
    await upstream.nth(0).fill('fixture-model');
    await upstream.nth(1).fill(' upstream-fixture ');
    await editor.locator('.ai-catalog-source').nth(1).getByRole('button', { name: '上移', exact: true }).click();
    await editor.locator('.ai-catalog-advanced summary').click();
    await editor.getByRole('textbox', { name: /^自定义请求参数/ }).fill('[]');
    const writesBeforeInvalid = modelWrites();
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await editor.getByRole('alert').filter({ hasText: 'JSON 对象' }).waitFor();
    check('Invalid custom parameters are refused before any write', modelWrites() === writesBeforeInvalid);
    await editor.getByRole('textbox', { name: /^自定义请求参数/ }).fill('{"top_k": 40}');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await modelPanel.locator('.ai-catalog-row').filter({ hasText: 'Edited Fixture Model' }).waitFor();
    const saved = requests.findLast(item => item.pathname === '/api/admin/ai-models/model-1' && item.method === 'PUT');
    check('Saving a model writes the whole edited model', saved?.body.displayName === 'Edited Fixture Model' && JSON.stringify(saved.body.thinkingLevels) === '["low","high"]'
      && saved.body.defaultReasoningEffort === 'low' && saved.body.customParameters?.top_k === 40);
    check('Sources save in the shown order with an override equal to the model ID inherited and others trimmed', saved?.body.sources.map(source => source.gatewayId).join(',') === '00000000-0000-4000-8000-0000000000a2,00000000-0000-4000-8000-0000000000a1'
      && saved.body.sources[0].modelIdOverride === 'upstream-fixture' && saved.body.sources[1].modelIdOverride === null);

    await modelPanel.getByRole('button', { name: '编辑 Edited Fixture Model', exact: true }).click();
    editor = page.locator('dialog.ai-catalog-dialog');
    await editor.getByLabel('显示名称', { exact: true }).fill('Discarded name');
    const writesBeforeDiscard = modelWrites();
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    check('Closing an edited model asks first and writes nothing', modelWrites() === writesBeforeDiscard && await modelPanel.getByText('Discarded name').count() === 0);
    const toggled = page.waitForResponse(response => response.url().endsWith('/api/admin/ai-models/created-model') && response.request().method() === 'PATCH');
    await modelPanel.locator('.ai-catalog-row').filter({ hasText: 'Created Fixture' }).getByRole('switch', { name: '启用 Created Fixture', exact: true }).click();
    await toggled;
    check('The row switch only toggles the model', requests.some(item => item.pathname === '/api/admin/ai-models/created-model' && item.method === 'PATCH' && JSON.stringify(item.body) === '{"isEnabled":false}'));
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
    await page.getByRole('button', { name: 'Fixture Agent tasks route', exact: true }).click();
    const taskPanel = page.getByTestId('agent-tasks');
    const taskListReads = () => requests.filter(item => item.pathname === '/api/admin/agent-runs');
    const taskTreeReads = () => requests.filter(item => item.pathname === `/api/admin/agent-runs/${agentTaskRun.id}`).length;
    const waitForRequest = async predicate => { for (let attempt = 0; attempt < 80 && !predicate(); attempt++) await page.waitForTimeout(100); return predicate(); };
    await taskPanel.getByRole('button', { name: /看事业/ }).waitFor();
    check('Agent task list reads active tasks with their status and user', taskListReads().some(item => item.search === '?scope=active')
      && await taskPanel.getByText('alice@example.com', { exact: true }).isVisible() && await taskPanel.locator('tbody').getByText('执行中', { exact: true }).isVisible());
    await taskPanel.getByRole('button', { name: /看事业/ }).click();
    const taskTree = taskPanel.getByRole('list', { name: '任务树' });
    await taskTree.waitFor();
    check('Agent task tree nests tool calls under the model call that waits on them', await taskTree.locator('[data-agent-task="3"]').getByText('等待 #4 #5 · tools', { exact: true }).first().isVisible()
      && await taskTree.locator('[data-agent-task="3"] [data-agent-task="4"]').getByText('工具 bazi', { exact: true }).isVisible()
      && await taskTree.locator('[data-agent-task="4"]').getByText('400 毫秒', { exact: true }).isVisible());
    check("Agent task tree shows a member's and a subagent's conversations under the tasks owning them", await taskTree.locator('[data-agent-task="5"] [data-agent-conversation="2"]').getByText('协作成员会话', { exact: true }).isVisible()
      && await taskTree.locator('[data-agent-task="7"] [data-agent-conversation="3"]').getByText('后台子分析「八字复核」', { exact: true }).isVisible()
      && await taskTree.getByText('后台回报 · 八字复核', { exact: true }).isVisible());
    check('Agent task tree shows why a task failed and which input went unanswered', await taskTree.locator('[data-agent-task="8"]').getByText('模型调用失败：超时', { exact: true }).isVisible()
      && await taskTree.getByText('command:3', { exact: true }).isVisible() && await taskTree.getByText('2.0 秒', { exact: true }).isVisible());
    await taskPanel.getByLabel('只看未结束').check();
    check('Only-unfinished keeps the live graph: ended branches without live work drop out', await taskTree.locator('[data-agent-task="4"]').count() === 0
      && await taskTree.locator('[data-agent-task="7"]').count() === 0 && await taskTree.locator('[data-agent-task="6"]').isVisible() && await taskTree.locator('[data-agent-task="10"]').isVisible());
    const treeReadsBefore = taskTreeReads();
    check("A running task's tree refreshes on its own", await waitForRequest(() => taskTreeReads() > treeReadsBefore));
    agentTaskRun.status = 'completed';
    const treeReadsRunning = taskTreeReads();
    await waitForRequest(() => taskTreeReads() > treeReadsRunning);
    await taskPanel.getByRole('region', { name: '任务详情' }).getByText('已完成', { exact: true }).waitFor();
    const treeReadsFinished = taskTreeReads();
    await page.waitForTimeout(3500);
    check("A finished task's tree stops refreshing", taskTreeReads() === treeReadsFinished);
    await taskPanel.getByLabel('按任务、对话或用户 ID 查找').fill('7b1d');
    await taskPanel.getByRole('button', { name: '查找', exact: true }).click();
    check('A partial ID is refused before any search request', (await taskPanel.getByRole('alert').textContent()).includes('请输入完整的任务、对话或用户 ID')
      && !taskListReads().some(item => item.search.includes('q=')));
    await taskPanel.getByLabel('按任务、对话或用户 ID 查找').fill(agentTaskRun.conversationId);
    await taskPanel.getByRole('button', { name: '查找', exact: true }).click();
    check('A full ID searches tasks in every state', await waitForRequest(() => taskListReads().some(item => item.search === `?scope=active&q=${agentTaskRun.conversationId}`)));
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
    await page.getByRole('dialog', { name: '删除这条记录？', exact: true }).getByRole('button', { name: '删除', exact: true }).click();
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
    const recordCategories = recordPanel.getByRole('group', { name: '分类', exact: true });
    const oldRecordFilter = holdNext('/api/records', 'GET');
    await recordCategories.getByRole('button', { name: '通用', exact: true }).click();
    await intercepted(oldRecordFilter);
    await recordCategories.getByRole('button', { name: '人生事件', exact: true }).click();
    await recordPanel.getByRole('heading', { name: 'Event saved record', exact: true }).waitFor();
    await release(oldRecordFilter);
    check('Rapid actual record filters cannot render older response under the new filter',
      await recordCategories.getByRole('button', { name: '人生事件', exact: true }).getAttribute('aria-pressed') === 'true' &&
      await recordCategories.getByRole('button', { name: '通用', exact: true }).getAttribute('aria-pressed') === 'false' &&
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
    const eventCard = recordPanel.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Event refreshed record', exact: true }) });
    check('Record actions are visible, labelled buttons rather than hover-only icons',
      await eventCard.getByRole('button', { name: '置顶', exact: true }).getAttribute('aria-pressed') === 'false' &&
      await eventCard.getByRole('button', { name: '编辑记录', exact: true }).isVisible() &&
      await eventCard.getByRole('button', { name: '删除记录', exact: true }).isVisible());
    const noteInput = recordPanel.getByLabel('今日小记内容', { exact: true });
    const notePosts = () => requests.filter(item => item.pathname === '/api/notes' && item.method === 'POST');
    await noteInput.fill('拼音');
    await noteInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    await recordPanel.getByRole('button', { name: '焦虑', exact: true }).click();
    check('Enter that confirms an IME candidate does not send the daily note',
      notePosts().length === 0 && await noteInput.inputValue() === '拼音' &&
      await recordPanel.getByRole('button', { name: '焦虑', exact: true }).getAttribute('aria-pressed') === 'true');
    const noteSaved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/notes');
    await noteInput.press('Enter');
    await noteSaved;
    const notesDate = new URLSearchParams(requests.filter(item => item.pathname === '/api/notes' && item.method === 'GET').at(-1)?.search).get('date');
    check('A plain Enter sends the note with the same local date the list reads',
      notePosts().length === 1 && notePosts()[0].body?.content === '拼音' && notePosts()[0].body?.mood === 'anxious' &&
      !!notesDate && notePosts()[0].body?.note_date === notesDate);
    await page.evaluate(() => window.fixture.mount.records(false));

    await page.evaluate(() => window.fixture.mount.question(true));
    // Locators resolve lazily, so they also find the remounted dock.
    const structuredDock = page.getByRole('region', { name: '太卜需要补充 2 项信息', exact: true });
    const questionSteps = structuredDock.getByRole('navigation', { name: '问题导航', exact: true });
    const reviewAnswers = () => structuredDock.locator('.agent-question-review dd').allInnerTexts();
    await structuredDock.getByLabel('工作', { exact: true }).check();
    await structuredDock.getByLabel('生活', { exact: true }).check();
    await structuredDock.getByLabel('自行填写', { exact: true }).fill('具体项目');
    await structuredDock.getByRole('button', { name: '下一题', exact: true }).click();
    check('The last question leads to a review instead of submitting', await structuredDock.getByRole('button', { name: '检查回答', exact: true }).isVisible() &&
      await questionSteps.getByRole('button', { name: '补充其他资料', exact: true }).getAttribute('aria-current') === 'step');
    await structuredDock.getByRole('button', { name: '跳过此题', exact: true }).click();
    await structuredDock.getByText('提交前检查', { exact: true }).waitFor();
    check('Question review lists choices, custom text and the explicit skip', JSON.stringify(await reviewAnswers()) === JSON.stringify(['工作、生活、具体项目', '已跳过']));
    await questionSteps.getByRole('button', { name: '选择分析范围', exact: true }).click();
    check('Question navigation returns to stable choices and custom input', await structuredDock.getByLabel('工作', { exact: true }).isChecked() && await structuredDock.getByLabel('生活', { exact: true }).isChecked() && await structuredDock.getByLabel('自行填写', { exact: true }).inputValue() === '具体项目');
    await structuredDock.getByRole('button', { name: '稍后回答', exact: true }).click();
    const questionStrip = page.getByRole('group', { name: '等待回答', exact: true });
    const answerLater = questionStrip.getByRole('button', { name: '回答问题', exact: true });
    await until(() => document.activeElement?.textContent === '回答问题');
    check('Answering later folds the questions into a strip that keeps stop and answer', await structuredDock.count() === 0 &&
      await questionStrip.getByRole('button', { name: '停止任务', exact: true }).isEnabled() && await questionStrip.innerText().then(text => text.includes('回答 2 个问题后继续任务')));
    await answerLater.click();
    await until(() => document.activeElement?.textContent === '稍后回答');
    check('Reopening the strip restores the same question and its draft', await structuredDock.getByLabel('自行填写', { exact: true }).inputValue() === '具体项目');
    await page.evaluate(() => window.fixture.mount.question(false));
    await structuredDock.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.fixture.mount.question(true));
    await structuredDock.getByText('提交前检查', { exact: true }).waitFor();
    check('Remounting a fully answered question resumes at its review with the saved draft', JSON.stringify(await reviewAnswers()) === JSON.stringify(['工作、生活、具体项目', '已跳过']));
    await questionSteps.getByRole('button', { name: '选择分析范围', exact: true }).click();
    check('Remounting the same question restores its choices and draft', await structuredDock.getByLabel('工作', { exact: true }).isChecked() && await structuredDock.getByLabel('自行填写', { exact: true }).inputValue() === '具体项目');
    await questionSteps.getByRole('button', { name: '检查', exact: true }).click();
    await structuredDock.getByRole('button', { name: '提交并继续', exact: true }).click();
    await structuredDock.waitFor({ state: 'hidden' });
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
    // 运行模式 = chin 行左端一个键，点开与「+」同款弹窗；不在行内并排三个分段。
    const modeTrigger = page.locator('[data-testid="agent-chat"]').getByRole('button', { name: /^运行模式：/ });
    check('Run mode is one button beside the model key, not three inline segments', await modeTrigger.count() === 1 &&
      await modeTrigger.getAttribute('aria-haspopup') === 'menu' && await page.getByRole('radiogroup', { name: '运行模式' }).count() === 0);
    await modeTrigger.click();
    const modeMenu = page.getByRole('menu', { name: '运行模式', exact: true });
    await modeMenu.waitFor();
    check('Run mode opens a popup with the three exclusive choices', JSON.stringify(await modeMenu.getByRole('menuitemradio').allInnerTexts()) === JSON.stringify(['默认', '计划', '代码']) &&
      await modeMenu.getByRole('menuitemradio', { name: '默认', exact: true }).getAttribute('aria-checked') === 'true');
    await modeMenu.getByRole('menuitemradio', { name: '代码', exact: true }).click();
    await until(() => window.fixture.agentChat.codeMode === true && window.fixture.agentChat.planMode === false);
    check('Choosing a run mode closes the popup and clears the other one', await modeMenu.count() === 0 &&
      await modeTrigger.getAttribute('aria-label') === '运行模式：代码');
    await modeTrigger.click();
    await modeMenu.getByRole('menuitemradio', { name: '默认', exact: true }).click();
    await until(() => window.fixture.agentChat.codeMode === false);
    const settingsTrigger = page.locator('[data-testid="agent-chat"]').getByRole('button', { name: /^选择模型：/ });
    await settingsTrigger.click();
    const modelSettings = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
    await modelSettings.waitFor();
    check('Model settings retain disabled membership choices', await modelSettings.getByRole('menuitemradio', { name: /受限模型/ }).isDisabled());
    await modelSettings.getByRole('menuitemradio', { name: '分析模型', exact: true }).focus();
    await page.keyboard.press('End');
    check('Model keyboard navigation skips disabled models', await modelSettings.getByRole('button', { name: '使用自己的模型 API', exact: true }).evaluate(button => button === document.activeElement)
      && await modelSettings.getByRole('menuitemradio', { name: /受限模型/ }).evaluate(button => button !== document.activeElement));
    await modelSettings.getByRole('menuitemradio', { name: '仅支持推理开关', exact: true }).click();
    await settingsTrigger.click();
    check('Models with only a reasoning switch do not offer unsupported effort levels', await modelSettings.getByRole('menuitemcheckbox', { name: '推理', exact: true }).count() === 1 &&
      await modelSettings.getByRole('menuitem', { name: '努力程度', exact: true }).count() === 0);
    await modelSettings.getByRole('menuitemcheckbox', { name: '推理', exact: true }).click();
    check('The reasoning switch turns on from the model menu', await modelSettings.getByRole('menuitemcheckbox', { name: '推理', exact: true }).getAttribute('aria-checked') === 'true');
    await modelSettings.getByRole('menuitemradio', { name: '分析模型', exact: true }).click();
    await settingsTrigger.click();
    await modelSettings.getByRole('menuitem', { name: /^努力程度/ }).click();
    const effortMenu = page.getByRole('menu', { name: '努力程度', exact: true });
    await effortMenu.waitFor();
    check('Effort is a second-level menu with the five claude levels and a default', await effortMenu.getByRole('menuitemradio', { name: '低', exact: true }).count() === 1 &&
      await effortMenu.getByRole('menuitemradio', { name: '中等', exact: true }).count() === 1 &&
      await effortMenu.getByRole('menuitemradio', { name: '高', exact: true }).count() === 1 &&
      await effortMenu.getByRole('menuitemradio', { name: '超高', exact: true }).count() === 1 &&
      await effortMenu.getByRole('menuitemradio', { name: '最高', exact: true }).count() === 1 &&
      await effortMenu.getByRole('menuitemradio', { name: '模型默认', exact: true }).count() === 1);
    await effortMenu.getByRole('menuitemradio', { name: '最高', exact: true }).click();
    await until(() => window.fixture.agentChat.state.reasoningEffort === 'max');
    await settingsTrigger.click();
    check('The chosen effort level reads on the model menu row', await modelSettings.getByRole('menuitem', { name: /^努力程度/ }).innerText().then(text => text.includes('最高')));
    // 主模型不参与协作成员：切到第三个模型，再勾选分析/复核两个子模型。
    await modelSettings.getByRole('menuitemradio', { name: '仅支持推理开关', exact: true }).click();
    await settingsTrigger.click();
    await modelSettings.getByRole('menuitem', { name: /多模型协作/ }).click();
    const collabMenu = page.getByRole('menu', { name: '多模型协作', exact: true });
    await collabMenu.waitFor();
    await collabMenu.getByRole('menuitemcheckbox', { name: '分析模型', exact: true }).click();
    await collabMenu.getByRole('menuitemcheckbox', { name: '复核模型', exact: true }).click();
    await until(() => window.fixture.agentChat.state.collaborators.length === 2);
    check('Collaboration is a checkable second-level entry in the model menu', await collabMenu.getByRole('menuitemcheckbox', { name: '分析模型', exact: true }).getAttribute('aria-checked') === 'true' &&
      await collabMenu.getByRole('menuitemcheckbox', { name: '复核模型', exact: true }).getAttribute('aria-checked') === 'true');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    check('Closing the model menu restores model trigger focus', await settingsTrigger.evaluate(button => button === document.activeElement));
    // 成员配置在设置页编辑（验收走设置界面）；这里通过公开状态写入并验证会话配置持久化。
    const settingsSaved = page.waitForResponse(response => response.request().method() === 'PATCH' && new URL(response.url()).pathname === '/api/conversations/agent-settings/configuration' && response.request().postDataJSON()?.collaborators?.[1]?.reasoningEffort === 'xhigh');
    await page.evaluate(() => window.fixture.agentChat.state.setCollaborators([
      { id: 'member-analysis', name: '八字分析', model: 'fixture-analysis', focus: '核对天干、日支与生克关系', reasoning: true, reasoningEffort: 'high' },
      { id: 'member-review', name: '跨术数复核', model: 'fixture-review', focus: '独立核对依据与分歧', reasoning: true, reasoningEffort: 'xhigh' },
    ]));
    await until(() => window.fixture.agentChat.state.collaborators[1]?.reasoningEffort === 'xhigh');
    assert.ok((await settingsSaved).ok());
    check('Conversation configuration persists member models and effort', await page.evaluate(() => {
      const { collaborators } = window.fixture.agentChat.state;
      return collaborators[0].model === 'fixture-analysis' && collaborators[0].reasoningEffort === 'high' && collaborators[1].model === 'fixture-review' && collaborators[1].reasoningEffort === 'xhigh';
    }));
    const usageRing = page.locator('[data-testid="agent-chat"]').getByRole('button', { name: /^用量：剩余 / });
    await usageRing.click();
    const usagePanel = page.getByRole('dialog', { name: '用量', exact: true });
    check('The usage ring opens the remaining platform credits', await usageRing.getAttribute('aria-expanded') === 'true' &&
      await usagePanel.innerText().then(text => text.includes('剩余积分') && text.includes('20 / 20') && text.includes('每次平台模型对话消耗 1 积分')));
    await page.keyboard.press('Escape');
    check('Closing the usage panel restores the ring focus', await usagePanel.count() === 0 && await usageRing.evaluate(button => button === document.activeElement));
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
    await modelSettings.getByRole('menuitem', { name: /多模型协作/ }).click();
    const restoredCollab = page.getByRole('menu', { name: '多模型协作', exact: true });
    await restoredCollab.waitFor();
    check('A restored conversation keeps its collaboration members checked', await restoredCollab.getByRole('menuitemcheckbox', { checked: true }).count() === 2);
    while (await restoredCollab.getByRole('menuitemcheckbox', { checked: true }).count() > 0) {
      await restoredCollab.getByRole('menuitemcheckbox', { checked: true }).first().click();
    }
    await page.keyboard.press('Escape');
    await until(() => window.fixture.agentChat.state.collaborators.length === 0);
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
    // Provider focus refreshes may read bootstrap/settings while these local chart interactions run. A chart board reads
    // the chart library to show whether its chart is saved, and saves it only when asked (checked on its own below).
    // Count all other writes and reads so chart loading, recalculation and persistence still fail this check.
    const chartLibraryOperation = request => (request.method === 'GET' && request.pathname === '/api/user/charts')
      || (request.method === 'POST' && /^\/api\/(bazi|ziwei)\/charts$/.test(request.pathname));
    const resultOperations = () => requests.filter(request => !(request.method === 'GET' && ['/api/app/bootstrap', '/api/user/settings'].includes(request.pathname))
      && !chartLibraryOperation(request)).length;
    const callsBeforeResults = resultOperations();
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).focus();
    await page.evaluate(() => window.fixture.mount.results(true));
    const results = page.locator('[data-testid="agent-results"]');
    // 右侧会话栏固定 280px：不再有顶部横条/拖拽手柄，也不写内联宽度。
    const railProbe = page.locator('[data-testid="session-rail-probe"]');
    check('The session rail is fixed width with no resize handle or separator',
      await railProbe.locator('.agent-session-rail').count() === 1 &&
      await railProbe.locator('.agent-rail-resizer, [role="separator"]').count() === 0 &&
      await railProbe.locator('.agent-session-rail').evaluate(el => !el.hasAttribute('style')));
    // 成果只在右侧会话栏与工作区展示：聊天里不再有命盘卡片、协作卡或「本任务成果」。
    await results.getByRole('button', { name: /任务过程/ }).waitFor();
    check('Transcript shows only the process; chart and collaboration results live in the workspace', await results.locator('.agent-result-card, .agent-collaboration-results, .agent-final-results').count() === 0);
    check('All eleven persisted readings and the incomplete one stay folded in the process', await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') === 'false');
    check('Automatic chart previews do not steal focus', await page.getByRole('button', { name: 'Fixture Alice', exact: true }).evaluate(button => button === document.activeElement));
    check('Legacy history with no native measurement does not invent response time', await results.locator('.agent-response-time').count() === 0);
    await page.evaluate(() => window.fixture.agentTiming());
    // 用时只落库、不展示（用户裁定 2026-10-17）：运行里记着测量值，屏幕上不再出现任何秒数。
    check('Recorded response and tool measurements never reach the screen', await results.locator('.agent-response-time').count() === 0 && await results.locator('.agent-step-time').count() === 0);
    await results.getByRole('button', { name: /任务过程/ }).click();
    const timedStep = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '八字命盘' }) });
    // claude 的步骤行是素净一行：没有圆标、没有家族标签、没有秒数。
    check('A completed step reads as one quiet line, without markers, family tags or any second count', await timedStep.count() === 1 &&
      await results.locator('.agent-step-tag, .agent-step-marker').count() === 0 && await results.locator('.agent-step-time').count() === 0 && await results.locator('.agent-tool-details').count() === 0);
    check('The status line opens into a plain step list', await results.locator('.agent-process-steps').isVisible() && await results.locator('.agent-step').count() === 12);
    await timedStep.locator('.agent-step-row').click();
    // 普通记录视图只显示规范文本，不露参数键名；参数仍可复制。
    check('A step discloses its canonical text without raw argument keys', await timedStep.locator('.agent-step-row').getAttribute('aria-expanded') === 'true' &&
      await timedStep.locator('.agent-step-command').count() === 0 && await timedStep.locator('.agent-step-output').innerText().then(text => !text.includes('birthYear')) &&
      await timedStep.getByRole('button', { name: '复制调用参数', exact: true }).count() === 0);
    await timedStep.getByRole('button', { name: /^(在工作区查看|查看盘面|查看详查)$/ }).click();
    await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').waitFor();
    check('A step opens its reading in the workspace and marks the step', await timedStep.locator('.agent-step-row').getAttribute('aria-current') === 'true' &&
      await results.locator('[aria-current="true"]').count() === 1);
    // 「详细」记录视图才逐行显示原始调用参数；切回普通后参数键名再次隐藏。
    await page.evaluate(() => window.fixture.recordView('detailed'));
    check('The detailed record view shows the raw call beside copy actions', await timedStep.locator('.agent-step-command').innerText().then(text => text.includes('birthYear') && !text.includes('秒')) &&
      await timedStep.getByRole('button', { name: '复制调用参数', exact: true }).count() === 0 &&
      await timedStep.getByRole('button', { name: '复制规范文本', exact: true }).count() === 0);
    await page.evaluate(() => window.fixture.recordView('normal'));
    check('Back in the normal view the raw call is hidden again', await timedStep.locator('.agent-step-command').count() === 0);
    await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
    check('Closing the workspace clears the shown marks', await results.locator('[aria-current="true"]').count() === 0);
    await results.getByRole('button', { name: /任务过程/ }).click();
    check('Folding the process summarizes its effects in one line', await results.getByRole('button', { name: /任务过程/ }).innerText().then(text => text.includes('已') && !text.includes('个步骤')));
    // 工作区再次从步骤打开；概览列出全部成果。
    await results.getByRole('button', { name: /任务过程/ }).click();
    if (await timedStep.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await timedStep.locator('.agent-step-row').click();
    await timedStep.getByRole('button', { name: /^(在工作区查看|查看盘面|查看详查)$/ }).click();
    await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').waitFor();
    check('The workspace opens on the reading', await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').count() === 1);
    await page.locator('#agent-workspace-panel').getByRole('tab', { name: '概览', exact: true }).click();
    const readingCards = page.locator('#agent-workspace-panel [data-overview-result="reading"]');
    check('The overview shows each valid reading once, marks the saved one and excludes the incomplete result', await readingCards.count() === 11 &&
      await readingCards.filter({ hasText: '已保存' }).count() === 1 && await page.locator('#agent-workspace-panel [data-overview-result="saved"]').count() === 0);
    // 概览改为等高列表行：每行都有缩略图，第二行不重复小图里已有的日主。
    // 等高由 .agent-ws-row 的 CSS 高度保证；夹具不加载应用样式，盘面工作区与对话列平分后长文案会换行，故这里只验结构。
    check('Overview rows each carry a thumbnail and one facts row', await page.locator('#agent-workspace-panel .agent-ws-row').evaluateAll(rows =>
      rows.length >= 11 && rows.every(row => row.querySelector('.agent-ws-row-thumb')?.childElementCount === 1 && row.querySelectorAll('.agent-ws-row-facts').length === 1)) &&
      await readingCards.filter({ hasText: '八字命盘' }).first().locator('.agent-ws-row-facts').innerText().then(text => !text.includes('日主')));
    await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
    await results.getByRole('button', { name: '恢复已有成果标签', exact: true }).click();
    await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').waitFor();
    check('A restored saved-artifact tab uses the same persisted reading without chart loading or recalculation', resultOperations() === callsBeforeResults && await page.getByRole('tab', { name: '已保存八字', exact: true }).count() === 1);
    await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
    // 另一个命盘从它自己的步骤打开，并保留已打开的八字标签。
    if (await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') !== 'true') await results.getByRole('button', { name: /任务过程/ }).click();
    const tarotStep = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '塔罗抽牌' }) });
    await tarotStep.locator('.agent-step-row').click();
    await tarotStep.getByRole('button', { name: /^(在工作区查看|查看盘面|查看详查)$/ }).click();
    await page.locator('#agent-workspace-panel [data-chart-kind="tarot"]').waitFor();
    check('Workspace supports multiple pinned readings without replacing their data', await page.getByRole('tab', { name: '八字命盘', exact: true }).count() === 1 && await page.locator('#agent-workspace-panel [data-chart-kind="tarot"]').count() === 1);
    await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
    await page.evaluate(() => window.fixture.resultsWithoutWorkspace(false));
    // 步骤行 = 打开对应命盘的入口（聊天里不再有卡片，夹具也不渲染会话栏）。
    if (await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') !== 'true') await results.getByRole('button', { name: /任务过程/ }).click();
    if (await timedStep.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await timedStep.locator('.agent-step-row').click();
    await timedStep.getByRole('button', { name: /^(在工作区查看|查看盘面|查看详查)$/ }).click();
    await page.locator('#agent-workspace-panel [data-chart-kind="bazi"]').waitFor();
    const interactive = page.locator('#agent-workspace-panel');
    check('An ended task offers no follow control', await interactive.getByRole('button', { name: '跟随模型', exact: true }).count() === 0);
    // 存不存盘由用户在盘面上决定：盘面按出生资料比对命盘库，保存走结果页同一接口，之后变成命盘页入口。
    const saveChart = interactive.getByRole('button', { name: '保存命盘', exact: true });
    const savedChart = interactive.getByRole('link', { name: '已保存到我的命盘，打开命盘页', exact: true });
    const chartSaves = () => requests.filter(item => item.method === 'POST' && item.pathname === '/api/bazi/charts');
    const savesBefore = chartSaves().length;
    await saveChart.click();
    await savedChart.waitFor();
    const [chartSave, ...extraSaves] = chartSaves().slice(savesBefore);
    check('Saving an Agent chart posts the result pages\' payload once and turns the action into its chart page link', !extraSaves.length &&
      chartSave?.expectedUserId === 'alice' && chartSave.body.payload.name === '男命 1990-01-15' && chartSave.body.payload.birth_time === '09:00' &&
      chartSave.body.payload.timezone === 'Asia/Shanghai' && /^\/bazi\/result\?chart=bazi-saved-\d+$/.test(await savedChart.getAttribute('href')) && await saveChart.count() === 0);
    // Following is for a working task: the chart checks below run while the fixture task runs.
    await page.evaluate(() => window.fixture.agentRunStatus('running'));
    await page.evaluate(() => window.fixture.chartFocus('bazi', ['bazi:cell:2:1'], '模型查看日支'));
    await interactive.getByRole('button', { name: '跟随模型', exact: true }).click();
    await interactive.locator('[data-chart-target="bazi:cell:2:1"][aria-pressed=true]').waitFor();
    check('A native chart action highlights the exact day branch and says the model is being followed', await interactive.locator('.agent-board-focus').innerText().then(text => text.includes('模型查看日支') && text.includes('太卜正在查看') && text.includes('跟随中')));
    await interactive.locator('[data-chart-target="bazi:cell:2:0"]').click();
    await until(() => window.fixture.chartQuestion?.targets?.[0]?.id === 'bazi:cell:2:0');
    check('Clicking a chart position asks about it without changing the model-given focus', await interactive.getByRole('button', { name: '跟随模型', exact: true }).getAttribute('aria-pressed') === 'true' &&
      await interactive.locator('[data-chart-target="bazi:cell:2:1"]').getAttribute('aria-pressed') === 'true' &&
      await interactive.locator('[data-chart-target="bazi:cell:2:0"]').getAttribute('aria-pressed') === 'false');
    // 盘面一直同时画关系与流通：关系取命盘自己的干支关系明细（这张盘只有丑辰相破），流通画相邻天干的生克；
    // 盘下不再列关系筛选、旺衰因子表或文字关系清单。
    const edges = interactive.locator('.agent-chart-scroll [data-relation-overlay] [data-relation-edge]');
    const breakEdge = interactive.locator('.agent-chart-scroll [data-relation-edge][data-tone="break"]');
    const breakBadge = interactive.locator('.agent-chart-scroll [data-relation-badge][data-tone="break"]');
    const adjacentStemFlow = await page.evaluate(() => window.fixture.chartTargets('bazi').filter(target => target.kind === 'bazi_relation' && ['生', '克'].includes(target.relation.类型)
      && Math.abs(['年柱', '月柱', '日柱', '时柱'].indexOf(target.relation.位置[0].柱) - ['年柱', '月柱', '日柱', '时柱'].indexOf(target.relation.位置[1].柱)) === 1).length);
    check('Bazi relations and flow are drawn together on the table, with no filters, factor table or text list under it',
      await interactive.locator('.agent-board-relations, .agent-board-marks, .agent-board-segments, .agent-board-relation-text, [data-wuxing-factors]').count() === 0 &&
      adjacentStemFlow > 0 && await edges.count() === adjacentStemFlow + 1 &&
      await interactive.locator('.agent-chart-scroll [data-relation-overlay] path[marker-end]').count() === adjacentStemFlow &&
      await breakEdge.count() === 1 && await breakBadge.getAttribute('aria-label').then(label => label.includes('丑辰相破')));
    // 夹具不加载应用样式表，标签列的视觉由自托管截图验收；这里只验结构：行标签是 th；
    // 相邻天干的生克与相邻地支的相破都是两字之间的直连线，不占连线层，天干行因此不额外留白。
    check('Adjacent pairs are linked directly between the glyphs, so the stem row needs no band, and labels are row headers', await interactive.locator('[data-chart-kind="bazi"] tbody th[scope="row"]').count() >= 5 &&
      await interactive.locator('.agent-chart-scroll [data-relation-edge][data-relation-shape="inline"]').count() === adjacentStemFlow + 1 &&
      await interactive.locator('[data-chart-kind="bazi"] tr[data-row="stem"] > td').evaluateAll(cells => cells.every(cell => !cell.style.paddingTop)));
    // 太卜在看日支：宿主带 data-relation-spotlight，只有日支亮着，没在看的线与字退后（透明度由样式给出，这里验标记）。
    // 上面点过日干，指针还停在盘上；悬停优先于太卜在看的位置，先把指针移出盘面再看。
    await page.mouse.move(0, 0);
    await renderBarrier();
    const lit = () => interactive.locator('.agent-chart-scroll [data-relation-cell][data-relation-lit]').evaluateAll(nodes => nodes.map(node => node.dataset.relationCell).sort());
    const litEdges = () => edges.evaluateAll(nodes => nodes.filter(node => node.dataset.lit).map(node => node.dataset.relationEdge));
    check('While the model looks at the day branch, the other lines and glyphs recede', await interactive.locator('.agent-interactive-chart[data-viewing]').count() === 1 &&
      await interactive.locator('.agent-chart-scroll [data-relation-spotlight]').count() === 1 && JSON.stringify(await lit()) === JSON.stringify(['日柱:地支']) &&
      (await litEdges()).length === 0 && await edges.evaluateAll(nodes => nodes.every(node => node.getAttribute('opacity') === '0.12')));
    // 悬停优先：指着丑辰相破时只亮这条线与丑、辰，太卜在看的日支之外的字都退后；移开即回到太卜在看的位置。
    await breakBadge.hover();
    check('Pointing at a line lights only it and its glyphs, over what the model is looking at', JSON.stringify(await lit()) === JSON.stringify(['日柱:地支', '月柱:地支']) &&
      JSON.stringify(await litEdges()) === JSON.stringify([await breakEdge.getAttribute('data-relation-edge')]) && await breakEdge.getAttribute('opacity') === '1');
    await page.mouse.move(0, 0);
    await renderBarrier();
    check('Moving away returns to what the model is looking at', JSON.stringify(await lit()) === JSON.stringify(['日柱:地支']) && (await litEdges()).length === 0);
    const relation = interactive.locator('[data-relation-badge][data-chart-target]').first();
    await relation.click();
    await until(() => window.fixture.chartQuestion?.targets?.[0]?.kind === 'bazi_relation');
    check('A relation also becomes a chart question while the model focus stays authoritative', await interactive.locator('.agent-board-focus').innerText().then(text => text.includes('模型查看日支')) &&
      await interactive.locator('.agent-board-chips li').allInnerTexts().then(texts => texts.length === 1 && texts[0] === '日柱地支 辰'));
    // 五行详查补进盘面：干支自坐与相邻天干画成线，通根与月令透出标在藏干旁并写出所指的天干。
    const wuxingFacts = await page.evaluate(() => {
      const result = window.fixture.baziDrilldownResult('bazi_wuxing');
      return { lines: result.干支自坐.length + result.相邻天干.length, roots: new Set(result.通根.map(row => row.位置[1].柱 + ':' + row.藏干)).size,
        reveals: result.月令.藏干.filter(item => item.透出.length > 0).length, rootless: (result.无根 ?? []).length };
    });
    await page.evaluate(() => window.fixture.baziDrilldowns());
    await renderBarrier();
    check('While following, the board names the drilldown it is viewing and keeps relations and flow drawn together', await interactive.locator('.agent-board-focus').innerText().then(text => text.includes('太卜正在查看') && text.includes('八字五行旺衰')) &&
      await edges.count() === wuxingFacts.lines + 1 && await breakEdge.count() === 1);
    // 紧凑与宽松两种藏干写法都在 DOM 里（样式只显示一种），所以每个标记计两次；无根只写在宽松的十神旁。
    const tags = kind => interactive.locator('.agent-chart-scroll [data-relation-tag="' + kind + '"]');
    check('Roots and month reveals are marked beside the hidden stems and name the stems they reach', wuxingFacts.roots > 0 && wuxingFacts.reveals > 0 &&
      await tags('root').count() === 2 * wuxingFacts.roots && await tags('reveal').count() === 2 * wuxingFacts.reveals && await tags('rootless').count() === wuxingFacts.rootless &&
      await tags('root').evaluateAll(nodes => nodes.some(node => /^根[年月日时](·[年月日时])*$/u.test(node.textContent ?? '') && /藏.+之根$/u.test(node.getAttribute('aria-label') ?? ''))) &&
      await tags('reveal').evaluateAll(nodes => nodes.every(node => /^月令.+透出于/u.test(node.getAttribute('aria-label') ?? ''))));
    const rootTag = tags('root').first();
    const rootSpot = (await rootTag.getAttribute('data-relation-spot')).split(' ').sort();
    await rootTag.hover();
    check('Pointing at a root mark lights its branch and the stems it roots, and no line', JSON.stringify(await lit()) === JSON.stringify(rootSpot) &&
      await rootTag.getAttribute('data-relation-lit') === '' && (await litEdges()).length === 0);
    await page.mouse.move(0, 0);
    await renderBarrier();
    // 详查结果落在盘面上，规范文本在对话步骤里展开；命盘标签不再重复列一遍详查。
    check('The chart tab does not repeat the drilldowns below the board', await page.locator('#agent-workspace-panel .agent-ws-drilldowns').count() === 0);
    // 详查还在跑时，盘面已经说明太卜正在看什么；关系与流通仍在盘上，不再切换模式。
    await page.evaluate(() => window.fixture.baziDrilldownRunning());
    await renderBarrier();
    check('A running drilldown already shows what the model is looking at', await interactive.locator('.agent-board-focus').innerText().then(text => text.includes('太卜正在查看') && text.includes('详查中 · 八字岁运刑冲合害')));
    await page.evaluate(() => window.fixture.baziDrilldowns(false));
    await renderBarrier();
    check('There is no separate dimming toggle: the board recedes by itself while the model looks', await interactive.getByRole('button', { name: '只看相关位置', exact: true }).count() === 0 &&
      await interactive.locator('.agent-interactive-chart[data-viewing]').count() === 1);
    await interactive.getByRole('button', { name: '追问这里', exact: true }).click();
    check('Chart questions carry the real chart reference into a draft', await page.evaluate(() => window.fixture.chartQuestion.reference.includes('bazi_chart:11111111-1111-4111-8111-111111111111')));
    const starId = await page.evaluate(() => window.fixture.chartTargets('ziwei').find(target => target.kind === 'ziwei_star' && target.group === '主星及四化').id);
    await page.evaluate(id => window.fixture.chartFocus('ziwei', [id], '模型查看紫微星曜'), starId);
    await interactive.getByRole('button', { name: '跟随模型', exact: true }).click();
    const star = interactive.locator('[data-chart-target="' + starId + '"]');
    await star.waitFor();
    check('Ziwei model focus selects the returned palace and its exact star', await star.getAttribute('aria-pressed') === 'true' && await interactive.locator('[data-chart-selected=true]').count() === 1 && await interactive.locator('[data-chart-kind="ziwei"] svg line').count() === 3);
    check('Ziwei related palaces follow the model focus without a user toggle', await interactive.getByRole('checkbox', { name: '三方四正', exact: true }).count() === 0 && await interactive.locator('[data-chart-kind="ziwei"] svg line').count() === 3);
    check('Ziwei shows its minor stars directly, without a hide toggle', await interactive.getByRole('button', { name: /杂曜/ }).count() === 0);
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
      // 太卜在看时其余单元退后：交互盘的单元总写出是否在看（样式据此调暗），黄历只有可点的目标。
      const units = await interactive.locator('[data-chart-kind="' + kind + '"] [data-chart-selected]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-chart-selected')));
      check(kind + ' marks every unit as looked at or not while the model looks', await interactive.locator('.agent-interactive-chart[data-viewing]').count() === 1 &&
        units.every(value => value === 'true' || value === 'false') && (kind === 'almanac' || (units.includes('true') && units.includes('false'))));
      await page.evaluate(({ kind, id }) => window.fixture.chartFocus(kind, [id], '模型定位末项'), { kind, id: targets.at(-1).id });
      await interactive.locator('[data-chart-target="' + targets.at(-1).id + '"][aria-pressed=true]').waitFor();
      await interactive.locator('[data-chart-target="' + targets.at(-1).id + '"]').click();
      await interactive.getByRole('button', { name: '追问这里', exact: true }).click();
      // 其余盘面的信息卡：奇门起局、六壬起课、太乙底盘、梅花起卦与体用；占星锚点压成一行一项。
      const factCards = { qimen: '起局信息', daliuren: '起课信息', taiyi: '时空底盘', meihua: '起卦与体用' };
      if (factCards[kind]) check(kind + ' lists its setup facts in one card under the board', await interactive.locator('[data-chart-kind="' + kind + '"] [aria-label="' + factCards[kind] + '"] dt').count() >= 2);
      if (kind === 'astrology') check('Astrology keeps one compact anchor row each and folds the raw coordinates', await interactive.locator('[data-chart-kind="astrology"] [aria-label="命盘锚点"] li').count() === 4 &&
        await interactive.locator('[data-chart-kind="astrology"] details [aria-label="基础坐标"]').count() === 1);
      if (kind === 'tarot') {
        const { 问题: question, 牌阵: spread } = await page.evaluate(() => window.fixture.chartTool('tarot').问卜设定);
        check('Tarot shows the spread without repeating the question or the spread name', Boolean(question) && await interactive.locator('[data-chart-kind="tarot"]').getByText(question).count() === 0 &&
          await interactive.locator('[data-chart-kind="tarot"]').getByRole('heading', { name: spread, exact: true }).count() === 0);
      }
      if (kind === 'liuyao') {
        // 六爻：窄宽度也保留变卦爻线；动爻取 Core「动静」；卦身、卦级互动与卦辞补齐。
        const liuyao = await page.evaluate(() => { const tool = window.fixture.chartTool('liuyao'); return { changed: Boolean(tool.卦盘.变卦), moving: tool.六爻全盘.爻列表.filter(line => String(line.动静 ?? '').startsWith('明动')).length, body: Boolean(tool.卦盘.卦身), texts: Boolean(tool.卦盘.本卦.卦辞) }; });
        const board = interactive.locator('[data-chart-kind="liuyao"]');
        check('Liuyao keeps both hexagrams drawn, marks moving lines from Core and lists its body, interplay and texts', await board.locator('[data-changed-bar]').count() === (liuyao.changed ? 6 : 0) &&
          (!liuyao.changed || await board.locator('[data-hexagram="base"] tbody tr').evaluateAll(rows => rows.filter(row => row.querySelector('[title$="动爻"]')).length) === liuyao.moving) &&
          await board.locator('[aria-label="卦象要点"]').count() === (liuyao.body ? 1 : await board.locator('[aria-label="卦象要点"]').count()) &&
          await board.getByText('卦辞与爻辞').count() === (liuyao.texts ? 1 : 0));
      }
      check(kind + ' keeps the model focus and builds a referenced chart question', await following.getAttribute('aria-pressed') === 'true' && await page.evaluate(() => window.fixture.chartQuestion.reference.includes(':')));
    }
    // 黄历：值日并入主卡（含星宿歌诀），日九星原始卡删除；时辰带 13 格，模型定位的时辰直接展开详情条。
    const almanac = interactive.locator('[data-chart-kind="almanac"]');
    check('The almanac folds the day card into its main card and shows the located hour in a detail strip', await almanac.locator('[aria-label="值日信息"], [aria-label="日九星"]').count() === 0 &&
      await almanac.locator('.almanac-hour').count() === 13 && await almanac.locator('.almanac-verse[data-chart-target="almanac:day:星宿歌诀"]').count() === 1 &&
      await almanac.locator('.almanac-hour-detail').innerText().then(text => text.includes('宜') && text.includes('忌')));
    await page.evaluate(() => window.fixture.traditionalTaiyi());
    await renderBarrier();
    const traditionalTargets = await page.evaluate(() => window.fixture.chartTargets('taiyi'));
    const traditionalStar = traditionalTargets.find(target => target.id.includes(':palace:') && target.id.includes(':star:'));
    await page.evaluate(id => window.fixture.chartFocus('taiyi', [id], '查看传统太乙星将'), traditionalStar.id);
    const followTaiyi = interactive.getByRole('button', { name: '跟随模型', exact: true });
    if (await followTaiyi.getAttribute('aria-pressed') !== 'true') await followTaiyi.click();
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
    check('Reinspecting unchanged chart data keeps the chart question available', await page.evaluate(() => window.fixture.chartQuestion?.targets?.[0]?.id === 'bazi:cell:2:0'));
    await page.evaluate(() => window.fixture.chartInspect(true));
    await renderBarrier();
    check('Edited saved chart data invalidates manual coordinates on the same resource tab', await interactive.locator('.agent-board-focus').getAttribute('data-chart-focus') === '' && await interactive.locator('.chart-cell-button[aria-pressed=true]').count() === 0);
    await interactive.getByRole('button', { name: '关闭工作区', exact: true }).click();
    await page.evaluate(() => window.fixture.mount.results(false));
    await renderBarrier();
    await page.evaluate(() => window.fixture.mount.results(true));
    await results.getByRole('button', { name: /任务过程/ }).waitFor();
    check('History remount keeps chart results out of the transcript without new API operations', resultOperations() === callsBeforeResults &&
      await results.locator('.agent-result-card').count() === 0);
    // Phones fold a running task's process to two lines, the count and what runs now; wider screens open its steps.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.fixture.agentRunStatus('running'));
    await results.locator('.agent-process-now').waitFor();
    check('On a phone a running task folds its process to its count and what runs now', await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') === 'false' &&
      /^· \d+ \/ \d+ 完成$/.test(await results.locator('.agent-process-heading.is-live .agent-process-count').innerText()) &&
      await results.locator('.agent-process-now').innerText() === await results.locator('.agent-live-activity').innerText());
    await page.setViewportSize({ width: 1200, height: 1000 });
    await results.locator('.agent-process-steps').waitFor();
    check('Beside the workspace the running process opens its step card', await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') === 'true' &&
      await results.locator('.agent-process-now').count() === 0);
    await page.evaluate(() => window.fixture.collaborationResults(false));
    check('The live line names the member still analysing', await results.locator('.agent-live-activity').innerText() === '等待协作成员 · 独立复核 正在分析');
    const teamStep = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '协作分析' }) });
    await teamStep.locator('.agent-step-row').click();
    // 展开的协作步骤列出成员，点成员直接打开它的独立页面。
    await teamStep.locator('.agent-step-entities[aria-label="协作成员"] button').first().click();
    const memberPage = page.locator('#agent-workspace-panel [data-workspace-view="member"]');
    await memberPage.waitFor();
    check('A collaboration step names its members and opens each one’s own page', await teamStep.locator('.agent-step-entities[aria-label="协作成员"] button').count() === 2 &&
      await teamStep.locator('.agent-step-entities[aria-label="协作成员"]').innerText().then(text => text.includes('八字分析') && text.includes('独立复核')) &&
      await memberPage.innerText().then(text => text.includes('八字分析') && text.includes('调用了 3 次工具')));
    await page.locator('#agent-workspace-panel').getByRole('tab', { name: '两派会诊', exact: true }).click();
    const collaboration = page.locator('#agent-workspace-panel [data-workspace-view="collaboration"]');
    await collaboration.waitFor();
    check('Collaborator models and the call a running member is on show in the workspace', await collaboration.innerText().then(text => text.includes('分析模型') && text.includes('复核模型')) &&
      await collaboration.locator('.agent-ws-member[data-state="running"]').innerText().then(text => text.includes('读取官禄宫')));
    await page.evaluate(() => window.fixture.agentRunStatus('completed'));
    check('A member left analysing when the task ended is shown unfinished, not spinning', await collaboration.locator('.agent-ws-member[data-state="failed"]').innerText().then(text => text.includes('未完成')) && await collaboration.locator('.animate-spin').count() === 0);
    await page.evaluate(() => window.fixture.collaborationResults(true));
    check('Completed collaborator analysis survives JSON history and opens for comparison', await collaboration.innerText().then(text => !text.includes('分析中') && text.includes('生克关系复核完成。') && text.includes('两派会诊') && text.includes('3 次工具')) && resultOperations() === callsBeforeResults);
    check('The folded process line summarizes the collaboration as intelligent agents', await results.getByRole('button', { name: /任务过程/ }).innerText().then(text => text.includes('开启 2 个智能体')));
    // 完成后的成员过程在它自己的页面里；协作页只保留对照、结论与打开入口。
    const reviewer = collaboration.locator('.agent-ws-member').last();
    await reviewer.getByRole('button', { name: '打开分析', exact: true }).click();
    const reviewerPage = page.locator('#agent-workspace-panel [data-workspace-view="member"]');
    await reviewerPage.waitFor();
    const processLine = reviewerPage.locator('.agent-ws-member-process-heading');
    check('A finished member folds its process into one line on its own page and keeps the raw artifact ID out of its answer', await processLine.getAttribute('aria-expanded') === 'false' &&
      await processLine.innerText().then(text => text.includes('已查看 1 张命盘')) && await reviewerPage.locator('.agent-ws-member-answer').innerText().then(text => text.trim() === '生克关系复核完成。'));
    await processLine.click();
    const firstCall = reviewerPage.locator('.agent-ws-member-call').first();
    check('The member process shows what it said before a call and what each call was', await reviewerPage.locator('.agent-ws-member-note').innerText() === '先排盘，再逐条复核生克。' &&
      await firstCall.innerText().then(text => text.includes('八字排盘') && text.includes('1990 / 1 / 15')));
    await firstCall.click();
    check('A member call discloses its arguments and the text the tool returned', await reviewerPage.locator('.agent-ws-member-args').innerText().then(text => text.includes('birthYear')) &&
      await reviewerPage.locator('.agent-ws-member-output h1').innerText() === '八字命盘');
    await reviewerPage.locator('.agent-ws-member-call').last().click();
    check('A cut-off return says it was shortened', await reviewerPage.locator('.agent-ws-member-call-body').last().innerText().then(text => text.includes('只保留了开头部分')));
    await page.locator('#agent-workspace-panel').getByRole('tab', { name: '两派会诊', exact: true }).click();
    const divergence = page.locator('#agent-workspace-panel').getByRole('region', { name: /分歧对照/ });
    check('The divergence table marks only the option topic where finished members disagree', await divergence.locator('tbody tr').count() === 2 &&
      await divergence.locator('tr[data-divergent]').count() === 1 && await divergence.locator('tr[data-divergent] th').innerText().then(text => text.startsWith('是否变动')) &&
      await divergence.locator('td[data-empty]').innerText() === '未表态');
    // Close this call's tab so the family section below starts from its own opened views.
    await page.getByRole('button', { name: '关闭两派会诊标签', exact: true }).click();
    await page.getByRole('button', { name: '关闭工作区', exact: true }).click();

    // A background subagent: the task waits for its report, and its step opens its page with the message it was sent.
    await page.evaluate(() => { window.fixture.agentRunStatus('running'); window.fixture.backgroundResults(false); });
    await renderBarrier();
    check('While only a background subagent works, the live line says what the task waits for', await results.locator('.agent-live-activity').innerText() === '等待后台子分析回报 · 八字复核 正在分析');
    const processToggle = results.getByRole('button', { name: /任务过程/ });
    if (await processToggle.getAttribute('aria-expanded') !== 'true') await processToggle.click();
    const backgroundStep = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '后台子分析' }) });
    if (await backgroundStep.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await backgroundStep.locator('.agent-step-row').click();
    await backgroundStep.locator('.agent-step-entities[aria-label="协作成员"] button').filter({ hasText: '八字复核' }).click();
    const subagentPage = page.locator('#agent-workspace-panel [data-workspace-view="member"]');
    await subagentPage.waitFor();
    check('A background step opens the subagent’s page with the task it was given and its calls so far', await subagentPage.innerText().then(text =>
      text.includes('后台子分析') && text.includes('请排盘并看 2027 年事业。') && text.includes('八字排盘')));
    await page.evaluate(() => { window.fixture.backgroundResults(true); window.fixture.agentRunStatus('completed'); });
    await renderBarrier();
    check('Once it reports, the subagent’s page shows its answer', await subagentPage.innerText().then(text => text.includes('2027 年事业有变动。') && !text.includes('正在分析')));
    // 子分析的调用也能展开：参数与工具返回都是具体内容。
    const subagentProcess = subagentPage.locator('.agent-ws-member-process-heading');
    if (await subagentProcess.getAttribute('aria-expanded') !== 'true') await subagentProcess.click();
    const subagentCall = subagentPage.locator('.agent-ws-member-call').filter({ hasText: '八字排盘' }).first();
    if (await subagentCall.getAttribute('aria-expanded') !== 'true') await subagentCall.click();
    check('A subagent call expands to the arguments it ran with and what it returned', await subagentPage.locator('.agent-ws-member-args').innerText().then(text => text.includes('birthYear') && text.includes('1990')) &&
      await subagentPage.locator('.agent-ws-member-output').innerText().then(text => text.includes('日主：庚金')));
    await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
    await page.evaluate(() => window.fixture.backgroundResults(null));
    await renderBarrier();

    // Tool families: every call reaches its own workspace view from the chat, and following tracks the latest call.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => window.fixture.workspaceFamilies());
    if (await results.getByRole('button', { name: /任务过程/ }).getAttribute('aria-expanded') !== 'true') await results.getByRole('button', { name: /任务过程/ }).click();
    const dayunStep = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '八字大运' }) });
    await dayunStep.locator('.agent-step-row').click();
    await dayunStep.getByRole('button', { name: /^(在工作区查看|查看盘面|查看详查)$/ }).click();
    const workspacePanel = page.locator('#agent-workspace-panel');
    // 过程标签已移除：从聊天转录的步骤行打开同一个工作区视图。
    const openProcessStep = async (name, tabName) => {
      const toggle = results.getByRole('button', { name: /任务过程/ });
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      const step = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: name }) }).last();
      if (await step.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await step.locator('.agent-step-row').click();
      // 协作步骤展开后列出成员，不再有「在工作区查看」；协作总览从它自己的标签进入。
      if (tabName) { await workspacePanel.getByRole('tab', { name: tabName, exact: true }).click(); return; }
      // 结构化结果（方法、记忆、资料…）就在步骤里，入口改成「查看…」；其余调用仍是「在工作区查看」。
      const open = step.getByRole('button', { name: /^(在工作区查看|查看盘面|查看详查)$/ });
      if (await open.count()) await open.click();
      else await step.locator('.agent-step-structured-open').first().click();
    };
    const openTeamMember = async (name, memberName) => {
      const toggle = results.getByRole('button', { name: /任务过程/ });
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
      const step = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: name }) }).last();
      if (await step.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await step.locator('.agent-step-row').click();
      await step.locator('.agent-step-entities[aria-label="协作成员"] button').filter({ hasText: memberName }).click();
    };
    await workspacePanel.locator('[data-workspace-view="calculation"]').waitFor();
    check('A calculation step opens the persisted Core dayun timeline with exactly one current period', await workspacePanel.locator('.agent-ws-timeline > li').count() === 9 &&
      await workspacePanel.locator('.agent-ws-timeline > li[aria-current="step"]').count() === 1 && await workspacePanel.getByText('Core 规范文本', { exact: true }).count() === 1);
    check('Desktop workspace is a complementary panel rather than a modal', await page.locator('aside#agent-workspace-panel').count() === 1 && await page.getByRole('dialog', { name: '工作区' }).count() === 0);
    // 拖拽 = 整块面板实时跟手：拖动中直接改 DOM 宽度，松手后提交为状态。
    const resizer = workspacePanel.locator('.agent-panel-resizer');
    const widthBeforeDrag = await workspacePanel.evaluate(el => Math.round(el.getBoundingClientRect().width));
    // 夹具不加载应用 CSS，热区没有尺寸，不能做真实命中测试；直接派发指针事件验证宽度跟手逻辑。
    const dragResult = await resizer.evaluate(el => {
        const panel = el.parentElement;
        const capture = { set: el.setPointerCapture, has: el.hasPointerCapture, release: el.releasePointerCapture };
        el.setPointerCapture = () => {};
        el.hasPointerCapture = () => true;
        el.releasePointerCapture = () => {};
        const fire = (type, clientX) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, pointerId: 1 }));
        fire('pointerdown', 200);
        const down = { inline: panel.style.width, resizing: panel.getAttribute('data-resizing') === 'true' };
        fire('pointermove', 248);
        const moved = { inline: panel.style.width, resizing: panel.getAttribute('data-resizing') === 'true' };
        fire('pointerup', 248);
        const up = { inline: panel.style.width, resizing: panel.getAttribute('data-resizing') === 'true' };
        el.setPointerCapture = capture.set; el.hasPointerCapture = capture.has; el.releasePointerCapture = capture.release;
        return { down, moved, up };
    });
    await renderBarrier();
    const widthAfterDrag = await workspacePanel.evaluate(el => ({ width: Math.round(el.getBoundingClientRect().width), inline: el.style.width }));
    check('Dragging the workspace resizer moves the whole panel with the pointer and keeps the width',
      dragResult.down.resizing && dragResult.moved.inline === `${widthBeforeDrag - 48}px` && dragResult.moved.resizing &&
      dragResult.up.inline === dragResult.moved.inline && !dragResult.up.resizing &&
      widthAfterDrag.width === widthBeforeDrag - 48 && widthAfterDrag.inline === dragResult.moved.inline);
    await workspacePanel.getByRole('button', { name: '视图选项' }).click();
    await page.getByRole('menuitem', { name: '恢复默认宽度' }).click();
    await renderBarrier();
    check('Restoring the default width returns the workspace to its content width',
      await workspacePanel.evaluate(el => Math.round(el.getBoundingClientRect().width)) === widthBeforeDrag);
    await resizer.focus();
    await page.keyboard.press('ArrowLeft');
    await renderBarrier();
    const widened = await workspacePanel.evaluate(el => Math.round(el.getBoundingClientRect().width));
    // 热区在夹具里没有尺寸（不加载应用 CSS），直接派发双击。
    await resizer.dispatchEvent('dblclick');
    await renderBarrier();
    check('Double-clicking the resizer restores the default width and the separator reports the real width',
      widened === widthBeforeDrag + 24 && await workspacePanel.evaluate(el => Math.round(el.getBoundingClientRect().width)) === widthBeforeDrag &&
      await resizer.getAttribute('aria-valuenow') === String(widthBeforeDrag));
    // The desktop layout starts at 1024 (the site sidebar's breakpoint): narrower desktop windows keep the panel docked,
    // and only below it does the workspace become a dialog, which has no room to grow.
    await page.setViewportSize({ width: 1100, height: 1000 });
    await renderBarrier();
    check('A narrower desktop window keeps the workspace docked beside the chat', await page.locator('aside#agent-workspace-panel').count() === 1 &&
      await page.getByRole('dialog', { name: '工作区' }).count() === 0);
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.getByRole('dialog', { name: '工作区' }).waitFor();
    check('Below the desktop layout the workspace is a dialog without the maximize control', await page.locator('aside#agent-workspace-panel').count() === 0 &&
      await page.getByRole('dialog', { name: '工作区' }).getByRole('button', { name: '最大化工作区' }).count() === 0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('aside#agent-workspace-panel').waitFor();
    // Following is for a working task; once it ends the overview is shown.
    await page.evaluate(() => window.fixture.agentRunStatus('running'));
    await workspacePanel.getByRole('button', { name: '跟随模型', exact: true }).click();
    await workspacePanel.locator('[data-workspace-view="question"]').waitFor();
    check('Following the model shows the view of its latest tool call', await workspacePanel.getByRole('tab', { name: '补充信息', exact: true }).getAttribute('aria-selected') === 'true' &&
      await workspacePanel.locator('.agent-ws-questions li[data-state="missing"]').innerText().then(text => text.includes('出生时间') && text.includes('未回答')));
    await page.evaluate(() => window.fixture.answerFamilyQuestion());
    const reply = workspacePanel.locator('.agent-ws-questions li[data-state="replied"]');
    await reply.waitFor();
    check('A stored reply is matched to its question through the question ID', await reply.innerText().then(text => text.includes('早上') && text.includes('已回答')));
    await page.evaluate(() => window.fixture.workspaceStep('todo_write', 'completed'));
    await renderBarrier();
    check('Plan updates do not pull the followed view away', await workspacePanel.locator('[data-workspace-view="question"]').count() === 1);
    await page.evaluate(() => window.fixture.workspaceStep('web_search', 'running'));
    await workspacePanel.locator('[data-workspace-view="evidence"]').waitFor();
    const evidence = workspacePanel.locator('[data-workspace-view="evidence"]');
    await evidence.getByRole('status').waitFor();
    check('A new search call switches the followed view to the evidence with a live state', await evidence.getByRole('status').innerText().then(text => text.includes('检索「流年」')));
    check('Each view the model opened while followed stays as a tab, marked while its call runs', await workspacePanel.getByRole('tab', { name: '补充信息', exact: true }).count() === 1 &&
      await workspacePanel.getByRole('tab', { name: '回答依据', exact: true }).getAttribute('aria-selected') === 'true' &&
      await workspacePanel.locator('[role=tab][aria-selected=true] .agent-ws-tab-live[data-state="running"]').count() === 1);
    await workspacePanel.getByRole('tab', { name: '概览', exact: true }).click();
    check('Opening the overview pauses following', await workspacePanel.getByRole('button', { name: '跟随模型', exact: true }).getAttribute('aria-pressed') === 'false' &&
      await workspacePanel.getByRole('tab', { name: '概览', exact: true }).getAttribute('aria-selected') === 'true');
    await workspacePanel.getByRole('button', { name: '跟随模型', exact: true }).click();
    await evidence.waitFor();
    await page.evaluate(() => window.fixture.agentRunStatus('completed'));
    await workspacePanel.locator('[data-workspace-view="results"]').waitFor();
    check('When the followed task ends the overview is shown and the follow control goes away', await workspacePanel.getByRole('tab', { name: '概览', exact: true }).getAttribute('aria-selected') === 'true' &&
      await workspacePanel.getByRole('button', { name: '跟随模型', exact: true }).count() === 0);
    await workspacePanel.getByRole('tab', { name: '回答依据', exact: true }).click();
    await evidence.waitFor();
    check('A call left unfinished by an ended task stops spinning', await evidence.innerText().then(text => text.includes('任务结束时这一步仍未完成')) && await evidence.getByRole('status').count() === 0);
    check('Evidence numbers results, links only HTTP(S) sources and explains an empty search', await evidence.getByRole('link', { name: '庚金论' }).getAttribute('href') === 'https://example.com/gengjin' &&
      await evidence.getByRole('link', { name: '无效链接' }).count() === 0 && await evidence.locator('.agent-ws-source').first().getAttribute('data-evidence') === '1' &&
      await evidence.innerText().then(text => text.includes('知识库没有匹配的段落') && text.includes('检索「不存在的资料」没有找到相关段落')));
    await openProcessStep('加载分析方法');
    await workspacePanel.locator('[data-workspace-view="method"]').waitFor();
    check('A process step opens its versioned read-only method guide', await workspacePanel.innerText().then(text => /版本 \d+\.\d+\.\d+/.test(text) && text.includes('不增加任何执行权限') && text.includes('子平八字')));
    await openProcessStep('八字合盘');
    await workspacePanel.locator('[data-workspace-view="calculation"]').waitFor();
    check('A pairing lists both people and the three relation groups from Core', await workspacePanel.locator('.agent-ws-group').count() === 3 &&
      await workspacePanel.innerText().then(text => text.includes('日主互见') && text.includes('年命纳音') && text.includes('五行互补') && text.includes('女方')));
    const pairingStrip = workspacePanel.locator('.agent-ws-pairing');
    const pairingLines = workspacePanel.locator('.agent-ws-pairing-relations > li');
    const pairingCount = await pairingLines.count();
    await pairingLines.first().hover();
    check('A pairing draws each relation between the two charts on one strip, and pointing at a line lights its arc', pairingCount > 0 &&
      await pairingStrip.locator('[data-relation-cell]').count() === 16 && await pairingStrip.locator('[data-relation-edge]').count() === pairingCount &&
      await pairingStrip.locator('[data-relation-edge][data-lit]').count() === 1 && await pairingLines.first().getAttribute('data-active') === '');
    await workspacePanel.locator('h3').first().hover();
    await openProcessStep('黄历择日筛选');
    await workspacePanel.locator('[data-workspace-view="calculation"]').waitFor();
    check('A date selection names every zodiac it avoids', await workspacePanel.innerText().then(text => text.includes('避冲 丑牛（冲未）、酉鸡（冲卯）')));
    await openProcessStep('推算出生时辰');
    await workspacePanel.locator('[data-workspace-view="calculation"] [aria-label="候选时辰"]').waitFor();
    const hourList = workspacePanel.locator('[aria-label="候选时辰"]');
    check('Hour candidates list every hour of the day, and the longest line wraps inside the workspace', await hourList.locator('li[data-hour-candidate]').count() === 13 &&
      await hourList.locator('li[data-hour-candidate="辰时"]').innerText().then(text => text.includes('辰戌相冲（时支辰·流年支戌）')) &&
      await hourList.evaluate(list => [...list.querySelectorAll('li, small')].every(node => node.scrollWidth <= node.clientWidth + 1) && list.scrollWidth <= list.clientWidth + 1));
    // 检索来源列在调用框里；同样的来源不再在正文下另起一段。
    await openProcessStep('联网检索');
    await page.evaluate(() => window.fixture.searchSource(true));
    await renderBarrier();
    const searchStep = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '联网检索' }) }).last();
    check('A search step lists its sources in place instead of below the message', await results.locator('.agent-source-link').count() === 0 &&
      await searchStep.locator('.agent-step-structured-sources a').count() === 1 &&
      await searchStep.locator('.agent-step-structured-sources a').innerText().then(text => text.includes('庚金论')) &&
      await searchStep.innerText().then(text => !text.includes('已返回结构化结果')));
    await page.evaluate(() => window.fixture.searchSource(false));
    const toolSearchStep = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '查找工具' }) }).last();
    if (await toolSearchStep.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await toolSearchStep.locator('.agent-step-row').click();
    check('A tool search step names the tools it loaded', await toolSearchStep.locator('.agent-step-chips').innerText().then(text => text.includes('六爻逐爻详查') && text.includes('黄历择日筛选')));
    const thought = results.locator('.agent-step--note').filter({ hasText: '思考' }).first();
    check('A thinking row keeps its draft closed until expanded', await thought.locator('.agent-step-row').innerText().then(text => text.trim() === '思考'));
    await thought.locator('.agent-step-row').click();
    check('Expanding a thinking row shows what it thought', await thought.locator('.agent-step-reasoning').innerText().then(text => text.includes('先看命盘')));
    await thought.locator('.agent-step-row').click();
    // 「过程资料」删掉后，读过的笔记与以往对话在过程块里给出具体内容。
    for (const [title, expected] of [['读取每日笔记', '面试顺利'], ['检索以往对话', '2024年我跳槽去了上海']]) {
        const step = results.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: title }) }).last();
        if (await step.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await step.locator('.agent-step-row').click();
        check(`A ${title} step lists what it read instead of only a count`, await step.locator('.agent-step-structured-list').innerText().then(text => text.includes(expected)));
    }
    await openTeamMember('协作分析', '子平');
    await workspacePanel.locator('[data-workspace-view="member"]').waitFor();
    check('Each collaboration member opens its own page with model, effort and focus', await workspacePanel.innerText().then(text => text.includes('子平') && text.includes('推理 高') && text.includes('格局取用')) &&
      await workspacePanel.getByRole('tab', { name: '子平', exact: true }).getAttribute('aria-selected') === 'true');
    await workspacePanel.getByRole('tab', { name: '协作分析', exact: true }).click();
    await workspacePanel.locator('[data-workspace-view="collaboration"]').waitFor();
    check('Collaboration cards show each member model, effort and focus', await workspacePanel.locator('.agent-ws-member').count() === 2 &&
      await workspacePanel.innerText().then(text => text.includes('推理 高') && text.includes('不推理') && text.includes('子平 · 格局取用')) && await workspacePanel.getByRole('region', { name: /分歧对照/ }).count() === 0);
    await openProcessStep('档案检索');
    await workspacePanel.locator('[data-workspace-view="tool"]').waitFor();
    check('External tools show their arguments and raw result with copy actions', await workspacePanel.getByRole('button', { name: '复制调用参数', exact: true }).count() === 1 && await workspacePanel.getByRole('button', { name: '复制工具结果', exact: true }).count() === 1);
    const memoryDeletes = () => requests.filter(item => item.pathname === '/api/user/agent-memory' && item.method === 'DELETE');
    await openProcessStep('记住偏好');
    await workspacePanel.getByRole('button', { name: '删除记忆：历法偏好', exact: true }).click();
    check('Deleting a memory asks for confirmation before any request', memoryDeletes().length === 0);
    await workspacePanel.getByRole('button', { name: '确认删除', exact: true }).click();
    await workspacePanel.getByText('已删除', { exact: true }).waitFor();
    check('A confirmed memory deletion is scoped to the signed-in account', memoryDeletes().length === 1 && memoryDeletes()[0].expectedUserId === 'alice' && memoryDeletes()[0].body?.id === '33333333-3333-4333-8333-333333333333');
    await workspacePanel.getByRole('tab', { name: '概览', exact: true }).click();
    check('The overview keeps results without an evidence card, task summary or a second copy of the process', await workspacePanel.locator('[data-overview-card="evidence"]').count() === 0 &&
      await workspacePanel.innerText().then(text => text.includes('本对话的成果') && !text.includes('过程资料') && !text.includes('依据与定位') && !text.includes('任务摘要') && !text.includes('本任务计费')));
    const familyTabs = await Promise.all(['八字大运', '子平八字', '两派会诊', '子平', '盲派', '档案检索', '长期记忆', '补充信息', '回答依据'].map(name => workspacePanel.getByRole('tab', { name, exact: true }).count()));
    check('Opened and followed family views stay as one tab each', familyTabs.every(count => count === 1));
    await results.getByRole('button', { name: /^依据 \d+/ }).click();
    await workspacePanel.locator('[data-workspace-view="evidence"]').waitFor();
    check('The answer evidence chip opens the numbered sources in the workspace', await results.getByRole('button', { name: /^依据 \d+/ }).innerText().then(text => text.includes('联网 2')));
    await page.evaluate(() => window.fixture.citedAnswer());
    // The number pair is written by the parts updater; wait for React to commit it.
    await page.waitForFunction(() => Array.isArray(window.fixture.cited));
    const [firstCite, secondCite] = await page.evaluate(() => window.fixture.cited);
    const badges = results.locator('.chat-answer .md-cite');
    await badges.first().waitFor();
    check('Answer citations become badges only for numbers its own task returned', (await badges.allInnerTexts()).join(',') === firstCite + ',' + secondCite &&
      await results.locator('.chat-answer').innerText().then(text => text.includes('[' + (secondCite + 7) + ']')));
    await results.getByRole('button', { name: new RegExp('^依据 ' + secondCite + '：') }).click();
    await workspacePanel.locator('[data-evidence="' + secondCite + '"][data-selected]').waitFor();
    // The answer-side highlight commits one render after the source opens.
    await page.waitForFunction(cite => document.querySelector('[data-testid="agent-results"] .md-cite[data-cite="' + cite + '"]')?.getAttribute('data-active') === 'true', secondCite);
    check('A citation opens its source selected, with the answer paragraph that cites it', await workspacePanel.locator('[data-evidence="' + secondCite + '"]').innerText()
      .then(text => text.includes('回答第 2 段引用') && text.includes('《子平真诠》论用神') && text.includes('知识库 · 命理古籍 · 语义检索命中')) &&
      await results.locator('.md-cite[data-cite="' + secondCite + '"]').getAttribute('data-active') === 'true');
    await workspacePanel.getByRole('button', { name: /^知识库 \d+$/ }).click();
    check('Filtering the evidence keeps only one kind of source', await workspacePanel.locator('[data-evidence][data-kind="web"]').count() === 0 &&
      await workspacePanel.locator('[data-evidence][data-kind="knowledge"]').count() === 2 && await workspacePanel.getByRole('button', { name: /^知识库 \d+$/ }).getAttribute('aria-pressed') === 'true');
    await workspacePanel.getByRole('tab', { name: '两派会诊', exact: true }).click();
    await workspacePanel.locator('[data-workspace-view="collaboration"]').waitFor();
    check('The collaboration view compares its members in the workspace', await workspacePanel.locator('.agent-ws-member').count() === 2 &&
      await workspacePanel.locator('.agent-ws-member').first().innerText().then(text => text.includes('分析模型') && text.includes('推理 高')) &&
      await workspacePanel.locator('.agent-ws-member').last().innerText().then(text => text.includes('复核模型') && text.includes('不推理')));
    // The archive: notes and earlier conversations open their pages; a recorded event and a save card stay under the answer.
    await openProcessStep('读取每日笔记');
    const notesPage = workspacePanel.locator('[data-workspace-view="notes"]');
    await notesPage.waitFor();
    check('Daily notes open their own page with date, mood and text, and say that older notes were not read', await notesPage.innerText().then(text =>
      text.includes('2026-10-02') && text.includes('开心') && text.includes('面试顺利，下周入职。') && text.includes('更早的笔记没有读取。')));
    await openProcessStep('检索以往对话');
    const conversationsPage = workspacePanel.locator('[data-workspace-view="history"]');
    await conversationsPage.waitFor();
    check('An earlier conversation opens at the message the search matched, with the answer it got',
      await conversationsPage.getByRole('link', { name: '跳槽的事', exact: true }).getAttribute('href') === '/chat?id=conversation-earlier&message=earlier-question' &&
      await conversationsPage.innerText().then(text => text.includes('你的提问') && text.includes('2024年我跳槽去了上海') && text.includes('回答：从流年看，这次跳槽顺利。')));
    const archiveCard = results.locator('.agent-archive-card');
    const eventReceipt = results.locator('.agent-archive-receipt');
    check('A save card and a recorded event stay under the answer, outside the folded steps', await archiveCard.count() === 1 &&
      await eventReceipt.innerText().then(text => text.includes('已按你的原话记入命理记录：2024-03-01 · 事业 · 换到新公司')) &&
      await eventReceipt.getByRole('link', { name: '查看', exact: true }).getAttribute('href') === '/records?id=44444444-4444-4444-8444-444444444444');
    const saveButton = archiveCard.getByRole('button', { name: '保存', exact: true });
    await saveButton.waitFor();
    check('A pending card names what it would save and where', await archiveCard.innerText().then(text =>
      text.includes('保存结论') && text.includes('命理记录') && text.includes('明年换岗 · 待验证（2027-06-01）') && text.includes('官星透出')));
    await saveButton.click();
    const savedLink = archiveCard.getByRole('link', { name: '已保存 · 查看', exact: true });
    await savedLink.waitFor();
    const archiveSaves = await page.evaluate(() => window.fixtureAgentIO.requests.filter(item => item.url === '/api/agent/runs/run-family/archive' && item.method === 'POST').map(item => item.body));
    check('Saving posts only the call ID and turns the card into a link to what was saved', JSON.stringify(archiveSaves) === JSON.stringify([{ callId: 'family-propose' }]) &&
      await savedLink.getAttribute('href') === '/records?id=55555555-5555-4555-8555-555555555555');
    await openProcessStep('生成保存卡片');
    const archivePage = workspacePanel.locator('[data-workspace-view="archive"]');
    await archivePage.waitFor();
    check('The archive page lists the recorded event and the card in call order, the card already saved', await archivePage.locator('.agent-archive-list > *').count() === 2 &&
      await archivePage.locator('.agent-archive-list > :first-child').evaluate(node => node.classList.contains('agent-archive-receipt')) &&
      await archivePage.getByRole('link', { name: '已保存 · 查看', exact: true }).count() === 1);
    // Code mode: a script is one step whose calls are its sub-steps; its page lists every call in order.
    await page.evaluate(() => window.fixture.codemodeScript());
    // The script follows the answer, so it opens a process group of its own; a settled task leaves it folded.
    const scriptGroup = results.locator('.agent-activity-group').filter({ hasText: '已运行 1 个脚本' });
    const scriptHeading = scriptGroup.locator('.agent-process-heading');
    await scriptHeading.waitFor();
    if (await scriptHeading.getAttribute('aria-expanded') !== 'true') await scriptHeading.click();
    const scriptStep = scriptGroup.locator('.agent-process-steps > .agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '运行脚本' }) });
    await scriptStep.waitFor();
    check('A script is one process step that counts its calls and its failures', await scriptStep.locator('.agent-step-row').innerText().then(text => text.includes('调用 3 次 · 1 次失败')) &&
      await scriptGroup.locator('.agent-process-steps > .agent-step').count() === 1);
    if (await scriptStep.locator('.agent-step-row').first().getAttribute('aria-expanded') !== 'true') await scriptStep.locator('.agent-step-row').first().click();
    check('An opened script step shows the code the model wrote', await scriptStep.locator('.agent-step-script').innerText() === 'for (const birthYear of [1990, 1991]) await tools.bazi({ birthYear });');
    check('An opened script step shows what the script printed', await scriptStep.getByLabel('脚本输出').innerText().then(text => text.includes('1990: 己巳') && text.includes('1991: 庚午')));
    check('An opened script step lists its calls as sub-steps', await scriptStep.locator('ol[aria-label="脚本调用"] > .agent-step').count() === 2);
    await scriptStep.locator('.agent-step-workspace').first().click();
    const scriptPage = workspacePanel.locator('[data-workspace-view="code"]');
    await scriptPage.waitFor();
    const scriptCalls = scriptPage.locator('.agent-ws-script-calls > li');
    check('The script page lists every call in order; a call that never ran says why and opens nothing', await scriptCalls.count() === 3 &&
      await scriptCalls.locator('button').count() === 2 && await scriptCalls.nth(2).innerText().then(text => text.includes('未执行') && text.includes('Tool call blocked')) &&
      await scriptPage.getByRole('button', { name: '复制脚本', exact: true }).count() === 1);
    await scriptCalls.first().locator('button').click();
    await workspacePanel.locator('[data-workspace-view="chart"]').waitFor();
    check('A call on the script page opens the chart it computed', await workspacePanel.locator('[data-workspace-view="chart"]').count() === 1);
    await workspacePanel.getByRole('button', { name: '关闭工作区', exact: true }).click();
    // Plan mode: the approved plan reads as Markdown and the step says what the user decided.
    await page.evaluate(() => window.fixture.planStep());
    const planGroup = results.locator('.agent-activity-group').filter({ hasText: '提交计划' });
    const planHeading = planGroup.locator('.agent-process-heading');
    await planHeading.waitFor();
    if (await planHeading.getAttribute('aria-expanded') !== 'true') await planHeading.click();
    const planStep = planGroup.locator('.agent-process-steps > .agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '提交计划' }) }).last();
    if (await planStep.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await planStep.locator('.agent-step-row').click();
    check('An approved plan shows the plan as Markdown, with the decision on the step row', await planStep.getByLabel('计划', { exact: true }).innerText().then(text => text.includes('分析计划') && text.includes('先排八字')) &&
      await planStep.locator('.agent-step-detail').innerText().then(text => text.includes('已批准')));
    await planStep.getByRole('button', { name: '查看计划', exact: true }).click();
    await workspacePanel.locator('[data-workspace-view="plan"]').waitFor();
    check('The plan page renders every submission as Markdown, newest first, with its decision', await workspacePanel.locator('.agent-ws-plan-draft').count() === 2 &&
      await workspacePanel.innerText().then(text => text.includes('先排八字，再看紫微') && text.includes('第 1 次提交 · 要求修改') && text.includes('你的意见：加上紫微一起看') && !text.includes('\\n')));
    await workspacePanel.getByRole('button', { name: '关闭工作区', exact: true }).click();
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.evaluate(() => window.fixture.mount.results(false));

    // Chat sidebar: dated conversations with task markers, notices read on open, folding to the rail.
    const sidebarIds = [1, 2, 3, 4].map(n => '5a1d0000-0000-4000-8000-00000000000' + n);
    const sidebarNotice = '5a1d0000-0000-4000-8000-0000000000b1';
    rows.alice = [['明年适合换工作吗？', 0], ['我的日主适合什么颜色', 0], ['和女朋友合盘，明年适合结婚吗', 1], ['梦见掉牙是什么意思', 40]].map(([title, days], index) => {
      const at = new Date(Date.now() - days * 86400000).toISOString();
      // has_agent_run：这三条都挂着 Agent 任务，列表在 Agent 方式下要能看见它们。
      return { id: sidebarIds[index], user_id: 'alice', personality: 'general', title, created_at: at, updated_at: at, source_type: 'chat', has_agent_run: true };
    });
    await page.getByRole('button', { name: 'Refresh actual list' }).click();
    await until(id => window.fixture.list().length === 4 && window.fixture.list()[0].id === id, sidebarIds[0]);
    await page.evaluate(([ids, notice]) => {
      window.fixtureAgentIO.activity = { runs: [{ runId: '5a1d0000-0000-4000-8000-0000000000a1', conversationId: ids[0], status: 'running' }, { runId: '5a1d0000-0000-4000-8000-0000000000a2', conversationId: ids[2], status: 'awaiting_input' }],
        notices: [{ id: notice, conversationId: ids[1], status: 'completed' }] };
      history.pushState(null, '', '/chat'); window.dispatchEvent(new Event('fixture:navigate'));
      window.fixture.mount.sidebar(true);
    }, [sidebarIds, sidebarNotice]);
    // /chat renders the site sidebar; its 最近 list keeps the dated groups.
    // The fixture stylesheet ships no responsive variants, so the site sidebar's
    // `hidden lg:flex` never expands here; force it visible for the desktop checks.
    await page.addStyleTag({ content: 'aside[class*="lg:flex"] { display: flex !important; }' });
    const sidebar = page.getByRole('complementary');
    await sidebar.getByText('待回答', { exact: true }).waitFor();
    const sidebarRow = title => sidebar.locator('[data-conversation-row]').filter({ hasText: title });
    check('The site sidebar lists /chat conversations under one 最近使用 section', (await sidebar.getByRole('heading').allInnerTexts()).join() === '' && await sidebar.getByText('最近使用', { exact: true }).count() === 1);
    check('Sidebar rows mark a running task and a waiting question; finished answers only toast', await sidebarRow('明年适合换工作吗？').getByRole('img', { name: 'Agent 正在执行' }).count() === 1 &&
      await sidebarRow('和女朋友合盘').getByText('待回答', { exact: true }).count() === 1 && await sidebarRow('我的日主适合什么颜色').locator('.chat-nav-marker').count() === 0 &&
      await sidebarRow('梦见掉牙').locator('.chat-nav-marker').count() === 0);
    check('On the new-chat page 新聊天 is the current item', await sidebar.getByRole('link', { name: '新聊天' }).getAttribute('aria-current') === 'page' &&
      await sidebar.getByRole('button', { name: '搜索', exact: true }).count() === 1);
    const modeSwitch = sidebar.getByRole('radiogroup', { name: '对话方式' });
    await modeSwitch.getByRole('radio', { name: '对话', exact: true }).hover();
    const plainTip = await modeSwitch.page().getByRole('tooltip').last().innerText().catch(() => '');
    await modeSwitch.getByRole('radio', { name: 'Agent', exact: true }).hover();
    const agentTip = await modeSwitch.page().getByRole('tooltip').last().innerText().catch(() => '');
    check('The 对话 / Agent switch only names itself on hover, with no long description', JSON.stringify([plainTip, agentTip]) === JSON.stringify(['对话', 'Agent']) &&
      (await modeSwitch.getByRole('radio').evaluateAll(nodes => nodes.every(node => !node.hasAttribute('title')))));
    const activityReads = () => page.evaluate(() => window.fixtureAgentIO.requests.filter(item => item.url === '/api/agent/activity').length);
    const readsBefore = await activityReads();
    await page.evaluate(() => window.dispatchEvent(new Event('taibu:agent-activity')));
    await until(count => window.fixtureAgentIO.requests.filter(item => item.url === '/api/agent/activity').length > count, readsBefore);
    check('A task change on the page re-reads the markers at once', await activityReads() > readsBefore);
    await sidebarRow('我的日主适合什么颜色').getByRole('link').click();
    for (let attempt = 0; attempt < 200 && !requests.some(item => item.pathname === '/api/notifications' && item.method === 'PATCH'); attempt++) await page.waitForTimeout(10);
    const noticeRead = requests.find(item => item.pathname === '/api/notifications' && item.method === 'PATCH');
    await page.evaluate(() => { window.fixtureAgentIO.activity.notices = []; });
    check('Opening a conversation reads its unread task notice and clears the dot', noticeRead?.body?.action === 'mark-selected' && noticeRead.body.ids.join() === sidebarNotice &&
      await sidebarRow('我的日主适合什么颜色').getByRole('img', { name: '任务已完成，有新回答' }).count() === 0 &&
      await sidebarRow('我的日主适合什么颜色').getByRole('link').getAttribute('aria-current') === 'page');
    await sidebar.getByRole('button', { name: '打开公告中心' }).click();
    check('The sidebar keeps the announcement center entry', await page.evaluate(() => window.fixture.announcementCenter === 1));
    check('The chat route shows the site sidebar without the old fold rail', await sidebar.getByRole('button', { name: '收起侧栏' }).count() === 0 &&
      await page.locator('.chat-nav.is-rail').count() === 0);
    // An art-of-divination route renders the same sidebar grouped by source type;
    // its rows must be the identical .chat-nav-row component used under /chat.
    await page.evaluate(() => { history.pushState(null, '', '/bazi'); window.dispatchEvent(new Event('fixture:navigate')); });
    await page.waitForFunction(() => !document.querySelector('.chat-nav-group'));
    check('占术路由下侧栏改用类型分组，行与 /chat 完全同款', await sidebar.locator('.chat-nav-row').count() === 4 &&
      await sidebarRow('明年适合换工作吗？').locator('.chat-nav-row-link').count() === 1 &&
      await sidebarRow('明年适合换工作吗？').getByRole('link').getAttribute('href') === '/chat?id=' + sidebarIds[0] &&
      await sidebar.locator('.chat-nav-row[data-active]').count() === 0 &&
      await sidebar.locator('.chat-nav-marker').count() === 0);
    await page.evaluate(() => { window.fixture.sidebarSearch = 0; window.addEventListener('taibu:search', () => { window.fixture.sidebarSearch++; }); });
    await sidebar.getByRole('button', { name: '搜索', exact: true }).click();
    check('搜索 opens the global conversation search', await page.evaluate(() => window.fixture.sidebarSearch === 1));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.fixture.mount.sidebar(false));

    // 侧栏切换点 Agent：进入 /chat 时带 ?mode=agent（夹具里只看 URL 与选中态）。
    await page.evaluate(() => window.fixture.mount.sidebar(true));
    await page.addStyleTag({ content: 'aside[class*="lg:flex"] { display: flex !important; }' });
    const agentSwitch = page.getByRole('complementary').getByRole('radiogroup', { name: '对话方式' });
    await agentSwitch.getByRole('radio', { name: 'Agent', exact: true }).click();
    for (let attempt = 0; attempt < 100 && !page.url().includes('mode=agent'); attempt++) await page.waitForTimeout(10);
    check('Choosing Agent on another page enters /chat with ?mode=agent', page.url().endsWith('/chat?mode=agent') &&
      await agentSwitch.getByRole('radio', { name: 'Agent', exact: true }).getAttribute('aria-checked') === 'true');
    await page.evaluate(() => window.fixture.mount.sidebar(false));

    // Phones: ≡ in the conversation header opens the same sidebar as a drawer in the top layer.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.fixture.mount.phoneDrawer(true));
    const drawerTrigger = page.getByRole('button', { name: '打开聊天列表', exact: true });
    await drawerTrigger.click();
    const phoneDrawer = page.getByRole('dialog', { name: '聊天列表', exact: true });
    await phoneDrawer.getByText('待回答', { exact: true }).waitFor();
    check('The phone drawer is the sidebar: one 最近使用 list, task markers and its entries', (await phoneDrawer.getByRole('heading').allInnerTexts()).join() === '聊天列表' &&
      await phoneDrawer.locator('[data-conversation-row]').filter({ hasText: '明年适合换工作吗？' }).getByRole('img', { name: 'Agent 正在执行' }).count() === 1 &&
      await phoneDrawer.getByRole('link', { name: '新对话' }).count() === 1 && await phoneDrawer.getByRole('button', { name: '关闭聊天列表', exact: true }).count() === 1 &&
      await phoneDrawer.getByRole('button', { name: '收起侧栏' }).count() === 0);
    const drawerRowMore = phoneDrawer.getByRole('button', { name: '更多操作', exact: true }).first();
    await drawerRowMore.click();
    const drawerMenu = phoneDrawer.getByRole('menu', { name: '会话操作', exact: true });
    await drawerMenu.waitFor();
    check('Row actions open inside the drawer and keep it open', await drawerMenu.evaluate(element => element.closest('dialog')?.open === true) && await phoneDrawer.isVisible());
    await page.keyboard.press('Escape');
    await drawerMenu.waitFor({ state: 'hidden' });
    check('The first Escape closes only the row menu', await phoneDrawer.isVisible() && await drawerRowMore.evaluate(element => element === document.activeElement));
    await page.keyboard.press('Escape');
    await phoneDrawer.waitFor({ state: 'hidden' });
    check('Closing the drawer returns focus to ≡', await drawerTrigger.evaluate(element => element === document.activeElement));
    await drawerTrigger.click();
    await phoneDrawer.locator('[data-conversation-row]').filter({ hasText: '梦见掉牙' }).getByRole('link').click();
    await phoneDrawer.waitFor({ state: 'hidden' });
    check('Choosing a conversation navigates and closes the drawer', await page.evaluate(id => new URLSearchParams(location.search).get('id') === id, sidebarIds[3]));
    await page.evaluate(() => window.fixture.mount.phoneDrawer(false));
    await page.setViewportSize({ width: 1200, height: 1000 });

    // Focus and arrow keys pass over menu items that are not laid out at this width.
    await page.evaluate(() => window.fixture.mount.menu(true));
    await page.getByRole('button', { name: 'Open fixture menu', exact: true }).click();
    await page.getByRole('menu', { name: 'Fixture menu', exact: true }).waitFor();
    await until(() => document.activeElement?.textContent === 'Visible first');
    await page.keyboard.press('ArrowDown');
    const belowFirst = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('ArrowUp');
    check('Menus skip items hidden at this width for the first focus and arrow keys', belowFirst === 'Visible last' &&
      await page.evaluate(() => document.activeElement?.textContent) === 'Visible first');
    await page.keyboard.press('Escape');
    // A reopened menu is laid out at once: focus moved into it before its first frame is not taken back.
    check('Focus moved into a reopened menu before its first frame stays there', await page.evaluate(async () => {
      document.querySelector('[data-testid="menu-probe"] > button').click();
      const menu = () => document.querySelector('[role="menu"][aria-label="Fixture menu"]');
      for (let turn = 0; turn < 20 && !menu(); turn++) await Promise.resolve();
      const last = [...menu().querySelectorAll('button')].find(button => button.textContent === 'Visible last');
      last.focus();
      const moved = document.activeElement === last;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return moved && document.activeElement === last;
    }));
    await page.keyboard.press('Escape');
    // claude 菜单字母键：菜单项 <kbd> 标注的字母直接执行该项。
    await page.getByRole('button', { name: 'Open fixture menu', exact: true }).click();
    await page.getByRole('menu', { name: 'Fixture menu', exact: true }).waitFor();
    await until(() => document.activeElement?.textContent === 'Visible first');
    await page.keyboard.press('r');
    await page.getByRole('menu', { name: 'Fixture menu', exact: true }).waitFor({ state: 'hidden' });
    check('A letter key runs the menu item whose shortcut it shows', await page.evaluate(() => window.fixture.menuShortcut) === 'rename');
    await page.evaluate(() => window.fixture.mount.menu(false));

    // Earlier Agent rounds stay in the transcript: nothing folds a whole exchange into one line.
    await page.evaluate(() => window.fixture.mount.rounds(true));
    const roundsProbe = page.getByTestId('rounds');
    await roundsProbe.locator('[data-message-id="round-a1"]').waitFor();
    const roundRows = () => roundsProbe.evaluate(probe => [...probe.querySelectorAll('[data-message-id]')].map(row => row.dataset.messageId).join());
    check('An earlier Agent round keeps its question, steps and answer in place', await roundsProbe.locator('.agent-round-fold').count() === 0 &&
      await roundRows() === 'round-u1,round-a1,round-u2,round-a2' &&
      await roundsProbe.getByText('2027 丁未年适合变动。', { exact: true }).count() === 1);
    const located = async id => {
      const found = await page.evaluate(target => window.fixture.rounds.locate(target), id);
      await page.waitForTimeout(100);
      return found && await roundsProbe.evaluate((probe, target) => {
        const row = probe.querySelector('[data-message-id="' + target + '"]');
        const scroller = probe.querySelector('.chat-virtual-scroller, [data-scroller]');
        return Boolean(row && scroller) && Math.abs(row.getBoundingClientRect().top - scroller.getBoundingClientRect().top) < 40;
      }, id);
    };
    check('Jumping to a message in an earlier round scrolls to it', await located('round-a1'));
    await page.evaluate(() => window.fixture.rounds.setVirtual(true));
    await until(() => document.querySelectorAll('[data-testid=rounds] [data-index]').length === 4);
    check('The long-conversation list keeps every round visible', await roundsProbe.evaluate(probe => [...probe.querySelectorAll('[data-index]')].every(row => !row.hidden)) &&
      await roundsProbe.evaluate(probe => [...probe.querySelectorAll('[data-message-id]')].map(row => row.dataset.messageId).join()) === 'round-u1,round-a1,round-u2,round-a2');
    check('The long-conversation list also scrolls to an earlier round', await located('round-a1'));
    await page.evaluate(() => window.fixture.rounds.append({ id: 'round-u3', role: 'user', content: '那 2028 年呢？', createdAt: '2026-10-12T09:00:00.000Z' }));
    await until(() => document.querySelectorAll('[data-testid=rounds] [data-index]').length === 5);
    check('A new question appends to the transcript instead of folding the round before it', await roundsProbe.evaluate(probe => [...probe.querySelectorAll('[data-message-id]')].map(row => row.dataset.messageId).join()) === 'round-u1,round-a1,round-u2,round-a2,round-u3' &&
      await roundsProbe.locator('.agent-round-fold').count() === 0);
    await page.evaluate(() => window.fixture.mount.rounds(false));

    // Chat polish (1.A) on the real message list.
    await page.evaluate(() => window.fixture.mount.polish(true));
    const polish = page.getByTestId('polish');
    await polish.locator('[data-message-id="polish-a1"]').waitFor();
    const assistantGroups = polish.getByRole('group', { name: '助手消息操作', exact: true });
    check('Only a saved reply offers a fork; a local failure notice does not', await assistantGroups.nth(0).getByRole('button', { name: '从此回答分叉', exact: true }).count() === 1 &&
      await assistantGroups.nth(1).getByRole('button', { name: '从此回答分叉', exact: true }).count() === 0);
    check('Answer links: external opens a new tab without opener, in-app stays', await polish.evaluate(probe => {
      const external = probe.querySelector('a[href="https://example.com/a"]');
      const internal = probe.querySelector('a[href="/records"]');
      return external?.target === '_blank' && external.rel === 'noopener noreferrer' && internal && !internal.hasAttribute('target');
    }));
    const webToggle = polish.getByRole('button', { name: '联网搜索参考了 2 个网页', exact: true });
    check('A plain chat answer folds the pages its web search returned behind their count', await webToggle.getAttribute('aria-expanded') === 'false' &&
      await polish.locator('a[href="https://example.com/almanac"]').count() === 0);
    await webToggle.click();
    check('Unfolded, each web page links out once in a new tab; a script address is dropped', await polish.evaluate(probe => {
      const links = [...probe.querySelectorAll('[data-message-id="polish-a1"] ol a')];
      return links.length === 2 && links.every(link => link.target === '_blank' && link.rel === 'noopener noreferrer') &&
        links[0].textContent === '黄历 说明example.com' && links[1].getAttribute('href') === 'http://example.org/x' && !probe.querySelector('a[href^="javascript:"]');
    }) && await webToggle.getAttribute('aria-expanded') === 'true');
    check('A web search that failed is stated under its answer', (await polish.locator('[data-message-id="polish-a2"]').innerText()).includes('联网搜索未能完成，本次回答没有参考网页'));
    await page.evaluate(() => { window.fixture.copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.fixture.copied.push(text); } } }); });
    const codeHead = polish.locator('.markdown-code-head');
    await codeHead.getByRole('button', { name: '复制代码', exact: true }).click();
    await codeHead.getByRole('button', { name: '已复制代码', exact: true }).waitFor();
    check('Code blocks show their language and copy the code with a check mark', (await codeHead.innerText()).trim() === 'ts' &&
      JSON.stringify(await page.evaluate(() => window.fixture.copied)) === JSON.stringify(['const answer = 42;']));
    const firstUser = polish.locator('[data-message-id="polish-u1"]');
    await firstUser.getByRole('button', { name: '编辑消息', exact: true }).click();
    const editBox = polish.locator('.chat-user-edit');
    const editInput = editBox.getByRole('textbox', { name: '编辑消息内容', exact: true });
    await editInput.press('Escape');
    check('Esc cancels the inline edit', await editBox.count() === 0);
    await firstUser.getByRole('button', { name: '编辑消息', exact: true }).click();
    await editInput.fill('改写');
    await editInput.press('Shift+Enter');
    await page.keyboard.insertText('第二行');
    const editButtons = (await editBox.getByRole('button').allInnerTexts()).map(text => text.trim()).join();
    const savedBeforeEnter = await page.evaluate(() => window.fixture.polish.edits.length);
    await editInput.press('Enter');
    await editBox.waitFor({ state: 'hidden' });
    check('Inline edit: Shift+Enter adds a line, Enter saves; buttons read 取消 / 保存', editButtons === '取消,保存' && savedBeforeEnter === 0 &&
      JSON.stringify(await page.evaluate(() => window.fixture.polish.edits)) === JSON.stringify([['polish-u1', '改写\n第二行']]));
    await page.evaluate(() => window.fixture.polish.setDisabled(true));
    await until(() => !document.querySelector('[data-testid=polish] [aria-label="编辑消息"]'));
    check('A locked transcript (answer generating) offers no edit, regenerate or fork', await polish.getByRole('button', { name: /^(编辑消息|重新生成|从此回答分叉|退回)$/ }).count() === 0 &&
      await polish.getByRole('button', { name: '复制消息', exact: true }).count() === 4);
    await page.evaluate(() => window.fixture.mount.polish(false));

    // Public share link: create with the chart opt-in, refresh in place, lock during a task, then revoke from settings.
    await page.evaluate(() => window.fixture.mount.share(true));
    const shareMenu = page.getByRole('menu', { name: '分享' });
    const sharePosts = () => requests.filter(entry => entry.pathname === '/api/conversations/share-fixture/share' && entry.method === 'POST');
    await shareMenu.getByRole('menuitem', { name: '创建公开链接' }).waitFor();
    check('Without a link the share menu offers creation above the export actions',
      (await shareMenu.getByRole('menuitem').allInnerTexts()).map(text => text.trim()).join('|') === '创建公开链接|导出 Markdown|导出 HTML');
    await shareMenu.getByLabel('包含命盘与工具结果').check();
    await shareMenu.getByRole('menuitem', { name: '创建公开链接' }).click();
    await shareMenu.getByRole('menuitem', { name: '复制公开链接' }).waitFor();
    check('Creating posts the chart opt-in once and switches to link management',
      sharePosts().length === 1 && sharePosts()[0].body?.includeCharts === true &&
      (await shareMenu.getByRole('menuitem').allInnerTexts()).map(text => text.trim()).join('|') === '复制公开链接|更新链接|删除链接|导出 Markdown|导出 HTML');
    await shareMenu.getByRole('menuitem', { name: '更新链接' }).click();
    await until(() => document.body.innerText.includes('公开链接已更新为当前对话'));
    check('Refreshing re-posts the snapshot and keeps the existing link', sharePosts().length === 2 && await shareMenu.getByRole('menuitem', { name: '复制公开链接' }).isVisible());
    await page.evaluate(() => window.fixture.shareBusy(true));
    await until(() => document.body.innerText.includes('任务进行中，完成后可以分享。'));
    check('A running task locks refreshing while copy stays available',
      await shareMenu.getByRole('menuitem', { name: '更新链接' }).isDisabled() && !await shareMenu.getByRole('menuitem', { name: '复制公开链接' }).isDisabled());
    await page.evaluate(() => window.fixture.shareBusy(false));
    await page.evaluate(() => window.fixture.mount.share(false));
    await page.evaluate(() => { history.replaceState(null, '', '#settings/shares'); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const shareDelete = page.getByRole('button', { name: '删除「分享夹具对话」的公开链接' });
    await shareDelete.waitFor();
    check('The settings center lists the active link with its public address',
      await page.getByRole('link', { name: '打开「分享夹具对话」的公开页面' }).getAttribute('href') === '/share/' + 'S'.repeat(43));
    await shareDelete.click();
    await page.getByRole('button', { name: '删除链接', exact: true }).click();
    await page.getByText('还没有公开分享的对话', { exact: true }).waitFor();
    check('Deleting from settings revokes the link and shows the empty state',
      requests.some(entry => entry.pathname === '/api/conversations/share-fixture/share' && entry.method === 'DELETE'));

    {
    await page.evaluate(() => { history.replaceState(null, '', '/chat'); window.dispatchEvent(new Event('fixture:navigate')); window.fixture.mount.share(true); });
    await shareMenu.getByRole('menuitem', { name: '创建公开链接' }).waitFor();
    const initialShareFailure = holdNext('/api/conversations/retry-a/share', 'GET');
    initialShareFailure.fail = true;
    await page.evaluate(() => window.fixture.shareConversation('retry-a'));
    await intercepted(initialShareFailure); initialShareFailure.release();
    await shareMenu.getByRole('menuitem', { name: '重试', exact: true }).waitFor();
    const oldShareRetry = holdNext('/api/conversations/retry-a/share', 'GET');
    await shareMenu.getByRole('menuitem', { name: '重试', exact: true }).click();
    await intercepted(oldShareRetry);
    await page.evaluate(() => window.fixture.shareConversation('retry-b'));
    await shareMenu.getByRole('menuitem', { name: '复制公开链接' }).waitFor();
    oldShareRetry.release(); await renderBarrier();
    await shareMenu.getByRole('menuitem', { name: '复制公开链接' }).click();
    check('A held retry from conversation A cannot replace the share link of conversation B', (await page.evaluate(() => window.fixture.copied.at(-1))).endsWith('/share/' + 'B'.repeat(43)));
    await page.evaluate(() => window.fixture.mount.share(false));

    const activityReads = () => page.evaluate(() => window.fixtureAgentIO.requests.filter(request => request.url === '/api/agent/activity').length);
    const beforeActivity = await activityReads();
    await page.evaluate(() => window.fixture.mount.activity(true));
    await page.getByTestId('activity-one').waitFor(); await renderBarrier();
    check('Two activity consumers share one initial poll', await activityReads() === beforeActivity + 1);
    const beforeWake = await activityReads();
    await page.evaluate(() => window.fixture.refreshActivity()); await renderBarrier();
    check('An activity refresh wakes one poller for all mounted consumers', await activityReads() === beforeWake + 1);
    await page.evaluate(() => window.fixture.mount.activity(false));

    await page.evaluate(() => { window.fixtureAuth.change('alice'); }); await renderBarrier();
    await page.evaluate(() => { window.fixture.seedTarot(); window.fixture.mount.tarot(true); });
    const tarotResult = page.getByTestId('tarot-result');
    await tarotResult.getByRole('button', { name: '保存', exact: true, includeHidden: true }).waitFor({ state: 'attached' });
    const oldTarotSave = holdNext('/api/tarot', 'POST');
    await tarotResult.getByRole('button', { name: '保存', exact: true, includeHidden: true }).evaluate(button => button.click());
    await intercepted(oldTarotSave);
    await page.evaluate(() => window.fixtureAuth.change('bob')); await renderBarrier();
    oldTarotSave.release(); await renderBarrier();
    check('A Tarot save receipt from the old account cannot mark the new account saved', await page.evaluate(() => {
      const result = JSON.parse(sessionStorage.getItem('tarot_result'));
      return result.recordOwnerId === 'bob' && !result.readingId && !result.conversationId;
    }));
    await tarotResult.getByRole('button', { name: '保存', exact: true, includeHidden: true }).evaluate(button => button.click());
    await until(() => JSON.parse(sessionStorage.getItem('tarot_result')).readingId === 'bob-tarot');
    check('The new account can save its own Tarot reading after an old receipt is discarded', await page.evaluate(() => JSON.parse(sessionStorage.getItem('tarot_result')).recordOwnerId === 'bob'));
    await page.evaluate(() => { window.fixture.mount.tarot(false); window.fixture.seedQimen(); window.fixture.mount.qimen(true); });
    await until(() => JSON.parse(sessionStorage.getItem('qimen_result')).chartId === 'bob-qimen');
    check('Qimen does not inherit another account’s saved chart ID', await page.evaluate(() => JSON.parse(sessionStorage.getItem('qimen_result')).recordOwnerId === 'bob'));
    await page.evaluate(() => window.fixture.mount.qimen(false));
    await page.evaluate(() => { window.fixtureAuth.change('alice'); history.replaceState(null, '', '/records?id=record-general'); window.dispatchEvent(new Event('fixture:navigate')); window.fixture.mount.records(true); });
    await until(() => document.querySelector('input[placeholder="例如：九月面试结果与卦象一致"]')?.value === 'General saved record');
    await page.evaluate(() => { history.pushState(null, '', '/records?id=record-event'); window.dispatchEvent(new Event('fixture:navigate')); });
    const currentEventTitle = records.find(record => record.id === 'record-event').title;
    await page.waitForFunction(title => document.querySelector('input[placeholder="例如：九月面试结果与卦象一致"]')?.value === title, currentEventTitle);
    check('A second records deep link replaces the editor while the page stays mounted', await page.getByRole('dialog').getByLabel('标题', { exact: true }).inputValue() === currentEventTitle);
    await page.evaluate(() => window.fixture.mount.records(false));

    const oldAnnual = holdNext('/api/annual-report', 'GET');
    await page.evaluate(() => window.fixture.mount.annual(true)); await intercepted(oldAnnual);
    await page.evaluate(() => window.fixtureAuth.change('bob'));
    const annual = page.getByTestId('annual-report');
    await annual.getByText(String(22222 + new Date().getFullYear()), { exact: true }).waitFor();
    oldAnnual.release(); await renderBarrier();
    check('An old account’s annual report cannot replace the current account’s report', await annual.getByText(String(11111 + new Date().getFullYear()), { exact: true }).count() === 0);
    const oldYear = holdNext('/api/annual-report', 'GET');
    await annual.getByRole('button', { name: '刷新年度报告' }).click(); await intercepted(oldYear);
    await annual.locator('select').last().selectOption('2024');
    await annual.getByText(String(22222 + 2024), { exact: true }).waitFor();
    oldYear.release(); await renderBarrier();
    check('A slower annual report response cannot overwrite a newer selected year', await annual.getByText(String(22222 + new Date().getFullYear()), { exact: true }).count() === 0);
    await page.evaluate(() => { window.fixture.mount.annual(false); window.fixture.mount.community(true); });
    const community = page.getByTestId('community');
    await community.getByRole('heading', { name: '检索 初始' }).waitFor();
    const oldPosts = holdNext('/api/community/posts', 'GET');
    await community.getByPlaceholder('搜索感兴趣的话题...').fill('旧查询'); await intercepted(oldPosts);
    await community.getByPlaceholder('搜索感兴趣的话题...').fill('新查询');
    await community.getByRole('heading', { name: '检索 新查询' }).waitFor();
    oldPosts.release(); await renderBarrier();
    check('Community filtering retains the newest result when old requests finish later', await community.getByRole('heading', { name: '检索 旧查询' }).count() === 0);
    await page.evaluate(() => { window.fixture.mount.community(false); window.fixtureAuth.change('alice'); history.pushState(null, '', '/community/old-post'); window.dispatchEvent(new Event('fixture:navigate')); });
    const oldPost = holdNext('/api/community/posts/old-post', 'GET');
    await page.evaluate(() => window.fixture.mount.post(true)); await intercepted(oldPost);
    await page.evaluate(() => { history.pushState(null, '', '/community/new-post'); window.dispatchEvent(new Event('fixture:navigate')); });
    const post = page.getByTestId('community-post');
    await post.getByRole('heading', { name: '讨论 new-post' }).waitFor();
    await post.getByTitle('编辑', { exact: true }).waitFor();
    oldPost.release(); await renderBarrier();
    check('A previous post response cannot replace the newly selected post', await post.getByRole('heading', { name: '讨论 old-post' }).count() === 0);
    await page.evaluate(() => window.fixtureAuth.change('bob'));
    await post.getByRole('heading', { name: '讨论 new-post' }).waitFor(); await renderBarrier();
    check('Switching accounts clears the previous community author’s edit controls', await post.getByTitle('编辑', { exact: true }).count() === 0);
    await page.evaluate(() => window.fixture.mount.post(false));

    for (const name of ['meihua', 'xiaoliuren', 'daliuren']) {
      await page.evaluate(() => window.fixtureAuth.change('alice')); await renderBarrier();
      const oldSave = holdNext('/api/' + name, 'POST'); oldSave.action = 'save';
      await page.evaluate(name => { window.fixture.seedCast(name); window.fixture.mount.cast(name); }, name);
      await intercepted(oldSave);
      await page.evaluate(() => window.fixtureAuth.change('bob'));
      const key = name === 'daliuren' ? 'daliuren_params' : name + '_result';
      await page.waitForFunction(({ key, name }) => JSON.parse(sessionStorage.getItem(key)).divinationId === 'bob-' + name, { key, name });
      oldSave.release(); await renderBarrier();
      check(name + ' fences an old account’s save receipt and automatically saves for the new account', await page.evaluate(({ key, name }) => {
        const result = JSON.parse(sessionStorage.getItem(key)); return result.recordOwnerId === 'bob' && result.divinationId === 'bob-' + name;
      }, { key, name }));
      await page.evaluate(() => window.fixture.mount.cast(null)); await renderBarrier();
    }
    await page.evaluate(() => { window.fixture.seedCast('liuyao'); window.fixture.mount.cast('liuyao'); });
    const castResult = page.getByTestId('cast-result');
    await castResult.getByRole('button', { name: '保存', exact: true, includeHidden: true }).last().waitFor({ state: 'attached' });
    check('Liuyao clears another account’s saved reading and conversation IDs', await page.evaluate(() => {
      const result = JSON.parse(sessionStorage.getItem('liuyao_result')); return result.recordOwnerId === 'bob' && !result.divinationId && !result.conversationId;
    }));
    await castResult.getByRole('button', { name: '保存', exact: true, includeHidden: true }).last().evaluate(button => button.click());
    await until(() => JSON.parse(sessionStorage.getItem('liuyao_result')).divinationId === 'bob-liuyao');
    check('Liuyao can save its own reading after rejecting another account’s saved ID', true);
    await page.evaluate(() => window.fixture.mount.cast(null));

    }

    check('No unhandled network requests escaped fixtures', blocked.length === 0);
    check('No browser runtime exceptions', browserErrors.length === 0);
    check('Disabled Query observers emit no missing queryFn warnings, including visitor', queryWarnings.length === 0);
    return { checks, requests, blocked, browserErrors, queryWarnings, scope: 'Browser-component integration with synthetic identity/API/model fixtures; no live Next routing or authentication acceptance' };
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
