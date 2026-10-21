import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { verifyAgentExperience } from './agent-experience-browser.mjs';
import { verifyAgentDomain } from './agent-domain-browser.mjs';
import { verifyAgentChartWorkspace } from './agent-chart-browser.mjs';
import { createCollaborationFixture, verifyAgentCollaboration } from './agent-collaboration-browser.mjs';
import {
  ROOT,
  validateConfig,
  validateProject,
  localDocker,
  validateResourceOwnership,
} from "../selfhost.mjs";

const index = process.argv.indexOf("--project");
assert.ok(index >= 0, "specify an independent demo project with --project");
const project = validateProject(process.argv[index + 1]);
const directory = path.join(ROOT, ".taibu-local", project);
const file = path.join(directory, "config.json");
const stat = await lstat(file);
assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077));
const config = validateConfig(JSON.parse(await readFile(file, "utf8")));
assert.equal(config.LOCAL_PROJECT, project);
assert.equal(config.DEMO_ENABLED, "true");
let account = { email: config.USER_EMAIL, password: config.USER_PASSWORD };
const accountIndex = process.argv.indexOf('--account');
if (accountIndex >= 0) {
  const accountFile = process.argv[accountIndex + 1];
  const accountStat = await lstat(accountFile);
  assert.ok(accountStat.isFile() && !accountStat.isSymbolicLink() && !(accountStat.mode & 0o077), 'account credentials must be a private regular file');
  const supplied = JSON.parse(await readFile(accountFile, 'utf8'));
  assert.ok(typeof supplied.email === 'string' && supplied.email.length <= 200 && typeof supplied.password === 'string' && supplied.password.length >= 8 && supplied.password.length <= 256, 'invalid account credentials');
  account = { email: supplied.email, password: supplied.password };
}
const browser = await chromium.launch({
  headless: true,
  ...(process.argv.includes("--chrome") ? { channel: "chrome" } : {}),
});
const outside = [],
  errors = [],
  failures = [];
const created = [];
// 本次验收在盘面上保存进命盘库的命盘，结束时随对话一起删除（--keep 保留）。
const savedCharts = [];
const chartOnly = process.argv.includes('--chart-only');
const collaborationOnly = process.argv.includes('--collaboration-only');
let page;
let context;
let collaborationFixture;
// 验收结束后删除本次新建的对话，演示账号里只留 pnpm local:showcase 的数据；--keep 保留现场。
const keep = process.argv.includes('--keep');
let existingConversations = null;
const listConversations = async () => {
  const ids = [];
  for (let offset = 0; ; offset += 100) {
    const response = await context.request.get(`${config.APP_ORIGIN}/api/conversations?limit=100&offset=${offset}`);
    if (!response.ok()) throw new Error(`list conversations: ${response.status()}`);
    const { conversations, pagination } = await response.json();
    ids.push(...conversations.map(conversation => conversation.id));
    if (!pagination?.hasMore) return ids;
  }
};
try {
  if (!chartOnly) collaborationFixture = await createCollaborationFixture(config);
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    timezoneId: 'America/New_York',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === config.APP_ORIGIN) return route.continue();
    outside.push(origin);
    return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => {
    let message = `${error.message}\n${error.stack ?? ''}`.replace(
      /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gu,
      "[redacted token]",
    );
    for (const [key, value] of Object.entries(config))
      if (value && /PASSWORD|KEY|SECRET|INSTANCE/u.test(key))
        message = message.replaceAll(value, "[redacted]");
    message = message.replaceAll(account.password, '[redacted]');
    const detail = `${new URL(page.url()).pathname}: ${error.name}: ${message.slice(0, 8000)}`;
    errors.push(detail);
    console.error('浏览器异常：', detail);
  });
  page.on("response", (response) => {
    if (response.status() >= 500)
      failures.push(new URL(response.url()).pathname);
  });
  const get = async (route) => {
    const response = await context.request.get(`${config.APP_ORIGIN}${route}`);
    assert.ok(response.ok(), `read ${route}: ${response.status()}`);
    return response.json();
  };
  const credits = async () =>
    (await get("/api/user/membership")).membership.aiChatCount;
  const composer = () =>
    page.locator("textarea").filter({ visible: true }).last();
  const uiReady = () => page.locator('[data-agent-ready="true"]').waitFor();
  const waitForRun = async (id, status, attempts = 160) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const run = await get(`/api/agent/runs/${id}`);
      if (run.status === status) return run;
      assert.ok(
        !["failed", "cancelled", "completed"].includes(run.status),
        `unexpected task outcome ${run.status}: ${run.message.agent?.error ?? ""}`,
      );
      await delay(250);
    }
    throw new Error(`task did not reach ${status}`);
  };
  const selectAgentMode = async () => {
    const mode = page.getByRole("radio", { name: "Agent", exact: true });
    await mode.waitFor();
    // 总是点击一次：即使偏好已显示 Agent，也要让本页的对话控件发布 Agent 方式，
    // 避免首帧 fallback 显示选中但 ChatLayout 尚未接管时把任务发到普通对话接口。
    await mode.click();
    await page.waitForFunction(() =>
      document.querySelector('[role="radiogroup"][aria-label="对话方式"] [aria-checked="true"]')?.getAttribute('aria-label') === "Agent",
    );
  };
  const newChat = async () => {
    await page.goto(`${config.APP_ORIGIN}/chat`);
    await selectAgentMode();
  };
  const send = async (text) => {
    await uiReady();
    const response = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/agent/runs" &&
        response.request().method() === "POST",
    );
    await composer().fill(text);
    await composer().press("Enter");
    const result = await response;
    assert.equal(result.status(), 201, "UI starts a durable task");
    const run = await result.json();
    assert.equal(run.message.agent.version, 1);
    assert.ok(!JSON.stringify(run).includes(config.DEMO_API_KEY));
    assert.ok(
      !("checkpoint" in run) && !("credential" in run) && !("input" in run),
    );
    created.push(run.id);
    return { run, payload: result.request().postDataJSON() };
  };
  await page.goto(`${config.APP_ORIGIN}/chat`);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByPlaceholder("邮箱前缀").fill(account.email);
  await page.getByPlaceholder("输入密码").fill(account.password);
  await page
    .locator("form")
    .getByRole("button", { name: "登录", exact: true })
    .click();
  await page.getByPlaceholder("输入密码").waitFor({ state: "hidden" });
  await selectAgentMode();
  existingConversations = new Set(await listConversations());
  assert.equal(
    (await get("/api/agent/status")).ready,
    true,
    "real worker heartbeat reaches Web",
  );
  assert.ok((await context.cookies()).some((cookie) => cookie.httpOnly));

  if (!chartOnly && !collaborationOnly) {
  await uiReady();
  const chatBeforeSettings = page.url();
  // The desktop chat header is hidden on an empty conversation, so the settings
  // entry comes from the site sidebar account card at the bottom.
  const accountTrigger = page.getByRole('complementary').getByRole('button', { name: /命理爱好者/ });
  await accountTrigger.waitFor();
  await accountTrigger.click();
  await page.getByRole('link', { name: '个性化', exact: true }).click();
  const settingsPage = page.locator('.settings-page');
  await settingsPage.waitFor();
  await page.waitForURL('**/settings/personalization');
  assert.equal(new URL(page.url()).pathname, '/settings/personalization');
  assert.equal(await page.getByRole('dialog', { name: '设置中心', exact: true }).count(), 0);
  await settingsPage.getByRole('link', { name: '常规', exact: true }).click();
  await page.waitForURL('**/settings/general');
  assert.equal(new URL(page.url()).pathname, '/settings/general');
  await page.goBack();
  await page.waitForURL('**/settings/personalization');
  const instructions = settingsPage.getByPlaceholder('例如：先给结论，再给依据；避免空话和术语堆叠。', { exact: true });
  const originalInstructions = await instructions.inputValue();
  await instructions.fill('本地设置导航验收草稿');
  await settingsPage.getByRole('link', { name: '常规', exact: true }).click();
  await page.waitForURL('**/settings/general');
  page.once('dialog', dialog => dialog.dismiss());
  await settingsPage.getByRole('link', { name: '返回太卜', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/settings/general', 'cancelled leave stays in settings');
  await page.goBack();
  await page.waitForURL('**/settings/personalization');
  assert.equal(await instructions.inputValue(), '本地设置导航验收草稿', 'category Back retains the draft');
  page.once('dialog', dialog => dialog.dismiss());
  await page.goBack();
  await page.waitForURL('**/settings/personalization');
  assert.equal(await instructions.inputValue(), '本地设置导航验收草稿', 'cancelled Back restores the same history entry');
  await page.goForward();
  await page.waitForURL('**/settings/general');
  let refreshProtected = false;
  page.once('dialog', dialog => { refreshProtected = dialog.type() === 'beforeunload'; return dialog.dismiss(); });
  const beforeRefreshUrl = page.url();
  await page.reload({ timeout: 3000 }).catch(error => {
    assert.ok(refreshProtected, 'refresh waits only because the browser cancelled it');
    assert.match(error.message, /ERR_ABORTED|navigation.*cancelled|Timeout.*exceeded/iu);
  });
  assert.ok(refreshProtected, 'browser refresh protects the unsaved draft');
  assert.equal(page.url(), beforeRefreshUrl, 'cancelled refresh retains the settings address');
  await settingsPage.getByRole('link', { name: '个性化', exact: true }).click();
  await page.waitForURL('**/settings/personalization');
  assert.equal(await instructions.inputValue(), '本地设置导航验收草稿', 'cancelled refresh retains the draft');
  await instructions.fill(originalInstructions);
  await settingsPage.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'hidden' });
  await settingsPage.getByRole('link', { name: '返回太卜', exact: true }).click();
  await page.waitForURL('**/bazi');
  await page.goBack();
  await page.waitForURL('**/settings/personalization');
  await instructions.fill('本地设置前进验收草稿');
  await settingsPage.getByRole('button', { name: '保存', exact: true }).waitFor();
  page.once('dialog', dialog => dialog.dismiss());
  await page.goForward();
  await page.waitForURL('**/settings/personalization');
  assert.equal(await instructions.inputValue(), '本地设置前进验收草稿', 'cancelled Forward restores the draft and history entry');
  await instructions.fill(originalInstructions);
  await settingsPage.getByRole('button', { name: '保存', exact: true }).waitFor({ state: 'hidden' });
  await page.goto(`${config.APP_ORIGIN}/settings/admin-ai-services/models`);
  await settingsPage.getByRole('heading', { name: '无权限访问', exact: true }).waitFor();
  assert.equal(await settingsPage.getByRole('link', { name: 'AI 服务', exact: true }).count(), 0, 'regular users cannot enter admin categories');
  await page.goto(`${config.APP_ORIGIN}/bazi#settings/byok`);
  await page.waitForURL('**/settings/byok');
  assert.equal(await page.getByRole('dialog', { name: '设置中心', exact: true }).count(), 0, 'legacy links open the independent settings page');
  await page.goto(`${config.APP_ORIGIN}/settings`);
  await page.waitForURL('**/settings/general');
  await page.reload();
  // The redesign renders the font scale as a segmented radio group; its options
  // carry the settings transitions the reduced-motion checks measure.
  const fontScaleGroup = settingsPage.getByRole('radiogroup', { name: '全站字号', exact: true });
  await fontScaleGroup.waitFor();
  const animatedControl = fontScaleGroup.getByRole('radio', { checked: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.ok(await animatedControl.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) >= .1), 'settings controls normally use their visual transition');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await animatedControl.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) <= .001), 'reduced motion applies to settings controls');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(chatBeforeSettings);
  await uiReady();
  console.log('设置页面：分类草稿、取消离开/后退/前进/刷新、直接访问、旧链接、普通账号权限与减少动画通过。');
  // The model redesign nests the custom provider entry in the model menu and hands
  // focus back to the composer's add menu when the dialog closes.
  const providerTrigger = page.getByRole('button', { name: /^选择模型：/ });
  await providerTrigger.click();
  const providerModelMenu = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await providerModelMenu.waitFor();
  await providerModelMenu.getByRole('button', { name: '使用自己的模型 API', exact: true }).click();
  const providerDialog = page.locator('dialog.chat-provider-dialog[open]');
  await providerDialog.waitFor();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press(key);
      const providerFocus = await providerDialog.evaluate(element => ({ inside: element.contains(document.activeElement), active: document.activeElement?.tagName }));
      assert.ok(providerFocus.inside, `custom model modal contains focus after ${key} (${providerFocus.active})`);
    }
  }
  await page.keyboard.press('Escape');
  await providerDialog.waitFor({ state: 'hidden' });
  const addMenuTrigger = page.getByRole('button', { name: '添加图片或文本资料', exact: true });
  assert.ok(await addMenuTrigger.evaluate(element => element === document.activeElement), 'closing custom model settings returns focus to the add menu');
  let composingSubmissions = 0;
  const trackComposingSubmission = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/agent/runs') composingSubmissions++;
  };
  page.on('request', trackComposingSubmission);
  await composer().fill('中文输入法选字');
  await composer().evaluate(element => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, isComposing: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, keyCode: 229 }));
  });
  await delay(200);
  page.off('request', trackComposingSubmission);
  assert.equal(composingSubmissions, 0, 'IME Enter selects characters without submitting a task');
  await composer().fill('');
  await page.screenshot({ path: path.join(directory, 'agent-empty-acceptance.png'), fullPage: true });

  const initial = await credits();
  assert.ok(initial >= 8, 'browser acceptance requires eight chat uses; supply an isolated account with --account');
  const first = await send("Agent验收：跨命盘对比，请排盘并在聊天中分析。");
  await page.goto(`${config.APP_ORIGIN}/chat?id=${first.run.conversationId}`);
  const finished = await waitForRun(first.run.id, "completed");
  await page.locator('[data-agent-status="completed"]').waitFor();
  assert.equal(await credits(), initial - 1);
  assert.equal(
    finished.message.agent.parts.filter(
      (part) =>
        part.type === "tool" &&
        part.name === "bazi" &&
        part.status === "completed",
    ).length,
    2,
  );
  assert.equal(finished.message.agent.parts.some(part => part.type === 'artifact'), false, 'an answer saves no chart or record by itself');
  assert.ok(finished.message.content.includes('Agent 离线验收'));
  assert.ok(finished.message.agent.runtime.context.tokens > 0, 'Pi projects the real active transcript');
  assert.equal(finished.message.agent.runtime.model.contextWindow, null, 'unconfigured models have no invented capacity');
  // Context now lives in the right session panel (claude 会话详情): percentage, segmented bar and per-kind legend.
  // 任务完成时工作区可能已自动打开（会话详情让位），先收起再检查会话详情。
  const workspaceToggle = page.getByRole('button', { name: '任务工作区', exact: true });
  if (await workspaceToggle.getAttribute('aria-expanded') === 'true') await workspaceToggle.click();
  const sessionPanel = page.locator('aside#agent-session-panel');
  await sessionPanel.waitFor();
  const contextCard = sessionPanel.getByRole('region', { name: '上下文', exact: true });
  await contextCard.waitFor();
  const contextText = await contextCard.innerText();
  assert.ok(!contextText.includes('已使用') && /[\d.]+k\b/.test(contextText) && contextText.includes('消息') && contextText.includes('工具'), 'context shows only the compact K total and its message/tool granularity');
  assert.ok(['usage', 'mixed', 'estimated'].includes(await contextCard.getAttribute('data-context-source')), 'the card reads the projected context');
  if (await workspaceToggle.getAttribute('aria-expanded') !== 'true') await workspaceToggle.click();
  const panel = page.locator('aside#agent-workspace-panel');
  await panel.waitFor();
  // 打开工作区（artifacts）后会话详情让位并隐藏（claude 同款）。
  await sessionPanel.waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(directory, 'agent-context-acceptance.png'), fullPage: true });
  const modelTrigger = page.getByRole('button', { name: /^选择模型：/ });
  await modelTrigger.click();
  await page.getByRole('dialog', { name: '模型与分析设置', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.ok(await modelTrigger.evaluate(element => element === document.activeElement), 'closing model settings restores its trigger focus');
  const modelBounds = await modelTrigger.boundingBox();
  const sendBounds = await page.getByRole('button', { name: '发送', exact: true }).boundingBox();
  assert.ok(modelBounds && sendBounds && modelBounds.x < sendBounds.x, 'model settings precede Send on the right');
  const toolsTrigger = page.getByRole('button', { name: '添加图片或文本资料', exact: true });
  await toolsTrigger.click();
  await page.getByRole('menu', { name: '添加图片或文本资料', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.ok(await toolsTrigger.evaluate(element => element === document.activeElement), 'keyboard dismissal returns focus even when menu actions focus the composer');
  const duplicate = await context.request.post(
    `${config.APP_ORIGIN}/api/agent/runs`,
    { data: first.payload },
  );
  assert.ok(duplicate.ok());
  assert.equal((await duplicate.json()).id, first.run.id);
  assert.equal(
    await credits(),
    initial - 1,
    "duplicate submission does not debit again",
  );
  // A chat step discloses its call in place; the process section shows that step's call as returned, ready to copy.
  const processHeading = page.locator('.agent-message .agent-process-heading').first();
  if (await processHeading.getAttribute('aria-expanded') !== 'true') await processHeading.click();
  const firstStep = page.locator('.agent-message .agent-step-row').first();
  if (await firstStep.getAttribute('aria-expanded') !== 'true') await firstStep.click();
  await page.locator('.agent-message .agent-step-workspace').first().click();
  // 普通记录视图只显示规范文本；原始参数不展示，工具调用块也不再带复制按钮。
  const call = page.locator('.agent-message .agent-step-body').first();
  await call.waitFor();
  assert.equal(await call.locator('.agent-step-command').count(), 0, 'the normal record view hides raw argument keys');
  assert.equal(await call.getByRole('button', { name: '复制调用参数', exact: true }).count(), 0, 'tool steps no longer carry copy buttons');
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  const originalPanelWidth = (await panel.boundingBox()).width;
  await panel.getByRole('separator', { name: '调整工作区宽度', exact: true }).press('ArrowRight');
  assert.equal((await panel.boundingBox()).width, originalPanelWidth - 24, 'a constrained workspace shrinks from its actual rendered width');
  await panel.getByRole('separator', { name: '调整工作区宽度', exact: true }).press('ArrowLeft');
  assert.equal(await panel.locator('[data-overview-result="reading"]').count(), 2, 'the overview counts each actual tool reading once');
  // The comparison casts two charts and saves nothing at the end, so the process is exactly those two steps.
  assert.equal(await page.locator('.agent-message .agent-step').count(), 2, 'the chat process keeps every executed step');
  await page.screenshot({ path: path.join(directory, 'agent-workspace-acceptance.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('html.dark').waitFor();
  // The existing site-wide theme transition lasts 300 ms.
  await delay(350);
  await page.screenshot({ path: path.join(directory, 'agent-workspace-dark-acceptance.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('html:not(.dark)').waitFor();
  await delay(350);
  // 存不存盘由用户在盘面上决定：盘面按出生资料认出命盘库里的同一张盘（账号里可能已有），
  // 没有时保存走结果页同一接口，之后按钮变成命盘页入口。
  const sameBirth = chart => chart.gender === 'male' && chart.birth_date === '1990-01-15' && String(chart.birth_time).slice(0, 5) === '09:00'
    && chart.calendar_type !== 'lunar' && chart.is_leap_month !== true && chart.longitude == null
    && (chart.timezone ?? 'Asia/Shanghai') === 'Asia/Shanghai' && (chart.disambiguation ?? 'reject') === 'reject';
  const librarySame = async () => (await get('/api/user/charts')).baziCharts.filter(sameBirth);
  const savedBefore = await librarySame();
  // 首个步骤是男方八字（与 sameBirth 同一出生资料）。
  await page.locator('.agent-message .agent-step-workspace').first().click();
  const savedLink = panel.getByRole('link', { name: '已保存到我的命盘，打开命盘页', exact: true });
  if (!savedBefore.length) {
    await panel.getByRole('button', { name: '保存命盘', exact: true }).click();
    await savedLink.waitFor();
  }
  const savedAfter = await librarySame();
  assert.equal(savedAfter.length, Math.max(savedBefore.length, 1), 'the board saves a chart the library lacks, once');
  if (!savedBefore.length) savedCharts.push(savedAfter[0].id);
  const savedHref = await savedLink.getAttribute('href');
  assert.ok(savedAfter.some(chart => savedHref === `/bazi/result?chart=${encodeURIComponent(chart.id)}`), 'a saved board links to its library chart');
  assert.equal(await panel.getByRole('button', { name: '保存命盘', exact: true }).count(), 0, 'a saved chart offers no second save');
  await panel.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await page.screenshot({
    path: path.join(directory, "agent-acceptance.png"),
    fullPage: true,
  });
  // 聊天里不展示成果卡片；保存后的命盘在原生命盘页按 id 打开。
  await page.goto(`${config.APP_ORIGIN}${savedHref}`);
  await page.waitForURL(url => `${url.pathname}${url.search}` === savedHref);
  console.log(
    "Agent 浏览器：真实登录、跨命盘工具调用、后台完成、刷新恢复、盘面存入命盘库和一次扣费通过。",
  );
  console.log('Agent UI：任务步骤分组、中文输入法、聊天分析、原生命盘入口、Pi 上下文与右侧控件通过。');

  await page.goto(`${config.APP_ORIGIN}/chat?id=${first.run.conversationId}`);
  await page.locator('[data-agent-status="completed"]').waitFor();
  await uiReady();
  await verifyAgentExperience({ page, context, origin: config.APP_ORIGIN, directory, conversationId: first.run.conversationId });
  const savedDraft = '验收草稿：留在当前对话';
  const newDraft = '验收草稿：留在新对话';
  await composer().fill(savedDraft);
  await newChat();
  await uiReady();
  await composer().fill(newDraft);
  await page.goto(`${config.APP_ORIGIN}/chat?id=${first.run.conversationId}`);
  await page.locator('[data-agent-status="completed"]').waitFor();
  await uiReady();
  assert.equal(await composer().inputValue(), savedDraft, 'switching conversations restores its own draft');
  await page.reload();
  await page.locator('[data-agent-status="completed"]').waitFor();
  await uiReady();
  assert.equal(await composer().inputValue(), savedDraft, 'refresh restores the session draft');
  await composer().fill('');
  await newChat();
  await uiReady();
  assert.equal(await composer().inputValue(), newDraft, 'the new conversation draft is independent');
  await composer().fill('');
  await page.goto(`${config.APP_ORIGIN}/chat?id=${first.run.conversationId}`);
  await page.locator('[data-agent-status="completed"]').waitFor();
  await uiReady();
  console.log('聊天草稿：跨对话切换、刷新恢复、新对话隔离通过。');
  const regenerateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/agent/runs" &&
      response.request().method() === "POST",
  );
  await page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-refresh-cw") })
    .last()
    .click();
  const regeneratedResponse = await regenerateResponse;
  assert.equal(regeneratedResponse.status(), 201);
  const regenerated = await regeneratedResponse.json();
  created.push(regenerated.id);
  assert.notEqual(
    regenerated.id,
    first.run.id,
    "regeneration creates a new task",
  );
  const regeneratedResult = await waitForRun(regenerated.id, "completed");
  await page.locator('[data-agent-status="completed"]').waitFor();
  assert.equal(regeneratedResult.message.agent.parts.some(part => part.type === 'artifact'), false, 'regeneration saves nothing by itself');
  assert.equal((await librarySame()).length, savedAfter.length, 'regeneration adds no library chart');
  assert.equal(await credits(), initial - 2);
  await uiReady();
  // 工作区是停靠分栏（不再浮层遮盖），消息操作可直接触达。
  const editResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/agent/runs" &&
      response.request().method() === "POST",
  );
  await page
    .locator("button")
    .filter({ has: page.locator("svg.lucide-pencil") })
    .first()
    .click();
  // Inline edit box (claude B10): 取消 ghost + 保存 filled; scoped so no other 保存 button matches.
  const editBox = page.locator(".chat-user-edit");
  await editBox.getByRole("textbox", { name: "编辑消息内容", exact: true }).fill("Agent验收：编辑消息后跨命盘对比，在聊天中分析。");
  await editBox.getByRole("button", { name: "保存", exact: true }).click();
  const editedResponse = await editResponse;
  assert.equal(editedResponse.status(), 201);
  const edited = await editedResponse.json();
  created.push(edited.id);
  await waitForRun(edited.id, "completed");
  await page.locator('[data-agent-status="completed"]').waitFor();
  assert.equal(await credits(), initial - 3);

  // ── Agent 历史版本：首轮 + 重新生成 + 编辑 = 3 个版本，切换与刷新都不丢分支 ──
  const versionCounter = page.locator(".chat-message-versions [aria-live]");
  const versionSwitch = (name) => page.locator(".chat-message-versions").getByRole("button", { name, exact: true });
  const replyId = () => page.locator('.chat-message-row.is-assistant').first().getAttribute("data-message-id");
  // 等「落库了目标版本」的那次保存，而不是任意一次 PATCH：连点两次会发出两次保存。
  const savedSwitch = (index) => page.waitForResponse((response) => /^\/api\/conversations\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH"
    && (response.request().postDataJSON()?.messages ?? []).some((message) => message.currentVersionIndex === index));
  await versionCounter.filter({ hasText: "3 / 3" }).waitFor();
  assert.equal(await replyId(), `agent:${edited.id}`);
  await versionSwitch("上一版本").click();
  await versionCounter.filter({ hasText: "2 / 3" }).waitFor();
  let saved = savedSwitch(0);
  await versionSwitch("上一版本").click();
  await versionCounter.filter({ hasText: "1 / 3" }).waitFor();
  assert.equal((await saved).ok(), true, "switching versions persists the visible branch");
  assert.equal(await replyId(), `agent:${first.run.id}`, "an older Agent version keeps its durable message id");
  await page.reload();
  await versionCounter.filter({ hasText: "1 / 3" }).waitFor();
  assert.equal(await replyId(), `agent:${first.run.id}`, "the chosen version survives a reload");
  await versionSwitch("下一版本").click();
  await versionCounter.filter({ hasText: "2 / 3" }).waitFor();
  saved = savedSwitch(2);
  await versionSwitch("下一版本").click();
  await versionCounter.filter({ hasText: "3 / 3" }).waitFor();
  await saved;
  assert.equal(await replyId(), `agent:${edited.id}`);
  // A follow-up written on v3 must come back after switching away and back.
  const followUp = await send("Agent验收：版本追问，在聊天中分析。");
  await waitForRun(followUp.run.id, "completed");
  await page.locator(`[data-message-id="agent:${followUp.run.id}"] [data-agent-status="completed"]`).waitFor();
  // 追问后较早的一轮折叠成「上一轮」条，版本切换在展开后可用。
  const unfoldEarlierRound = async () => {
    const fold = page.locator('.agent-round-fold[aria-expanded="false"]').first();
    if (await fold.count()) await fold.click();
  };
  await unfoldEarlierRound();
  await versionSwitch("上一版本").click();
  await versionCounter.filter({ hasText: "2 / 3" }).waitFor();
  assert.equal(await page.locator(`[data-message-id="agent:${followUp.run.id}"]`).count(), 0, "other branches do not show the v3 follow-up");
  await unfoldEarlierRound();
  await versionSwitch("下一版本").click();
  await versionCounter.filter({ hasText: "3 / 3" }).waitFor();
  await page.locator(`[data-message-id="agent:${followUp.run.id}"]`).waitFor();
  assert.equal(await credits(), initial - 4);
  console.log(
    "Agent 浏览器：重新生成、编辑后续跑、历史版本保留及原生命盘复用通过。",
  );

  await newChat();
  const beforeReply = await credits();
  const second = await send("Agent验收：补充信息后排盘，请先询问出生信息。");
  await waitForRun(second.run.id, "awaiting_input");
  await page.goto(`${config.APP_ORIGIN}/chat?id=${second.run.conversationId}`);
  await page.locator('[data-agent-status="awaiting_input"]').waitFor();
  // The header no longer carries task status; the message's waiting pill is the stable indicator.
  await page.locator('.agent-message .agent-status--awaiting_input').waitFor();
  // The questions take the composer's place until answered or folded away.
  const questionDock = page.getByRole('region', { name: /^太卜需要补充 \d+ 项信息$/ });
  await questionDock.waitFor();
  await questionDock.getByText('请补充出生年月日、出生时刻和性别。').waitFor();
  await questionDock.getByRole('textbox').fill('1990年1月15日9时，男。');
  await page.setViewportSize({ width: 390, height: 844 });
  // The workspace restored open re-renders as a phone sheet that covers the dock;
  // close it before measuring and folding the questions.
  const workspaceDialog = page.locator('#agent-workspace-panel');
  if (await workspaceDialog.isVisible()) {
    await workspaceDialog.getByRole('button', { name: '关闭工作区', exact: true }).click();
    await workspaceDialog.waitFor({ state: 'hidden' });
  }
  const dockBounds = await questionDock.boundingBox();
  assert.ok(dockBounds && dockBounds.x >= 0 && dockBounds.x + dockBounds.width <= 390, 'the question dock fits a 390px viewport');
  await page.screenshot({ path: path.join(directory, 'agent-question-mobile-acceptance.png'), fullPage: true });
  await questionDock.getByRole('button', { name: '稍后回答', exact: true }).click();
  await questionDock.waitFor({ state: 'hidden' });
  assert.equal((await get(`/api/agent/runs/${second.run.id}`)).status, 'awaiting_input', 'answering later leaves the same task waiting');
  const answerTrigger = page.getByRole('group', { name: '等待回答', exact: true }).getByRole('button', { name: '回答问题', exact: true });
  await page.waitForFunction(() => document.activeElement?.textContent === '回答问题');
  assert.ok(await composer().isVisible(), 'folding the questions hands the input back for a free-text reply');
  await answerTrigger.click();
  assert.equal(await questionDock.getByRole('textbox').inputValue(), '1990年1月15日9时，男。', 'reopening keeps the answer draft');
  await uiReady();
  const replyResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/agent/runs/${second.run.id}/messages` &&
      response.request().method() === "POST",
  );
  await questionDock.getByRole('button', { name: '检查回答', exact: true }).click();
  await questionDock.getByRole('button', { name: '提交并继续', exact: true }).click();
  const reply = await replyResponse;
  assert.ok(reply.ok());
  assert.equal(reply.request().postDataJSON().mode, 'reply');
  const replyPayload = await reply.json();
  assert.equal(replyPayload.message.metadata.agentRunId, second.run.id);
  await questionDock.waitFor({ state: 'hidden' });
  await waitForRun(second.run.id, "completed");
  await page.locator('[data-agent-status="completed"]').waitFor();
  const assertReplyOrder = async () => {
    await uiReady();
    const order = await page.locator('[data-message-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-message-id')));
    assert.ok(order.indexOf(replyPayload.message.id) >= 0 && order.indexOf(replyPayload.message.id) < order.indexOf(second.run.message.id), 'the task response follows the in-run answer');
  };
  await assertReplyOrder();
  const legacyReplyPattern = `${config.APP_ORIGIN}/api/conversations/${second.run.conversationId}*`;
  let legacyReplyLoads = 0;
  const legacyReplyHistory = async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    const savedReply = payload.conversation.messages.find(message => message.id === replyPayload.message.id);
    assert.equal(savedReply.metadata.agentRunId, second.run.id, 'the task association survives persistence');
    // Exercise old histories without modifying saved conversation data.
    delete savedReply.metadata.agentRunId;
    legacyReplyLoads++;
    return route.fulfill({ response, json: payload });
  };
  await page.route(legacyReplyPattern, legacyReplyHistory);
  await page.reload();
  await page.locator('[data-agent-status="completed"]').waitFor();
  assert.ok((await get(`/api/agent/runs/${second.run.id}`)).commandMessageIds.includes(replyPayload.message.id), 'the snapshot retains consumed answer IDs');
  await assertReplyOrder();
  assert.ok(legacyReplyLoads > 0, 'the reload exercises the legacy conversation fixture');
  await page.unroute(legacyReplyPattern, legacyReplyHistory);
  assert.equal(
    await credits(),
    beforeReply - 1,
    "supplement uses the original task charge",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(directory, "agent-mobile-acceptance.png"),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "mobile layout has no horizontal overflow",
  );
  await page.getByRole('button', { name: '任务工作区', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '工作区', exact: true });
  await drawer.waitFor();
  for (let index = 0; index < 12; index++) await page.keyboard.press('Tab');
  assert.ok(await drawer.evaluate(element => element.contains(document.activeElement)), 'native workspace drawer keeps keyboard focus inside');
  await page.screenshot({ path: path.join(directory, 'agent-workspace-mobile-acceptance.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('button', { name: '任务工作区', exact: true }).evaluate(element => element === document.activeElement), 'closing the drawer restores focus to its trigger');
  const conversationsTrigger = page.getByRole('button', { name: '打开聊天列表', exact: true });
  await conversationsTrigger.click();
  const conversationsDrawer = page.getByRole('dialog', { name: '聊天列表', exact: true });
  await conversationsDrawer.waitFor();
  const conversationActionsTrigger = conversationsDrawer.getByRole('button', { name: '更多操作', exact: true }).first();
  await conversationActionsTrigger.click();
  const conversationMenu = conversationsDrawer.getByRole('menu', { name: '会话操作', exact: true });
  await conversationMenu.waitFor();
  assert.ok(await conversationMenu.evaluate(element => element.closest('dialog')?.open), 'conversation actions remain in the native drawer top layer');
  await page.keyboard.press('Escape');
  await conversationMenu.waitFor({ state: 'hidden' });
  assert.ok(await conversationsDrawer.isVisible(), 'the first Escape closes only the nested menu');
  assert.ok(await conversationActionsTrigger.evaluate(element => element === document.activeElement), 'nested menu dismissal restores its trigger focus');
  await page.keyboard.press('Escape');
  await conversationsDrawer.waitFor({ state: 'hidden' });
  assert.ok(await conversationsTrigger.evaluate(element => element === document.activeElement), 'closing the conversation drawer restores focus to its trigger');
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '320px layout has no horizontal overflow');
  const inputBounds = await composer().boundingBox();
  const toolbarBounds = await page.locator('.chat-composer-toolbar').boundingBox();
  assert.ok(inputBounds && toolbarBounds && toolbarBounds.x >= 0 && toolbarBounds.x + toolbarBounds.width <= 321, 'composer controls stay inside the narrow viewport');
  assert.ok(await page.locator('.chat-composer-toolbar').evaluate(element => [...element.querySelectorAll('button')]
    .filter(button => button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
    .every(button => { const bounds = button.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= window.innerWidth + 1; })), 'every visible composer control fits at 320px');
  await modelTrigger.click();
  const modelMenu = page.locator('.chat-model-menu');
  await modelMenu.waitFor();
  const modelMenuBounds = await modelMenu.boundingBox();
  assert.ok(modelMenuBounds && modelMenuBounds.x >= 0 && modelMenuBounds.x + modelMenuBounds.width <= 321, 'model menu fits the 320px viewport');
  await page.keyboard.press('Escape');
  await modelMenu.waitFor({ state: 'hidden' });
  assert.ok(await modelTrigger.evaluate(element => element === document.activeElement), 'closing the model menu restores its trigger focus');
  await modelTrigger.click();
  await modelMenu.getByRole('menuitemradio', { name: '本地离线演示' }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  console.log("Agent 浏览器：等待补充、刷新后继续同一任务、移动端布局通过。");

  await newChat();
  const beforeCancel = await credits();
  const third = await send("Agent验收：补充信息，请先询问，等待时停止。");
  await waitForRun(third.run.id, "awaiting_input");
  await page.locator('[data-agent-status="awaiting_input"]').waitFor();
  await page.getByRole('region', { name: /^太卜需要补充 \d+ 项信息$/ }).getByRole('button', { name: '稍后回答', exact: true }).click();
  const cancelResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `/api/agent/runs/${third.run.id}/cancel`,
  );
  await page.getByRole('group', { name: '等待回答', exact: true }).getByRole("button", { name: "停止任务", exact: true }).click();
  assert.ok((await cancelResponse).ok());
  await waitForRun(third.run.id, "cancelled");
  await page.locator('[data-agent-status="cancelled"]').waitFor();
  assert.equal(
    await credits(),
    beforeCancel,
    "stopping without visible body or saved result refunds once",
  );
  await context.request.post(
    `${config.APP_ORIGIN}/api/agent/runs/${third.run.id}/cancel`,
  );
  assert.equal(await credits(), beforeCancel);
  console.log("Agent 浏览器：用户停止、终态恢复、一次退款通过。");

  await newChat();
  const beforeCrash = await credits();
  const crash = await send("Agent验收：崩溃恢复，请排盘并在聊天中分析。");
  for (let attempt = 0; attempt < 120; attempt++) {
    const progress = await get(`/api/agent/runs/${crash.run.id}`);
    if (
      progress.message.agent.parts.some(
        (part) =>
          part.type === "tool" &&
          part.name === "bazi" &&
          part.status === "completed",
      )
    )
      break;
    assert.ok(["queued", "running"].includes(progress.status));
    assert.ok(attempt < 119, "calculation checkpoint was not committed");
    await delay(100);
  }
  const dockerEnvironment = await localDocker();
  const worker = `${project}-worker-1`;
  const marker = execFileSync(
    "docker",
    [
      "inspect",
      "--format",
      '{{index .Config.Labels "io.taibu.local.instance"}}',
      worker,
    ],
    { env: dockerEnvironment, encoding: "utf8" },
  ).trim();
  validateResourceOwnership(marker, config.LOCAL_INSTANCE_ID);
  execFileSync("docker", ["kill", "--signal", "KILL", worker], {
    env: dockerEnvironment,
    stdio: "pipe",
  });
  execFileSync("docker", ["start", worker], {
    env: dockerEnvironment,
    stdio: "pipe",
  });
  console.log("Agent 浏览器：已终止隔离 worker，等待租约失效后接管同一任务。");
  await page.goto(`${config.APP_ORIGIN}/chat?id=${crash.run.conversationId}`);
  const recovered = await waitForRun(crash.run.id, "completed", 360);
  await page.locator('[data-agent-status="completed"]').waitFor();
  assert.equal(
    recovered.message.agent.parts.filter(
      (part) => part.type === "tool" && part.name === "bazi",
    ).length,
    1,
    "committed calculation is not executed twice",
  );
  assert.equal(recovered.message.agent.parts.some(part => part.type === 'artifact'), false, 'takeover saves no chart or record');
  assert.equal(
    await credits(),
    beforeCrash - 1,
    "worker takeover keeps the original charge",
  );
  console.log(
    "Agent 浏览器：真实 worker 崩溃、租约接管、刷新重连及计算不重复执行通过。",
  );
  // `/compact` 压缩空闲 Agent 对话的上下文：命令菜单填入指令，任务免费、不调用工具，也不把命令当作问题。
  await uiReady();
  await composer().fill('/comp');
  await page.getByRole('listbox', { name: '输入命令' }).getByRole('option', { name: /压缩上下文/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('textarea')].some(element => element.value === '/compact '));
  const compact = await send('/compact 保留八字结论');
  const compacted = await waitForRun(compact.run.id, 'completed');
  await page.locator(`[data-message-id="agent:${compact.run.id}"] [data-agent-status="completed"]`).waitFor();
  assert.match(compacted.message.content, /^(已压缩上下文|当前上下文还不长)/u);
  assert.equal(compacted.billing, 'exempt');
  assert.equal(compacted.message.agent.parts.some(part => part.type === 'tool'), false, 'compaction calls no tool');
  assert.equal(await credits(), beforeCrash - 1, '/compact is free');
  console.log('Agent 浏览器：/compact 命令菜单、免费压缩任务与结果展示通过。');

  // 后台子分析：主 Agent 派出后先作答，任务等回报到达、整合后才结束；下一轮 send 给同一子分析，它记得上一轮的结论。
  await newChat();
  const beforeBackground = await credits();
  const subagentCard = (run) => run.message.agent.parts.find((part) => part.type === 'tool' && part.name === 'background_agent');
  const background = await send('Agent验收：后台子分析，请派出八字复核后先给出主分析。');
  const reported = await waitForRun(background.run.id, 'completed', 360);
  await page.locator(`[data-message-id="agent:${background.run.id}"] [data-agent-status="completed"]`).waitFor();
  const [spawned] = subagentCard(reported).output.analyses;
  assert.deepEqual([spawned.name, spawned.status], ['八字复核', 'completed']);
  assert.match(spawned.answer, /后台子分析完成/u);
  assert.ok(spawned.steps.some((step) => step.name === 'bazi'), 'the subagent computed with the real tool');
  assert.match(reported.message.content, /已整合后台子分析的回报：八字复核已核对/u);
  const continuing = await send('Agent验收：后台子分析追问，请让八字复核接着看 2028 年。');
  const continued = await waitForRun(continuing.run.id, 'completed', 360);
  const sent = subagentCard(continued);
  assert.equal(sent.input.action, 'send');
  assert.match(sent.output.analyses[0].answer, /记得此前的结论/u, 'the next task recreates the subagent with its memory');
  assert.match(continued.message.content, /2028 年的追问已核对/u);
  assert.equal(await credits(), beforeBackground - 2, 'each task with background subagents is charged once');
  console.log('Agent 浏览器：后台子分析派出、等待回报、整合、跨任务常驻与单次计费通过。');

  // 任务树排障：普通用户读不到管理员接口；管理员在设置中心「Agent 任务」按对话 ID 找到这项任务，任务树由提交日志重建。
  assert.equal((await context.request.get(`${config.APP_ORIGIN}/api/admin/agent-runs`)).status(), 403, 'regular users cannot read the task log');
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  try {
    await adminContext.route('**/*', (route) => {
      const origin = new URL(route.request().url()).origin;
      if (origin === config.APP_ORIGIN) return route.continue();
      outside.push(origin);
      return route.abort();
    });
    const admin = await adminContext.newPage();
    admin.setDefaultTimeout(20_000);
    admin.on('pageerror', (error) => errors.push(`admin ${new URL(admin.url()).pathname}: ${error.name}: ${error.message.slice(0, 2000)}`));
    admin.on('response', (response) => { if (response.status() >= 500) failures.push(new URL(response.url()).pathname); });
    await admin.goto(`${config.APP_ORIGIN}/chat`);
    await admin.getByRole('button', { name: '登录', exact: true }).click();
    await admin.getByPlaceholder('邮箱前缀').fill(config.ADMIN_EMAIL);
    await admin.getByPlaceholder('输入密码').fill(config.ADMIN_PASSWORD);
    await admin.locator('form').getByRole('button', { name: '登录', exact: true }).click();
    await admin.getByPlaceholder('输入密码').waitFor({ state: 'hidden' });
    await admin.goto(`${config.APP_ORIGIN}/settings/admin-ai-services/agent-tasks`);
    const taskPanel = admin.getByRole('tabpanel', { name: 'Agent 任务' });
    await taskPanel.getByLabel('按任务、对话或用户 ID 查找').fill(background.run.conversationId);
    await taskPanel.getByRole('button', { name: '查找', exact: true }).click();
    await taskPanel.getByRole('button', { name: new RegExp(background.run.id.slice(0, 8)) }).click();
    const taskTree = taskPanel.getByRole('list', { name: '任务树' });
    await taskTree.getByText('主会话', { exact: true }).waitFor();
    assert.ok(await taskTree.getByText('工具 background_agent', { exact: true }).first().isVisible(), 'the spawn call sits in the tree');
    assert.ok(await taskTree.getByText('后台子分析「八字复核」', { exact: true }).isVisible(), "the subagent's conversation is named");
    assert.ok(await taskTree.getByText('后台回报 · 八字复核', { exact: true }).first().isVisible(), 'the report task is listed');
    assert.equal(await taskTree.locator('.text-danger').count(), 0, 'nothing failed');
    console.log('Agent 浏览器：管理员任务树按提交日志重建主会话、后台子分析与回报；普通用户无权读取。');
  } finally {
    await adminContext.close();
  }

  await newChat();
  await uiReady();
  await page.getByRole("radio", { name: "对话", exact: true }).click();
  const plainResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/chat" &&
      response.request().method() === "POST",
  );
  void plainResponse.catch(() => {});
  await composer().fill(`普通对话本地验收 ${randomUUID()}`);
  await composer().press("Enter");
  assert.ok((await plainResponse).ok());
  await page
    .getByText(/这是本地离线演示回复/)
    .first()
    .waitFor();
  const conversation = new URL(page.url()).searchParams.get("id");
  assert.ok(conversation);
  assert.equal(
    await get(`/api/agent/runs?conversationId=${conversation}`),
    null,
    "plain chat uses the existing route",
  );

  // Exercise reading behavior with controlled long transcripts, without altering saved messages.
  let transcriptCount = 6;
  const transcriptMessages = Array.from({ length: 26 }, (_, index) => ({
    id: randomUUID(),
    role: index % 2 ? 'assistant' : 'user',
    createdAt: '2026-10-07T00:00:00.000Z',
    content: index % 2
      ? Array.from({ length: 24 }, (_, paragraph) => `阅读位置验收第 ${index + 1} 条，第 ${paragraph + 1} 段。展开阅读已有内容时，新输出与页面尺寸变化不应把读者拉回底部。`).join('\n\n')
      : `阅读位置验收第 ${index + 1} 条`,
  }));
  await page.route(`${config.APP_ORIGIN}/api/conversations/${conversation}*`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    payload.conversation.messages = transcriptMessages.slice(0, transcriptCount);
    if (payload.pagination) payload.pagination = { ...payload.pagination, total: transcriptCount, hasMore: false, offset: 0 };
    return route.fulfill({ response, json: payload });
  });
  for (const count of [6, 26]) {
    transcriptCount = count;
    await page.reload();
    const transcript = page.locator(count > 20 ? '.chat-virtual-scroller' : '.chat-transcript-scroll');
    await transcript.waitFor();
    await page.waitForFunction(() => {
      const element = document.querySelector('.chat-transcript-scroll, .chat-virtual-scroller');
      return element && element.scrollHeight - element.clientHeight > 900;
    });
    const activeTitle = await page.locator('[data-conversation-row] [aria-current="page"]').first().innerText();
    const readingTop = await transcript.evaluate(element => {
      element.scrollTop = 200;
      element.dispatchEvent(new Event('scroll'));
      return element.scrollTop;
    });
    await page.getByRole('button', { name: '回到最新消息', exact: true }).waitFor();
    // The site sidebar exposes new-chat as the 新聊天 entry.
    await page.getByRole('complementary').getByRole('link', { name: '新聊天' }).click();
    await page.locator('.chat-empty-state').waitFor();
    // The row's selectable target is its link; the first button is the actions menu.
    await page.locator('[data-conversation-row]').filter({ hasText: activeTitle }).first().getByRole('link').first().click();
    await transcript.waitFor();
    await page.getByRole('button', { name: '回到最新消息', exact: true }).waitFor();
    await page.waitForFunction(({ expected, virtualized }) => {
      const element = document.querySelector('.chat-transcript-scroll, .chat-virtual-scroller');
      if (!element) return false;
      return virtualized
        ? element.scrollTop < element.scrollHeight - element.clientHeight - 100
        : Math.abs(element.scrollTop - expected) <= 2;
    }, { expected: readingTop, virtualized: count > 20 });
    const renderedRows = await page.locator('[data-message-id]').count();
    if (count > 20) assert.ok(renderedRows < count, 'virtual transcripts keep the DOM smaller than the whole history');
    const firstScreen = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? 0);
    console.log(`阅读夹具：消息=${count}，DOM 消息=${renderedRows}，DOMContentLoaded=${Math.round(firstScreen)}ms；阅读位置恢复通过。`);
    await page.getByRole('button', { name: '回到最新消息', exact: true }).click();
    await page.waitForFunction(() => {
      const element = document.querySelector('.chat-transcript-scroll, .chat-virtual-scroller');
      return element && element.scrollHeight - element.clientHeight - element.scrollTop < 50;
    });
  }
  console.log('聊天阅读：普通与虚拟列表的阅读位置恢复、回到最新通过。');
  await verifyAgentDomain({ page, context, origin: config.APP_ORIGIN, output: path.join(ROOT,'output','playwright') });
  }
  if (!collaborationOnly) await verifyAgentChartWorkspace({ page, newChat, send, waitForRun, credits, output: directory });
  if (collaborationFixture) await verifyAgentCollaboration({ page, newChat, send, waitForRun, credits, output: directory, fixture: collaborationFixture });
  assert.deepEqual(outside, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  console.log(collaborationOnly ? '多模型协作专项通过；浏览器无外部请求、服务端 5xx 或运行时异常。' : chartOnly ? '命盘专项通过；浏览器无外部请求、服务端 5xx 或运行时异常。' : "普通对话回归通过；浏览器无外部请求、服务端 5xx 或运行时异常。");
  console.log(
    `隔离验收截图：.taibu-local/${project}/${chartOnly ? 'agent-chart-*.png' : 'agent-acceptance.png、agent-mobile-acceptance.png'}；任务数=${created.length}`,
  );
} catch (error) {
  // Surface the real failure first: browser.close() in the finally can otherwise
  // mask it with a pending-response rejection.
  console.error(error instanceof Error ? error.stack : error);
  console.error(
    JSON.stringify({
      pathname: page ? new URL(page.url()).pathname : null,
      outside,
      errors,
      failures,
    }),
  );
  await page
    ?.screenshot({
      path: path.join(directory, "agent-browser-failure.png"),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  collaborationFixture?.dispose();
  if (!keep && existingConversations) {
    try {
      const leftovers = (await listConversations()).filter(id => !existingConversations.has(id));
      for (const id of leftovers) {
        const response = await context.request.delete(`${config.APP_ORIGIN}/api/conversations/${id}`);
        if (!response.ok()) console.warn(`未能删除验收对话 ${id}：${response.status()}`);
      }
      console.log(`已删除本次验收创建的 ${leftovers.length} 个对话（--keep 可保留）。`);
    } catch (error) { console.warn('验收对话清理失败：', error instanceof Error ? error.message : error); }
    for (const id of savedCharts) {
      const response = await context.request.delete(`${config.APP_ORIGIN}/api/user/charts?type=bazi&id=${encodeURIComponent(id)}`).catch(() => null);
      if (!response?.ok()) console.warn(`未能删除验收保存的命盘 ${id}：${response?.status() ?? '请求失败'}`);
    }
  }
  await browser.close();
}
