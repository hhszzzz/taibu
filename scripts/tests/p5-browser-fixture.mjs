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
 * Actual components: SettingsCenterHost/GeneralSettingsPanel, AIModelPanel and its
 * controlled views, AnnouncementManagementPanel, ConversationListProvider,
 * Query and ChatStreamManager.
 * Fixture-only boundaries: identity/profile/feature flags, unrelated lazy panels,
 * navigation shell, model runner and HTTP responses. No Next router, Supabase,
 * Auth, PostgREST, paid model or CSS/layout acceptance is claimed.
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
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionContext } from '@/lib/hooks/session-context';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { SettingsCenterHost } from '@/components/settings/SettingsCenterHost';
import { openSettingsCenter } from '@/lib/settings-center';
import { AIModelPanel } from '@/components/admin/AIModelPanel';
import { AnnouncementManagementPanel } from '@/components/admin/AnnouncementManagementPanel';
import { ConversationListProvider, useConversationList } from '@/lib/chat/ConversationListContext';
import { ChatStreamManager } from '@/lib/chat/chat-stream-manager';
import { registerBrowserQueryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const manager = new ChatStreamManager();
const invalidations = [];
const invalidate = client.invalidateQueries.bind(client);
client.invalidateQueries = (...args) => { invalidations.push(args[0]); return invalidate(...args); };
registerBrowserQueryClient(client);
window.fixture = { user: 'alice', invalidations, client, manager };
function Shell({ setUser }) {
  const list = useConversationList();
  const [route, setRoute] = useState('/chat');
  const [stream, setStream] = useState(null);
  const [operation, setOperation] = useState('');
  window.fixture.list = () => list.conversationsRef.current;
  window.fixture.context = list;
  useEffect(() => manager.subscribe(event => {
    setStream(event.task);
    if (event.type === 'task_updated') {
      list.setConversations(current => current.map(row => row.id === event.task.conversationId
        ? { ...row, title: 'Stream: ' + event.task.content } : row));
    }
  }), [list.setConversations]);
  const navigate = path => { history.pushState(null, '', path); setRoute(path); };
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
      <button onClick={() => openSettingsCenter('general')}>Open actual settings</button>
      <button onClick={() => { window.fixture.user = 'alice'; setUser('alice'); }}>Fixture Alice</button>
      <button onClick={() => { window.fixture.user = 'bob'; setUser('bob'); }}>Fixture Bob</button>
      <button onClick={() => { window.fixture.user = null; setUser(null); }}>Fixture Logout</button>
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
    {route === '/models' && <section data-testid="models"><AIModelPanel /></section>}
    {route === '/announcements' && <section data-testid="announcements"><AnnouncementManagementPanel /></section>}
    <SettingsCenterHost />
  </>;
}
function App() {
  const [id, setId] = useState('alice');
  const user = id ? { id, email: id + '@fixture.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } : null;
  return <QueryClientProvider client={client}><SessionContext.Provider value={{ user, session: null, loading: false }}>
    <ThemeProvider><ToastProvider><ConversationListProvider><Shell setUser={setId} /></ConversationListProvider></ToastProvider></ThemeProvider>
  </SessionContext.Provider></QueryClientProvider>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
`;

export async function build(outputDirectory) {
  const { build: bundle } = await import('esbuild');
  await mkdir(outputDirectory, { recursive: true });
  const outfile = resolve(outputDirectory, 'fixture.js');
  await bundle({
    stdin: { contents: entry, loader: 'jsx', resolveDir: root, sourcefile: 'p5-browser-entry.jsx' },
    outfile, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    tsconfig: resolve(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'explicit-fixture-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /^@\/components\/providers\/ClientProviders$/ }, () => ({ path: resolve(root, 'src/lib/hooks/session-context.tsx') }));
      plugin.onResolve({ filter: /^@\/lib\/hooks\/(useFeatureToggles|useCurrentUserProfile)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/settings\/panels\// }, args => args.path.endsWith('/GeneralSettingsPanel') ? null : ({ path: args.path, namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\/components\/settings\/AccountAdminPanels$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        let contents = 'export default function UnexercisedPanel() { return null; }';
        if (args.path.endsWith('/useFeatureToggles')) contents = 'const enabled = () => true; export function useFeatureToggles() { return { loaded: true, isFeatureEnabled: enabled }; }';
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
  // Route fulfillment remains available offline; any missed route cannot reach a socket.
  await context.setOffline(true);
  const bundle = await readFile(bundlePath, 'utf8');
  const requests = [];
  const blocked = [];
  const browserErrors = [];
  const queryWarnings = [];
  const checks = [];
  let models = [initialModel()];
  let announcements = [];
  let failAnnouncementWrite = false;
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
  const settings = { notificationsEnabled: true, language: 'zh', expressionStyle: 'direct', customInstructions: '', chartPromptDetailLevel: 'default', userProfile: null, promptKbIds: [], notifyEmail: true, notifySite: true, defaultBaziChartId: null, defaultZiweiChartId: null };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin !== origin) { blocked.push(request.url()); return route.abort('blockedbyclient'); }
    if (url.pathname === '/fixture.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/chat' && method === 'GET') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>[hidden],.hidden{display:none!important}button,input,select,textarea{margin:4px;padding:4px}svg{width:16px;height:16px}body{font-family:sans-serif}</style><div id="root"></div><script src="/fixture.js"></script>' });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
    const body = request.postDataJSON();
    requests.push({ method, pathname: url.pathname, search: url.search, body });
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, error: null }) });
    const denied = () => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ data: null, error: { message: 'Controlled fixture failure' } }) });
    if (url.pathname === '/api/user/settings') {
      if (method === 'GET') { settingsReads++; return ok({ settings }); }
      Object.assign(settings, body); return ok({ settings });
    }
    if (url.pathname === '/api/reminders') return ok({ subscriptions: ['solar_term', 'fortune', 'key_date'].map(reminderType => ({ reminderType, enabled: false, notifySite: true, notifyEmail: false })) });
    if (url.pathname === '/api/conversations' && method === 'GET') {
      const user = await page.evaluate(() => window.fixture.user);
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const list = rows[user] ?? [];
      const payload = { conversations: list.slice(offset, offset + limit), pagination: { hasMore: offset + limit < list.length, nextOffset: offset + limit < list.length ? offset + limit : null } };
      if (holdList) { holdList = false; await new Promise(done => { releaseList = done; }); }
      return ok(payload).catch(() => {}); // An intentionally aborted old-account request may be closed.
    }
    const conversation = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (conversation) {
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
  try {
    await page.goto(origin + '/chat');
    await until(() => window.fixture?.list?.().length === 7);
    await page.getByRole('button', { name: 'Load more actual list', exact: true }).click();
    await until(() => window.fixture.list().length === 9);
    check('Query pagination retains API order and 7+2 rows', (await page.locator('[data-testid="conversation-list"] li').allTextContents()).join('|') === rows.alice.map(row => row.title).join('|'));

    await page.getByRole('button', { name: 'Open actual settings', exact: true }).click();
    await page.getByText('推送通知', { exact: true }).waitFor();
    check('Actual settings hash preserves /chat pathname', new URL(page.url()).pathname === '/chat' && new URL(page.url()).hash === '#settings/general');
    await page.evaluate(() => { document.querySelector('[role="switch"]').dataset.fixtureIdentity = 'original-node'; window.fixture.invalidations.length = 0; });
    await page.getByRole('switch').first().click();
    await until(() => window.fixture.invalidations.length === 1);
    check('GeneralSettings mutation invalidates its scoped query exactly once', JSON.stringify(await page.evaluate(() => window.fixture.invalidations)) === JSON.stringify([{ queryKey: ['chat', 'bootstrap', 'alice'] }]));
    const readsBeforeClose = settingsReads;
    await page.getByRole('button', { name: '关闭设置中心', exact: true }).click();
    await until(() => location.hash === '');
    await page.getByRole('button', { name: 'Open actual settings', exact: true }).click();
    await page.getByText('推送通知', { exact: true }).waitFor();
    check('Closing/reopening actual settings preserves mounted DOM and avoids GET refetch', settingsReads === readsBeforeClose && await page.getByRole('switch').first().getAttribute('data-fixture-identity') === 'original-node');
    check('Optimistic saved switch state survives reopen', await page.getByRole('switch').first().getAttribute('aria-checked') === 'false');
    await page.goBack();
    await until(() => location.hash === '');
    checks.push('Browser back closes actual hash-addressed settings');

    failRename = true;
    await page.getByRole('button', { name: 'Rename actual first', exact: true }).click();
    await until(() => document.querySelector('[data-testid="operation"]').textContent === 'false');
    check('Failed rename rolls back the Query-owned list', await page.locator('[data-id="alice-1"]').textContent() === 'alice conversation 1');
    failDelete = true;
    await page.getByRole('button', { name: 'Delete actual first', exact: true }).click();
    await until(() => window.fixture.list().length === 9);
    check('Failed delete restores original ordering', await page.locator('[data-testid="conversation-list"] li').first().getAttribute('data-id') === 'alice-1');

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
    await page.getByRole('button', { name: 'Fixture Bob', exact: true }).click();
    await until(() => window.fixture.list().length === 2 && window.fixture.list()[0].id === 'bob-1');
    await (await bobSettings).finished();
    check('Changing users reloads the retained settings panel exactly once', settingsReads === readsBeforeClose + 1);
    const lateRenameResponse = page.waitForResponse(response => response.url().endsWith('/api/conversations/alice-1') && response.request().method() === 'PATCH');
    releaseList(); releaseRename();
    await (await lateRenameResponse).finished();
    check('Old-account load and failed rename cannot contaminate new-account data', (await page.locator('[data-testid="conversation-list"] li').allTextContents()).join('|') === rows.bob.map(row => row.title).join('|'));
    check('Account change removes old-user Query data', await page.evaluate(() => window.fixture.client.getQueryData(['chat', 'conversations', 'alice']) === undefined));
    await page.getByRole('button', { name: 'Fixture Logout', exact: true }).click();
    await until(() => window.fixture.list().length === 0);
    check('Logout clears previous-user Query data', await page.evaluate(() => window.fixture.client.getQueryData(['chat', 'conversations', 'bob']) === undefined));
    check('Logout does not load authenticated settings', settingsReads === readsBeforeClose + 1);

    const aliceSettings = nextSettingsResponse();
    await page.getByRole('button', { name: 'Fixture Alice', exact: true }).click();
    await (await aliceSettings).finished();
    check('Signing back in reloads settings without remounting the settings host', settingsReads === readsBeforeClose + 2);
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
    await page.getByRole('button', { name: '创建模型', exact: true }).click();
    await page.getByText('Created Fixture', { exact: true }).waitFor();
    const created = requests.find(item => item.pathname === '/api/admin/ai-models' && item.method === 'POST');
    check('Actual create handler submits trimmed identity and preserved defaults', created?.body.modelKey === 'created-fixture' && created.body.primaryGatewayKey === 'octopus' && created.body.defaultTemperature === 0.7 && created.body.defaultTopP === null);
    await page.getByText('Fixture Model', { exact: true }).click();
    await page.getByRole('button', { name: '保存模型设置', exact: true }).waitFor();
    const modelInput = page.locator('[data-testid="models"] input[type="text"]').filter({ visible: true });
    await modelInput.nth(1).fill('Edited Fixture Model');
    await page.getByText('Fixture Model', { exact: true }).click();
    await page.getByText('Fixture Model', { exact: true }).click();
    check('Edit draft survives collapsing the controlled model view', await modelInput.nth(1).inputValue() === 'Edited Fixture Model');
    await page.getByRole('button', { name: '保存模型设置', exact: true }).click();
    await page.getByText('Edited Fixture Model', { exact: true }).waitFor();
    check('Actual edit form persists controlled model draft', requests.some(item => item.pathname === '/api/admin/ai-models/model-1' && item.method === 'PATCH' && item.body.displayName === 'Edited Fixture Model'));
    await page.getByRole('button', { name: '添加备用来源', exact: true }).click();
    await page.getByPlaceholder('留空则跟随模型 ID（fixture-model）', { exact: true }).fill(' upstream-fixture ');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('Octopus', { exact: true }).waitFor();
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
    for (const rejected of [true, false]) {
      failAnnouncementWrite = rejected;
      await page.evaluate(() => { window.fixture.invalidations.length = 0; });
      const deleted = page.waitForResponse(response => response.url().endsWith('/api/admin/announcements/announcement-fixture') && response.request().method() === 'DELETE');
      await announcementPanel.getByTitle('删除', { exact: true }).click();
      await (await deleted).finished();
      if (rejected) {
        await until(() => document.querySelector('[data-testid="announcements"] button[title="删除"]')?.disabled === false);
        check('Failed announcement deletion preserves the row without invalidation', (await page.evaluate(() => window.fixture.invalidations)).length === 0 && await announcementPanel.getByText('Updated fixture announcement', { exact: true }).isVisible());
      } else {
        await announcementPanel.getByText('还没有任何公告', { exact: true }).waitFor();
        check('Announcement DELETE invalidates once', JSON.stringify(await page.evaluate(() => window.fixture.invalidations)) === JSON.stringify([{ queryKey: ['announcements'] }]));
      }
    }
    check('No unhandled network requests escaped fixtures', blocked.length === 0);
    check('No browser runtime exceptions', browserErrors.length === 0);
    check('Disabled Query observers emit no missing queryFn warnings, including visitor', queryWarnings.length === 0);
    return { checks, requests, blocked, browserErrors, queryWarnings, scope: 'P5 browser-component integration only; synthetic identity/API/model fixtures; no Next/Auth/PostgREST acceptance' };
  } catch (error) {
    throw new Error(JSON.stringify({ message: error.message, checks, blocked, browserErrors, requests, pageText: await page.locator('body').innerText().catch(() => '') }, null, 2), { cause: error });
  } finally {
    releaseList?.(); releaseRename?.();
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
