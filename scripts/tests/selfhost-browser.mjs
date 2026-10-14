import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, validateConfig, validateProject } from '../selfhost.mjs';

async function verifyChartSynchronization(page, context, config) {
  const created = [];
  const baselineResponse = await context.request.get(`${config.APP_ORIGIN}/api/user/charts`);
  assert.equal(baselineResponse.status(), 200);
  const baseline = await baselineResponse.json();
  const marker = `chart-sync-${Date.now()}`;
  await page.evaluate(value => { window.__chartSyncDocument = value; }, marker);
  const sidebar = page.locator('aside').filter({ has: page.getByRole('link', { name: '八字', exact: true }) });
  const openCharts = async () => {
    await sidebar.getByRole('button').last().click();
    await page.getByRole('link', { name: '命盘', exact: true }).click();
    await page.getByRole('heading', { name: '八字命盘', exact: true }).waitFor();
  };
  const closeCharts = () => page.getByRole('link', { name: '返回太卜', exact: true }).click();
  const chartLink = chart => page.locator(`a[href="/${chart.type}/result?chart=${chart.id}"]`).filter({ visible: true });
  const chartRow = chart => page.locator('li').filter({ has: chartLink(chart) });
  const expectSameDocument = async () => {
    assert.equal(await page.evaluate(() => window.__chartSyncDocument), marker, 'synchronization must not depend on a full document reload');
  };
  const createChart = async (type, name, verifySourceCache = false) => {
    await sidebar.getByRole('link', { name: type === 'bazi' ? '八字' : '紫微斗数', exact: true }).click();
    await page.getByPlaceholder('请输入姓名').fill(name);
    await page.locator('form select').nth(0).selectOption('1990');
    await page.locator('form select').nth(1).selectOption('1');
    await page.locator('form select').nth(2).selectOption('2');
    await page.getByRole('button', { name: /出生时间/ }).click();
    await page.locator('input[type=time]').fill('12:00');
    await page.getByLabel('出生地时区（IANA）').fill('America/New_York');
    await page.getByLabel('夏令时重复／缺失时间').selectOption('later');
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.getByRole('button', { name: /开始排盘/, exact: true }).click();
    await page.waitForURL(url => url.pathname === `/${type}/result`);
    let primedAt;
    if (verifySourceCache) {
      const primed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/data-sources');
      await sidebar.getByRole('link', { name: '新聊天', exact: true }).click();
      assert.ok((await primed).ok());
      primedAt = Date.now();
      await page.goBack();
      await page.waitForURL(url => url.pathname === `/${type}/result`);
    }
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/${type}/charts` && response.request().method() === 'POST');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const saved = await savedResponse;
    assert.equal(saved.status(), 201);
    const { id } = await saved.json();
    assert.ok(id);
    const reloaded = await context.request.get(`${config.APP_ORIGIN}/api/${type}/charts?id=${id}`);
    assert.equal(reloaded.status(), 200);
    const { chart: persistedChart } = await reloaded.json();
    assert.equal(persistedChart.timezone, 'America/New_York');
    assert.equal(persistedChart.disambiguation, 'later');
    const chart = { type, id, name };
    created.push(chart);
    await page.waitForURL(url => url.searchParams.get('chart') === id);
    if (verifySourceCache) {
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/data-sources');
      await sidebar.getByRole('link', { name: '新聊天', exact: true }).click();
      const response = await refreshed;
      assert.ok(Date.now() - primedAt < 15_000, 'return before the old server index cache expires');
      assert.ok((await response.json()).items.some(item => item.id === id), 'authoritative source index contains the new chart');
      assert.equal(new URL(response.url()).searchParams.get('fresh'), '1');
      await page.locator('textarea').filter({ visible: true }).last().fill(`@${name}`);
      await page.getByRole('button', { name: new RegExp(name) }).waitFor();
      await page.locator('textarea').filter({ visible: true }).last().fill('');
    }
    await openCharts();
    await chartRow(chart).waitFor({ timeout: 5000 });
    assert.ok(await page.getByRole('heading', { name: '八字命盘', exact: true }).isVisible(), 'chart settings page reflects the saved chart after returning');
    await expectSameDocument();
    await closeCharts();
    return chart;
  };
  try {
    await openCharts();
    await closeCharts();
    const first = await createChart('bazi', `${marker}-bazi`, true);
    const second = await createChart('bazi', `${marker}-alternative`);
    const ziwei = await createChart('ziwei', `${marker}-ziwei`);
    for (const chart of [first, ziwei]) {
      await openCharts();
      await chartLink(chart).click();
      await page.getByRole('button', { name: '修改', exact: true }).click();
      chart.name += '-edited';
      await page.getByPlaceholder('请输入姓名').fill(chart.name);
      await page.getByRole('button', { name: /出生时间/ }).click();
      assert.equal(await page.getByLabel('出生地时区（IANA）').inputValue(), 'America/New_York');
      assert.equal(await page.getByLabel('夏令时重复／缺失时间').inputValue(), 'later');
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await page.getByRole('button', { name: /开始排盘/, exact: true }).click();
      const updated = page.waitForResponse(response => new URL(response.url()).pathname === `/api/${chart.type}/charts/update` && response.request().method() === 'POST');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      assert.ok((await updated).ok());
      await page.getByRole('button', { name: '已保存', exact: true }).waitFor();
      await openCharts();
      await chartRow(chart).getByText(chart.name, { exact: true }).waitFor({ timeout: 5000 });
      await closeCharts();
    }
    // Change the default through the overlay while the monthly page remains mounted.
    // 月运 is not pinned by default; it lives in the sidebar's "全部占术" flyout.
    await sidebar.getByRole('button', { name: /全部占术/ }).click();
    await page.getByRole('dialog', { name: '全部占术' }).getByRole('link', { name: '月运', exact: true }).click();
    await page.getByRole('heading', { name: /月/ }).first().waitFor();
    for (const chart of [first, second]) {
      await openCharts();
      const changed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/user/charts' && response.request().method() === 'PATCH');
      await chartRow(chart).getByTitle('设为默认', { exact: true }).click();
      assert.ok((await changed).ok());
      await chartRow(chart).getByText('默认', { exact: true }).waitFor();
      await closeCharts();
      await page.getByRole('button', { name: new RegExp(`命主:.*${chart.name}`) }).waitFor({ timeout: 5000 });
    }
    // The real picker consumes the same saved-chart bundle.
    await page.getByRole('button', { name: new RegExp(`命主:.*${second.name}`) }).click();
    await page.getByRole('heading', { name: '选择八字命盘', exact: true }).waitFor();
    await page.getByRole('button').filter({ has: page.getByText(first.name, { exact: true }) }).click();
    await page.getByRole('button', { name: new RegExp(`命主:.*${first.name}`) }).waitFor();
    await openCharts();
    await chartRow(first).getByTitle('删除命盘', { exact: true }).click();
    const deleted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/user/charts' && response.request().method() === 'DELETE');
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    assert.ok((await deleted).ok());
    await chartRow(first).waitFor({ state: 'hidden' });
    await closeCharts();
    await page.getByRole('button', { name: new RegExp(`命主:.*${second.name}`) }).waitFor({ timeout: 5000 });
    await expectSameDocument();
    await page.screenshot({ path: path.join(directory, 'chart-sync-acceptance.png'), fullPage: true });
  } finally {
    // Restore defaults only while they still point at this run's charts; preserve concurrent edits.
    const currentResponse = await context.request.get(`${config.APP_ORIGIN}/api/user/charts`);
    assert.ok(currentResponse.ok(), 'read current defaults before scoped cleanup');
    const current = await currentResponse.json();
    for (const type of ['bazi', 'ziwei']) {
      const id = baseline.defaultChartIds[type];
      const ownsDefault = created.some(chart => chart.type === type && chart.id === current.defaultChartIds[type]);
      if (id && ownsDefault) {
        const restored = await context.request.patch(`${config.APP_ORIGIN}/api/user/charts`, { data: { type, id } });
        assert.ok(restored.ok(), 'restore the previous default chart');
      }
    }
    for (const chart of created) {
      const result = await context.request.delete(`${config.APP_ORIGIN}/api/user/charts?type=${chart.type}&id=${chart.id}`);
      assert.ok(result.ok() || result.status() === 404, 'remove only this run\'s synthetic chart');
    }
  }
}

const index = process.argv.indexOf('--project');
const project = validateProject(index < 0 ? 'taibu-local' : process.argv[index + 1]);
const directory = path.join(ROOT, '.taibu-local', project);
const file = path.join(directory, 'config.json');
const stat = await lstat(file);
assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077));
const config = validateConfig(JSON.parse(await readFile(file, 'utf8')));
assert.equal(config.LOCAL_PROJECT, project);
assert.equal(config.DEMO_ENABLED, 'true');
const browser = await chromium.launch({ headless: true, ...(process.argv.includes('--chrome') ? { channel: 'chrome' } : {}) });
const outside = [];
const errors = [];
const failures = [];
let inference = 0;
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  // No HTTP/identity/model mocks: only block unexpected outbound browser traffic.
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === config.APP_ORIGIN) return route.continue();
    outside.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  page = await context.newPage();
  page.on('pageerror', () => errors.push('unhandled browser error'));
  page.on('response', response => {
    if (response.status() >= 500) failures.push(new URL(response.url()).pathname);
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/tarot' && request.method() === 'POST') {
      if (request.postDataJSON()?.action === 'interpret') inference++;
    }
  });
  await page.goto(`${config.APP_ORIGIN}/tarot`);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByPlaceholder('邮箱前缀').fill(config.USER_EMAIL);
  assert.equal(await page.locator('form select').isDisabled(), true);
  await page.getByPlaceholder('输入密码').fill(config.USER_PASSWORD);
  await page.locator('form').getByRole('button', { name: '登录', exact: true }).click();
  await page.getByPlaceholder('输入密码').waitFor({ state: 'hidden' });
  await verifyChartSynchronization(page, context, config);
  if (!process.argv.includes('--sync-only')) {
    await page.getByRole('link', { name: '塔罗', exact: true }).click();
    const question = `Docker 浏览器验收 ${Date.now()}`;
    await page.getByPlaceholder('例如：我的事业发展会如何？').fill(question);
    await page.getByRole('button', { name: /单牌.*开始占卜/ }).click();
    await page.getByRole('button', { name: '翻开所有牌面' }).click();
    await page.getByRole('button', { name: '获取 AI 深度洞察' }).click();
    await page.getByText(/这是本地离线演示回复/).first().waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => document.body.innerText.includes('不提供真实 AI 分析。'));
    assert.equal(inference, 1);
    await page.goto(`${config.APP_ORIGIN}/tarot/history`);
    await page.getByText(question, { exact: true }).click();
    await page.getByText(/这是本地离线演示回复/).first().waitFor({ timeout: 30_000 });
    assert.equal(inference, 1, 'history must not regenerate or bill again');
  }
  assert.ok(!(await page.locator('body').innerText()).includes('加载对话列表失败'));
  const cookies = await context.cookies();
  assert.ok(cookies.some(cookie => cookie.httpOnly), 'real session must use HttpOnly cookies');
  await page.screenshot({ path: path.join(directory, 'browser-acceptance.png'), fullPage: true });
  assert.deepEqual(outside, [], 'browser attempted external requests');
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, [], 'application returned server errors');
  console.log('浏览器验收通过：真实登录、命盘新增/编辑/默认切换/删除的 SPA 即时同步、聊天数据源即时可见；无文档刷新、外部请求或运行时异常。');
  if (!process.argv.includes('--sync-only')) console.log('塔罗验收通过：抽牌、模型流、保存、历史恢复；无额外推理。');
  console.log(`截图：.taibu-local/${project}/browser-acceptance.png、chart-sync-acceptance.png`);
} catch (error) {
  console.error(JSON.stringify({ pathname: page ? new URL(page.url()).pathname : null, outside, errors, failures }));
  await page?.screenshot({ path: path.join(directory, 'browser-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
