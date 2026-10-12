import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Exercise the added UI using the same authenticated fixed-stack session. */
export async function verifyAgentExperience({ page, context, origin, directory, conversationId }) {
  // The input's accessible name follows the conversation state, so locate it by the composer.
  const composer = () => page.locator('[data-chat-composer] textarea');
  const ready = () => page.locator('[data-agent-ready="true"]').waitFor();
  const read = async route => {
    const response = await context.request.get(`${origin}${route}`);
    assert.ok(response.ok(), `experience read ${route}: ${response.status()}`);
    return response.json();
  };
  const chatBeforeSettings = page.url();
  const originalSettings = (await read('/api/user/settings')).settings;
  const originalReminders = (await read('/api/reminders')).data.subscriptions;
  try {
    await page.getByRole('link', { name: '个性化', exact: true }).click();
    const settings = page.locator('.settings-page');
    await settings.getByRole('link', { name: '常规', exact: true }).click();
    const scale = settings.getByLabel('全站字号');
    for (const value of [85, 100, 115, 125]) {
      if (await scale.inputValue() !== String(value)) {
        const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/user/settings' && response.request().method() === 'PATCH');
        await scale.selectOption(String(value));
        assert.ok((await saved).ok(), 'font scale persists');
      }
      const rootSize = await page.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
      assert.ok(Math.abs(rootSize - 16 * value / 100) < .1, `global rem scale ${value}%`);
    }
    if (!originalSettings.briefingConfigured) {
      const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      assert.equal(await settings.getByLabel('早报时区').inputValue(), browserZone || 'Asia/Shanghai', 'unconfigured briefing starts in browser timezone');
    }
    assert.equal(await settings.getByRole('switch', { name: '每日早报', exact: true }).getAttribute('aria-checked'), String(originalReminders.find(item => item.reminderType === 'daily_briefing')?.enabled ?? false), 'acceptance preserves the paid subscription state');
    await page.goto(chatBeforeSettings);
    await settings.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 320, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '320px with 125% global fonts stays within viewport');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByRole('link', { name: '个性化', exact: true }).click();
    await settings.getByRole('link', { name: '常规', exact: true }).click();
    if (await scale.inputValue() !== String(originalSettings.chatPreferences.fontScale)) {
      const restoreScale = page.waitForResponse(response => new URL(response.url()).pathname === '/api/user/settings' && response.request().method() === 'PATCH');
      await scale.selectOption(String(originalSettings.chatPreferences.fontScale));
      assert.ok((await restoreScale).ok());
    }
    await page.goto(chatBeforeSettings);
    await settings.waitFor({ state: 'hidden' });
  } finally {
    // Preserve preferences even when an assertion interrupts the UI restore.
    const current = (await read('/api/user/settings')).settings.chatPreferences;
    if (current.fontScale !== originalSettings.chatPreferences.fontScale) {
      const restored = await context.request.patch(`${origin}/api/user/settings`, {
        data: { chatPreferences: { ...current, fontScale: originalSettings.chatPreferences.fontScale } },
      });
      assert.ok(restored.ok(), 'font scale is restored after acceptance');
    }
  }

  // The reading width lives in the header's more menu, next to the conversation actions.
  await page.getByRole('button', { name: '更多对话操作', exact: true }).click();
  const width = page.getByRole('dialog', { name: '更多对话操作', exact: true }).getByRole('slider', { name: '阅读列宽', exact: true });
  const previousWidth = await width.inputValue();
  await width.press('End');
  assert.equal(await width.inputValue(), '1200');
  await width.press('Home');
  assert.equal(await width.inputValue(), '560');
  for (let value = 560; value < Number(previousWidth); value += 20) await width.press('ArrowRight');
  await page.keyboard.press('Escape');
  const workspaceToggle = page.getByRole('button', { name: '任务工作区', exact: true });
  if (await workspaceToggle.getAttribute('aria-expanded') !== 'true') await workspaceToggle.click();
  const workspace = page.locator('aside#agent-workspace-panel');
  // Views the model opened while followed stay as tabs; start this check from none.
  await workspace.getByRole('button', { name: '工作区更多操作', exact: true }).click();
  const closeTabs = page.getByRole('menuitem', { name: '关闭全部标签', exact: true });
  if (await closeTabs.isEnabled()) await closeTabs.click();
  else await page.keyboard.press('Escape');
  const resourceTabs = workspace.locator('.agent-ws-resource-tab [role=tab]');
  const readings = workspace.locator('[data-overview-result="reading"]');
  await workspace.getByRole('tab', { name: '概览', exact: true }).click();
  await readings.first().click();
  await workspace.getByRole('tabpanel').waitFor();
  const firstTab = await workspace.getByRole('tab', { selected: true }).textContent();
  await workspace.getByRole('tab', { name: '概览', exact: true }).click();
  await readings.last().click();
  assert.equal(await resourceTabs.count(), 2);
  await resourceTabs.last().press('ArrowLeft');
  assert.equal(await workspace.getByRole('tab', { selected: true }).textContent(), firstTab, 'resource tabs have keyboard navigation');
  await workspace.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await page.getByRole('button', { name: '任务工作区', exact: true }).click();
  assert.equal(await workspace.getByRole('tab', { selected: true }).textContent(), firstTab, 'closing and reopening restores selected resource');
  await workspace.getByRole('button', { name: '关闭工作区', exact: true }).evaluate(button => {
    button.click();
    document.querySelector('[data-chat-composer] textarea').focus();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await composer().evaluate(element => element === document.activeElement), 'workspace focus return preserves a newly focused composer');

  await composer().fill('/methods');
  await page.getByRole('listbox', { name: '输入命令' }).waitFor();
  await composer().press('Enter');
  const methods = page.getByRole('dialog', { name: '选择分析方法', exact: true });
  await methods.waitFor();
  await methods.locator('button').first().click();
  assert.ok((await composer().inputValue()).includes('方法（'), 'method selection becomes an editable request');
  await composer().fill('/clear');
  await composer().press('Enter');
  assert.equal(await composer().inputValue(), '', 'slash commands do not submit a model task');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await composer().press('ArrowUp');
  assert.ok((await composer().inputValue()).includes('Agent验收'), 'input history recalls the previous submitted question');
  await composer().fill('');

  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByRole('dialog', { name: '搜索对话', exact: true });
  await search.waitFor();
  const searchResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/search');
  await search.getByRole('textbox', { name: '搜索对话内容' }).fill('Agent 离线验收');
  const results = await (await searchResponse).json();
  assert.ok(results.results.some(item => item.conversationId === conversationId), 'search indexes the current branch');
  await search.locator('button').filter({ has: page.locator('strong') }).first().click();
  await page.waitForURL(url => url.pathname === '/chat' && url.searchParams.has('message'));
  const locatedId = new URL(page.url()).searchParams.get('message');
  await page.locator(`[data-message-id="${locatedId}"]`).waitFor();
  await page.goto(`${origin}/chat?id=${conversationId}`);
  await ready();

  const exportDialog = page.getByRole('dialog', { name: '导出对话', exact: true });
  for (const [label, format] of [['Markdown', 'md'], ['可打印 HTML', 'html']]) {
    await composer().fill('/export');
    await composer().press('Enter');
    await exportDialog.waitFor();
    const downloading = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const download = await downloading;
    const filename = path.join(directory, `agent-export-acceptance.${format}`);
    await download.saveAs(filename);
    const content = await readFile(filename, 'utf8');
    assert.ok(content.includes('Agent 离线验收') && content.includes('命盘依据'), 'export includes body and chart basis');
    assert.ok(!/<script\b/iu.test(content), 'HTML exports have no executable scripts');
    // A finished download closes the dialog.
    await exportDialog.waitFor({ state: 'hidden' });
  }

  const beforeFork = (await read('/api/user/membership')).membership.aiChatCount;
  const forkResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/conversations/${conversationId}/fork`);
  await page.getByRole('group', { name: '助手消息操作', exact: true }).last().getByRole('button', { name: '从此回答分叉', exact: true }).click();
  const fork = await (await forkResponse).json();
  await page.waitForURL(url => url.searchParams.get('id') === fork.conversationId);
  await ready();
  const branch = (await read(`/api/conversations/${fork.conversationId}`)).conversation;
  assert.ok(branch.messages.length > 0 && branch.messages.every(message => message.metadata?.forkHistory), 'fork creates read-only history with new message IDs');
  assert.equal((await read('/api/user/membership')).membership.aiChatCount, beforeFork, 'fork does not debit credits');
  assert.equal(await page.getByRole('button', { name: '重新生成', exact: true }).count(), 0, 'copied history cannot regenerate');
  await page.goto(`${origin}/chat?id=${conversationId}`);
  await ready();

  const uploadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agent/attachments' && response.request().method() === 'POST');
  await composer().evaluate(element => {
    const clipboard = new DataTransfer(); clipboard.setData('text/plain', '长期参考资料\n'.repeat(1300));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });
  const uploaded = await uploadResponse;
  assert.equal(uploaded.status(), 201);
  const { attachment } = await uploaded.json();
  assert.equal(await composer().inputValue(), '', 'long paste becomes a private attachment');
  const attachmentChip = () => page.locator('.agent-attachment-chip').filter({ hasText: attachment.name });
  await attachmentChip().waitFor();
  await page.reload();
  await ready();
  await attachmentChip().waitFor();
  await attachmentChip().getByRole('button').first().click();
  const preview = page.getByRole('dialog', { name: attachment.name, exact: true });
  await preview.locator('pre').filter({ hasText: '长期参考资料' }).waitFor();
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'hidden' });
  await attachmentChip().getByRole('button', { name: `移除 ${attachment.name}`, exact: true }).click();
  await attachmentChip().waitFor({ state: 'detached' });
  // The upload remains unbound and follows the regular 24-hour reclamation.
  const imageResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/agent/attachments' && response.request().method() === 'POST');
  const imageBuffer = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#e7af66' } }).png().toBuffer();
  await page.locator('[data-chat-composer] input[type=file]').setInputFiles({ name: 'image-acceptance.png', mimeType: 'image/png', buffer: imageBuffer });
  const imageUploaded = await imageResponse;
  assert.equal(imageUploaded.status(), 201);
  const imageAttachment = (await imageUploaded.json()).attachment;
  assert.equal(imageAttachment.kind, 'image');
  const imageChip = () => page.locator('.agent-attachment-chip').filter({ hasText: imageAttachment.name });
  await imageChip().waitFor();
  await page.reload();
  await ready();
  await imageChip().getByRole('button').first().click();
  const imagePreview = page.getByRole('dialog', { name: imageAttachment.name, exact: true });
  await imagePreview.getByRole('img').waitFor();
  await imagePreview.getByRole('img').evaluate(element => element.decode());
  assert.ok(await imagePreview.getByRole('img').evaluate(element => element.naturalWidth > 0), 'private image is restored and read through the authenticated endpoint');
  await page.keyboard.press('Escape');
  await imageChip().getByRole('button', { name: `移除 ${imageAttachment.name}`, exact: true }).click();
  await imageChip().waitFor({ state: 'detached' });
  await verifyAttachmentReferences({ context, origin, text: attachment, image: imageAttachment });
  console.log('Agent 新体验：四档全站字号、320px、列宽、资源标签恢复、方法命令、历史召回、搜索定位、双格式导出、分叉、长文本与私有图片恢复通过。');
}

export async function verifyAttachmentReferences({ context, origin, text, image }) {
  const temporary = new Set();
  try {
    const answerId = randomUUID();
    const createdAt = new Date().toISOString();
    const source = await context.request.post(`${origin}/api/conversations`, { data: {
      title: '私有资料引用验收',
      messages: [
        { id: randomUUID(), role: 'user', content: '验收文本与图片的持久引用。', createdAt, attachments: { ids: [text.id, image.id] } },
        { id: answerId, role: 'assistant', content: '这是静态资料引用夹具，无模型调用。', createdAt },
      ],
    } });
    assert.equal(source.status(), 201, 'conversation commits owned attachment references');
    const { id } = await source.json();
    temporary.add(id);
    const forked = await context.request.post(`${origin}/api/conversations/${id}/fork`, { data: { messageId: answerId } });
    assert.ok(forked.ok(), 'fork copies attachment references');
    const { conversationId } = await forked.json();
    temporary.add(conversationId);
    const deleted = await context.request.delete(`${origin}/api/conversations/${id}`);
    assert.ok(deleted.ok(), 'only the temporary source is removed');
    temporary.delete(id);
    const branch = await context.request.get(`${origin}/api/conversations/${conversationId}`);
    assert.ok(branch.ok());
    assert.deepEqual((await branch.json()).conversation.messages[0].attachments.ids, [text.id, image.id]);
    const retained = await context.request.get(`${origin}/api/agent/attachments/${text.id}?content=1&length=16000`);
    assert.ok(retained.ok(), 'deleting a source conversation preserves forked text');
    const content = await retained.json();
    assert.equal(content.text.length, content.total);
    assert.ok(content.text.includes('长期参考资料'));
    const picture = await context.request.get(`${origin}/api/agent/attachments/${image.id}?content=1`);
    assert.ok(picture.ok(), 'deleting a source conversation preserves forked images');
    for (const format of ['md', 'html']) {
      const exported = await context.request.get(`${origin}/api/conversations/${conversationId}/export?format=${format}`);
      assert.ok(exported.ok(), 'fork exports include privately stored files');
      const body = await exported.text();
      assert.ok(body.includes(content.text) && body.includes(`data:${image.mimeType};base64,`));
      assert.ok(!/<script\b/iu.test(body));
    }
    const anonymous = await context.browser().newContext();
    try {
      assert.equal((await anonymous.request.get(`${origin}/api/agent/attachments/${image.id}?content=1`)).status(), 401, 'private files require authentication');
    } finally { await anonymous.close(); }
    console.log('资料真实链路：引用保存、分叉、删除原对话后的文件保留、双格式完整导出与匿名访问隔离通过。');
  } finally {
    for (const id of temporary) {
      const removed = await context.request.delete(`${origin}/api/conversations/${id}`);
      assert.ok(removed.ok(), 'temporary attachment conversations are reclaimed');
    }
  }
}
