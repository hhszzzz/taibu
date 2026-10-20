import assert from 'node:assert/strict';
import path from 'node:path';

/** Real web/worker/DB/SSE, with the fixed stack's deterministic offline model. */
export async function verifyAgentChartWorkspace({ page, newChat, send, waitForRun, credits, output }) {
  await newChat();
  const before = await credits();
  const submitted = await send('Agent验收：全体系命盘联动，请依次查看全部十一种盘面的实际位置和关系。');
  const run = await waitForRun(submitted.run.id, 'completed', 400);
  assert.equal(await credits(), before - 1, 'chart tools do not add a second task charge');
  const tools = run.message.agent.parts.filter(part => part.type === 'tool');
  const actions = tools.filter(tool => tool.name === 'focus_chart' && tool.status === 'completed');
  const names = { bazi: '八字命盘', ziwei: '紫微命盘', qimen: '奇门九宫盘', liuyao: '六爻卦盘', meihua: '梅花卦盘', daliuren: '大六壬天地盘', xiaoliuren: '小六壬课盘', tarot: '塔罗牌阵', taiyi: '太乙局盘', astrology: '西方占星盘', almanac: '黄历择日' };
  assert.equal(actions.length, 11, 'the actual worker completed one native focus for every system');
  assert.equal(tools.filter(tool => Object.hasOwn(names, tool.name) && tool.status === 'completed').length, 11);
  const inspected = tools.filter(tool => tool.name === 'inspect_chart' && tool.status === 'completed');
  assert.equal(new Set(inspected.map(tool => tool.output.chartKind)).size, 11);
  const focuses = Object.fromEntries(Object.keys(names).map(kind => {
    const reference = inspected.find(tool => tool.output.chartKind === kind).output.chartReference;
    return [kind, actions.find(tool => tool.output.chartFocus.reference === reference).output.chartFocus];
  }));
  const focus = actions.at(-1).output.chartFocus;
  const lastKind = Object.keys(focuses).find(kind => focuses[kind] === focus);
  const panel = page.locator('aside#agent-workspace-panel');
  await panel.waitFor();
  const selectedTarget = current => panel.locator('[data-chart-target="' + current.targetIds[0] + '"][aria-pressed=true]');
  const readings = panel.locator('[data-overview-result="reading"]');
  // The table cells highlight one render after the focus target: the relation
  // highlight is derived from the parsed chart directory, not the focus alone.
  const settledHighlights = async minimum => {
    await panel.locator('.chart-cell-button[aria-pressed="true"]').nth(minimum - 1).waitFor({ timeout: 5000 }).catch(() => {});
    return panel.locator('.chart-cell-button[aria-pressed=true]').count();
  };
  // 自动打开现在直接落到产生这次任务的命盘，而不是概览；先确认命盘再切回概览。
  await panel.locator('[data-chart-kind]').first().waitFor();
  await panel.getByRole('tab', { name: '概览', exact: true }).click();
  await readings.first().waitFor();
  assert.equal(await panel.getByRole('tab', { name: '概览', exact: true }).getAttribute('aria-selected'), 'true', 'an ended task’s workspace shows its overview');
  await panel.getByRole('button', { name: '跟随模型', exact: true }).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  assert.equal(await panel.getByRole('button', { name: '跟随模型', exact: true }).count(), 0);
  assert.equal(await page.locator('.agent-message [data-result-kind], .agent-result-card').count(), 0, 'the transcript no longer repeats chart results');
  await page.waitForFunction(() => (document.querySelector('aside#agent-workspace-panel')?.getBoundingClientRect().width ?? 0) >= 640, undefined, { timeout: 5000 }).catch(() => {});
  const initialWidth = (await panel.boundingBox()).width;
  assert.ok(initialWidth >= 640, 'the default workspace fits the complete twelve-palace chart');
  const resizer = panel.getByRole('separator', { name: '调整工作区宽度', exact: true });
  await resizer.focus();
  await resizer.press('ArrowLeft');
  await page.waitForFunction(width => document.querySelector('aside#agent-workspace-panel')?.getBoundingClientRect().width >= width + 23, initialWidth);
  await resizer.press('ArrowRight');
  await page.setViewportSize({ width: 1280, height: 1100 });
  assert.ok((await page.locator('.chat-main').boundingBox()).width >= 360, 'narrow desktop viewports retain space for the chat');
  await page.setViewportSize({ width: 1440, height: 1100 });
  assert.equal(await page.getByRole('button', { name: '任务工作区', exact: true }).getAttribute('aria-expanded'), 'true', 'a new model chart opens the desktop workspace');
  const openChart = async kind => {
    await panel.getByRole('tab', { name: '概览', exact: true }).click();
    assert.equal(await readings.count(), 11, 'inspection and final artifacts are deduplicated');
    await readings.filter({ hasText: names[kind] }).click();
    await selectedTarget(focuses[kind]).waitFor();
    assert.equal(await panel.locator('.agent-board-focus').getAttribute('data-chart-focus'), focuses[kind].targetIds.join(','), kind + ' retains its own native focus when switching readings');
  };
  await openChart(lastKind);
  await page.reload();
  await selectedTarget(focus).waitFor();
  const responses = run.message.agent.runtime.responses;
  assert.ok(responses.length > 0 && responses.every(response => Number.isFinite(response.durationMs) && Number.isFinite(response.startedAt) && Number.isFinite(response.endedAt)), 'the native runtime persists assistant timing through the run API');
  // 用时只落库、不展示（用户裁定 2026-10-17）：真实历史重载也不把秒数带回屏幕。
  assert.equal(await page.locator('.agent-message .agent-response-time').count(), 0, 'a real history reload keeps native assistant time off the screen');
  assert.ok(tools.some(tool => Number.isFinite(tool.durationMs) && Number.isFinite(tool.startedAt) && Number.isFinite(tool.endedAt)), 'completed native tools retain execution and wall-clock measurements');
  assert.ok((await panel.locator('.agent-board-focus').innerText()).includes(focus.caption), 'refresh rebuilds the exact native focus');
  for (const kind of Object.keys(names)) {
    await openChart(kind);
    if (kind === 'bazi') assert.ok(await settledHighlights(2) >= 2, 'actual relation endpoints are highlighted');
    if (kind === 'ziwei') {
      assert.equal(await panel.locator('[data-chart-selected=true]').count(), 1);
      assert.equal(await panel.locator('[data-chart-kind="ziwei"] svg line').count(), 3, 'existing three-direction links follow the chosen star palace');
      const chartBounds = await panel.locator('[data-chart-kind="ziwei"]').boundingBox();
      const panelBounds = await panel.boundingBox();
      assert.ok(chartBounds.x >= panelBounds.x && chartBounds.x + chartBounds.width <= panelBounds.x + panelBounds.width, 'all twelve palaces fit in the default desktop workspace');
    }
    if (kind === 'taiyi') assert.equal(await panel.locator('[data-chart-target^="taiyi:palace:"]:not([data-chart-target*="star"])').count(), 17, 'the traditional chart includes its sixteen directions and center');
    if (kind === 'astrology') {
      assert.equal(await panel.locator('[data-chart-target^="astrology:house:"]').count(), 12);
      assert.equal(await panel.locator('[data-chart-planet]').count(), 12, 'the wheel uses actual natal and anchor coordinates');
    }
    if (kind === 'almanac') assert.equal(await panel.locator('[data-chart-target^="almanac:hour:"]').count(), 13, 'both Zi periods from the original daily result are retained');
    await selectedTarget(focuses[kind]).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'agent-chart-' + kind + '.png'), fullPage: true });
  }
  for (const [kind, title, prefix, count] of [['almanac', '黄历择日', 'almanac:hour:', 13], ['astrology', '西方占星盘', 'astrology:house:', 12]]) {
    // 会话栏成果行 = 重新打开已在屏幕上的命盘；打开工作区后会话栏让位，先收起再点。
    await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
    // 成果卡默认只列前几项，其余通过「显示更多」展开（claude 同款）。
    const railMore = page.locator('#agent-session-panel').getByRole('button', { name: '显示更多', exact: true });
    if (await railMore.count()) await railMore.click();
    await page.locator('#agent-session-panel').getByRole('button', { name: new RegExp(title) }).first().click();
    await selectedTarget(focuses[kind]).waitFor();
    assert.equal(await panel.locator('[data-chart-target^="' + prefix + '"]').count(), count, 'pinning the original calculation also uses its latest inspected full snapshot');
  }
  // A focus step in the chat process opens its chart at the position it marked.
  const processToggle = page.locator('.agent-message .agent-process-heading').last();
  if (await processToggle.getAttribute('aria-expanded') !== 'true') await processToggle.click();
  const focusStep = page.locator('.agent-message .agent-step').filter({ hasText: actions.at(-1).title }).last();
  if (await focusStep.locator('.agent-step-row').getAttribute('aria-expanded') !== 'true') await focusStep.locator('.agent-step-row').click();
  // 定位步骤的结构化结果自带「查看盘面」入口，不再重复「在工作区查看」。
  const openFocus = focusStep.getByRole('button', { name: /^(在工作区查看|查看盘面|查看详查)$/ });
  if (await openFocus.count()) await openFocus.click();
  else await focusStep.getByRole('button', { name: '查看盘面', exact: true }).click();
  await selectedTarget(focus).waitFor();
  assert.ok((await panel.locator('.agent-board-focus').innerText()).includes(focus.caption), 'a focus step opens its chart at its position');
  await openChart('ziwei');
  const composer = () => page.locator('[data-chat-composer] textarea').filter({ visible: true }).last();
  const composerFocused = () => page.waitForFunction(() => [...document.querySelectorAll('[data-chat-composer] textarea')].some(input => input === document.activeElement));
  await composer().fill('保留已有追问草稿');
  // 点击盘面 = 像提及一样把该位置追加到输入尾部；高亮仍是模型给出的位置，不再有人工清除。
  await panel.locator('[data-chart-target="ziwei:palace:0"]').click();
  await page.waitForFunction(() => {
    const inputs = [...document.querySelectorAll('[data-chat-composer] textarea')].filter(input => input.getClientRects().length);
    return inputs.some(input => input.value.includes('@') && input.value.includes('紫微'));
  });
  assert.ok((await composer().inputValue()).startsWith('保留已有追问草稿'), 'the chart quote appends to the existing draft');
  assert.ok((await composer().inputValue()).includes('@'), 'the chart quote lands as an inline @ token, like a mention');
  await composerFocused();
  assert.equal(await panel.getByRole('button', { name: '清除盘面高亮', exact: true }).count(), 0, 'manual highlight clearing is gone');
  assert.equal(await credits(), before - 1, 'a chart question fills the draft without sending it');
  await openChart('bazi');
  assert.ok(await settledHighlights(2) >= 2, 'the model-given focus stays highlighted');
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await page.locator('.agent-message .agent-response-time').count(), 0, 'no assistant timing reaches the mobile message');
  const drawer = page.getByRole('dialog', { name: '工作区', exact: true });
  await drawer.waitFor();
  await drawer.locator('[data-chart-target="bazi:cell:2:1"]').click();
  await page.screenshot({ path: path.join(output, 'agent-chart-mobile.png'), fullPage: true });
  await drawer.waitFor({ state: 'hidden' });
  await composerFocused();
  assert.ok((await composer().inputValue()).includes('八字'), 'a second chart question stacks another inline token');
  assert.ok(await composer().evaluate(input => input === document.activeElement), 'mobile chart questions close the drawer and focus the composer');
  assert.equal(await credits(), before - 1);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await composer().fill('');
  console.log('全体系命盘联动：真实 worker/SSE、十一种原盘与定位、各盘历史焦点、完整快照、刷新恢复、桌面/手机追问及一次计费通过；模型为固定栈离线夹具。');
}
