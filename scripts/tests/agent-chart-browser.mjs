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
  // The task has ended: the workspace it opened shows the overview and has nothing left to follow.
  await readings.first().waitFor();
  assert.equal(await panel.getByRole('tab', { name: '概览', exact: true }).getAttribute('aria-selected'), 'true', 'an ended task’s workspace shows its overview');
  assert.equal(await panel.getByRole('button', { name: '跟随模型', exact: true }).count(), 0);
  assert.equal(await page.locator('.agent-message [data-result-kind]').count(), 11, 'native inspection updates existing charts without duplicating inline cards');
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
  assert.ok((await page.locator('.agent-message .agent-response-time').innerText()).includes('模型响应'), 'a real history reload displays native assistant time');
  assert.ok(tools.some(tool => Number.isFinite(tool.durationMs) && Number.isFinite(tool.startedAt) && Number.isFinite(tool.endedAt)), 'completed native tools retain execution and wall-clock measurements');
  assert.ok((await panel.locator('.agent-board-focus').innerText()).includes(focus.caption), 'refresh rebuilds the exact native focus');
  for (const kind of Object.keys(names)) {
    await openChart(kind);
    if (kind === 'bazi') assert.ok(await panel.locator('.chart-cell-button[aria-pressed=true]').count() >= 2, 'actual relation endpoints are highlighted');
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
  for (const [kind, prefix, count] of [['almanac', 'almanac:hour:', 13], ['astrology', 'astrology:house:', 12]]) {
    // The card of the reading already on screen reads 正在工作区显示; pinning it again is still allowed.
    await page.locator('[data-result-kind="' + kind + '"]').getByRole('button', { name: /^(在工作区查看|正在工作区显示)$/ }).click();
    await selectedTarget(focuses[kind]).waitFor();
    assert.equal(await panel.locator('[data-chart-target^="' + prefix + '"]').count(), count, 'pinning the original calculation also uses its latest inspected full snapshot');
  }
  // A focus step in the process opens its chart at the position it marked.
  await panel.getByRole('tab', { name: '过程', exact: true }).click();
  await panel.locator('.agent-ws-steps button').filter({ hasText: actions.at(-1).title }).last().click();
  await selectedTarget(focus).waitFor();
  assert.ok((await panel.locator('.agent-board-focus').innerText()).includes(focus.caption), 'a focus step opens its chart at its position');
  await openChart('ziwei');
  const composer = () => page.locator('[data-chat-composer] textarea').filter({ visible: true }).last();
  const composerFocused = () => page.waitForFunction(() => [...document.querySelectorAll('[data-chat-composer] textarea')].some(input => input === document.activeElement));
  await composer().fill('保留已有追问草稿');
  await panel.locator('[data-chart-target="ziwei:palace:0"]').click();
  await panel.getByRole('button', { name: '追问这里', exact: true }).click();
  assert.ok((await composer().inputValue()).startsWith('保留已有追问草稿'));
  assert.ok((await composer().inputValue()).includes(focuses.ziwei.reference));
  await composerFocused();
  assert.equal(await credits(), before - 1, 'a chart question fills the draft without sending it');
  await openChart('bazi');
  await panel.locator('.agent-board-relations button').first().click();
  assert.ok(await panel.locator('.chart-cell-button[aria-pressed=true]').count() >= 2);
  await page.setViewportSize({ width: 320, height: 740 });
  const timingBounds = await page.locator('.agent-message .agent-response-time').boundingBox();
  assert.ok(timingBounds && timingBounds.x >= 0 && timingBounds.x + timingBounds.width <= 320, 'native timing stays within the mobile message width');
  const drawer = page.getByRole('dialog', { name: '工作区', exact: true });
  await drawer.waitFor();
  await drawer.locator('[data-chart-target="bazi:cell:2:1"]').click();
  await page.screenshot({ path: path.join(output, 'agent-chart-mobile.png'), fullPage: true });
  await drawer.getByRole('button', { name: '追问这里', exact: true }).click();
  await drawer.waitFor({ state: 'hidden' });
  await composerFocused();
  assert.ok(await composer().evaluate(input => input === document.activeElement), 'mobile chart questions close the drawer and focus the composer');
  assert.equal(await credits(), before - 1);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await composer().fill('');
  console.log('全体系命盘联动：真实 worker/SSE、十一种原盘与定位、各盘历史焦点、完整快照、刷新恢复、桌面/手机追问及一次计费通过；模型为固定栈离线夹具。');
}
