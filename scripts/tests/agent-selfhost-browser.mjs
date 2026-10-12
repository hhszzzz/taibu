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
const chartOnly = process.argv.includes('--chart-only');
const collaborationOnly = process.argv.includes('--collaboration-only');
let page;
let collaborationFixture;
try {
  if (!chartOnly) collaborationFixture = await createCollaborationFixture(config);
  const context = await browser.newContext({
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
    if (await mode.getAttribute('aria-checked') !== 'true') await mode.click();
    await page.waitForFunction(() =>
      document.querySelector('[role="radiogroup"][aria-label="对话方式"] [aria-checked="true"]')?.textContent === "Agent",
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
  assert.equal(
    (await get("/api/agent/status")).ready,
    true,
    "real worker heartbeat reaches Web",
  );
  assert.ok((await context.cookies()).some((cookie) => cookie.httpOnly));

  if (!chartOnly && !collaborationOnly) {
  await uiReady();
  const chatBeforeSettings = page.url();
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
  await settingsPage.getByLabel('全站字号').waitFor();
  const appearanceOption = settingsPage.getByRole('radio', { name: '浅色', exact: true });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.ok(await appearanceOption.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) >= .1), 'appearance control normally uses its visual transition');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await appearanceOption.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration) <= .001), 'reduced motion applies to settings controls');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(chatBeforeSettings);
  await uiReady();
  console.log('设置页面：分类草稿、取消离开/后退/前进/刷新、直接访问、旧链接、普通账号权限与减少动画通过。');
  const providerTrigger = page.locator('button[aria-label="自定义模型"]');
  await providerTrigger.click();
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
  assert.ok(await providerTrigger.evaluate(element => element === document.activeElement), 'closing custom model settings returns trigger focus');
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
  const artifacts = finished.message.agent.parts.filter(
    (part) => part.type === "artifact",
  );
  assert.equal(artifacts.filter((part) => part.chartType === "bazi").length, 2);
  assert.equal(artifacts.some(part => part.recordId), false, 'completed analysis stays in chat without a separate record');
  assert.ok(finished.message.content.includes('Agent 离线验收'));
  assert.ok(finished.message.agent.runtime.context.tokens > 0, 'Pi projects the real active transcript');
  assert.equal(finished.message.agent.runtime.model.contextWindow, null, 'unconfigured models have no invented capacity');
  // The composer meter reads the latest projected context and opens its counters.
  const contextMeter = page.getByRole('button', { name: /^上下文用量 / });
  await contextMeter.click();
  const usagePanel = page.getByRole('dialog', { name: '上下文用量', exact: true });
  await usagePanel.waitFor();
  assert.ok((await usagePanel.innerText()).includes('容量未知'));
  assert.ok(['usage', 'mixed', 'estimated'].includes(await contextMeter.getAttribute('data-context-source')), 'the meter reads the projected context');
  await page.screenshot({ path: path.join(directory, 'agent-context-acceptance.png'), fullPage: true });
  await page.keyboard.press('Escape');
  assert.ok(await contextMeter.evaluate(element => element === document.activeElement), 'closing the context counters restores the meter focus');
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
  const workspaceToggle = page.getByRole('button', { name: '任务工作区', exact: true });
  if (await workspaceToggle.getAttribute('aria-expanded') !== 'true') await workspaceToggle.click();
  const panel = page.locator('aside#agent-workspace-panel');
  await panel.waitFor();
  // A chat step opens its view; the process section then shows that step's call as returned, ready to copy.
  await page.locator('.agent-message .agent-process-heading').first().click();
  await page.locator('.agent-message .agent-step-row').first().click();
  await panel.getByRole('tab', { name: '过程', exact: true }).click();
  const call = panel.locator('.agent-ws-call');
  await call.getByRole('region', { name: '调用参数', exact: true }).waitFor();
  await call.getByRole('region', { name: '工具结果', exact: true }).waitFor();
  await call.getByRole('button', { name: '复制调用参数', exact: true }).click();
  const callId = await call.getAttribute('data-tool-id');
  assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), finished.message.agent.parts.find(part => part.type === 'tool' && part.id === callId).input);
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  const originalPanelWidth = (await panel.boundingBox()).width;
  await panel.getByRole('separator', { name: '调整工作区宽度', exact: true }).press('ArrowRight');
  assert.equal((await panel.boundingBox()).width, originalPanelWidth - 24, 'a constrained workspace shrinks from its actual rendered width');
  await panel.getByRole('separator', { name: '调整工作区宽度', exact: true }).press('ArrowLeft');
  assert.equal(await panel.locator('[data-overview-result="reading"]').count(), 2, 'the overview counts each actual tool reading once');
  await panel.getByRole('tab', { name: '过程', exact: true }).click();
  assert.equal(await panel.locator('.agent-ws-steps > li').count(), 3);
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  await page.screenshot({ path: path.join(directory, 'agent-workspace-acceptance.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('html.dark').waitFor();
  // The existing site-wide theme transition lasts 300 ms.
  await delay(350);
  await page.screenshot({ path: path.join(directory, 'agent-workspace-dark-acceptance.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('html:not(.dark)').waitFor();
  await delay(350);
  await panel.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await page.screenshot({
    path: path.join(directory, "agent-acceptance.png"),
    fullPage: true,
  });
  const chartArtifact = artifacts.find(part => part.chartId);
  await page.locator(`a[href="/bazi/result?chart=${encodeURIComponent(chartArtifact.chartId)}"]`).first().click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/bazi/result" &&
      url.searchParams.get("chart") === chartArtifact.chartId,
  );
  console.log(
    "Agent 浏览器：真实登录、跨命盘工具调用、后台完成、刷新恢复、成果入口和一次扣费通过。",
  );
  console.log('Agent UI：任务步骤分组、中文输入法、工具详情复制、聊天分析、原生命盘入口、Pi 上下文与右侧控件通过。');

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
  assert.deepEqual(
    regeneratedResult.message.agent.parts
      .filter((part) => part.type === "artifact" && part.chartId)
      .map((part) => part.chartId)
      .sort(),
    artifacts
      .filter((part) => part.chartId)
      .map((part) => part.chartId)
      .sort(),
    "regeneration reuses the existing native charts",
  );
  assert.equal(await credits(), initial - 2);
  await uiReady();
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
  await page
    .locator("textarea")
    .filter({ visible: true })
    .first()
    .fill("Agent验收：编辑消息后跨命盘对比，在聊天中分析。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const editedResponse = await editResponse;
  assert.equal(editedResponse.status(), 201);
  const edited = await editedResponse.json();
  created.push(edited.id);
  await waitForRun(edited.id, "completed");
  await page.locator('[data-agent-status="completed"]').waitFor();
  assert.equal(await credits(), initial - 3);
  console.log(
    "Agent 浏览器：重新生成、编辑后续跑、历史版本保留及原生命盘复用通过。",
  );

  await newChat();
  const beforeReply = await credits();
  const second = await send("Agent验收：补充信息后排盘，请先询问出生信息。");
  await waitForRun(second.run.id, "awaiting_input");
  await page.goto(`${config.APP_ORIGIN}/chat?id=${second.run.conversationId}`);
  await page.locator('[data-agent-status="awaiting_input"]').waitFor();
  await page.getByText("等待你回答 · 任务已暂停", { exact: true }).waitFor();
  // The questions take the composer's place until answered or folded away.
  const questionDock = page.getByRole('region', { name: /^太卜需要补充 \d+ 项信息$/ });
  await questionDock.waitFor();
  await questionDock.getByText('请补充出生年月日、出生时刻和性别。').waitFor();
  await questionDock.getByRole('textbox').fill('1990年1月15日9时，男。');
  await page.setViewportSize({ width: 390, height: 844 });
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
  await modelMenu.getByRole('menuitemradio', { name: '本地离线演示', exact: true }).click();
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
  assert.equal(
    recovered.message.agent.parts.filter(
      (part) => part.type === "artifact" && part.recordId,
    ).length,
    0,
    'takeover does not create an analysis record',
  );
  assert.equal(recovered.message.agent.parts.filter(part => part.type === 'artifact' && part.chartId).length, 1);
  assert.equal(
    await credits(),
    beforeCrash - 1,
    "worker takeover keeps the original charge",
  );
  console.log(
    "Agent 浏览器：真实 worker 崩溃、租约接管、刷新重连及成果幂等保存通过。",
  );

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
    const activeTitle = await page.locator('[data-conversation-row] button[aria-current="page"]').first().innerText();
    const readingTop = await transcript.evaluate(element => {
      element.scrollTop = 200;
      element.dispatchEvent(new Event('scroll'));
      return element.scrollTop;
    });
    await page.getByRole('button', { name: '回到最新消息', exact: true }).waitFor();
    await page.getByRole('button', { name: '新建对话', exact: true }).click();
    await page.locator('.chat-empty-state').waitFor();
    await page.locator('[data-conversation-row]').filter({ hasText: activeTitle }).first().getByRole('button').first().click();
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
    // Keep the target away from the tail: at the bottom the jump button rightly hides.
    const targetIndex = count === 6 ? 2 : 4;
    await page.getByRole('button', { name: `定位第 ${targetIndex + 1} 条提问`, exact: true }).click();
    await page.waitForFunction(id => {
      const element = document.querySelector('.chat-transcript-scroll, .chat-virtual-scroller');
      const message = element?.querySelector(`[data-message-id="${id}"]`);
      if (!element || !message) return false;
      const viewport = element.getBoundingClientRect(), row = message.getBoundingClientRect();
      return row.top < viewport.bottom - 10 && row.bottom > viewport.top + 4;
    }, transcriptMessages[targetIndex].id);
    const firstScreen = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? 0);
    console.log(`阅读夹具：消息=${count}，DOM 消息=${renderedRows}，DOMContentLoaded=${Math.round(firstScreen)}ms；小地图定位通过。`);
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
  await browser.close();
}
