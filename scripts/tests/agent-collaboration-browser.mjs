import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { localDocker, validateResourceOwnership } from '../selfhost.mjs';

/** Temporary model rows are created before the first Web/worker model read and removed after acceptance. */
export async function createCollaborationFixture(config) {
  const env = await localDocker(), container = `${config.LOCAL_PROJECT}-db-1`;
  const marker = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "io.taibu.local.instance"}}', container], { env, encoding: 'utf8' }).trim();
  validateResourceOwnership(marker, config.LOCAL_INSTANCE_ID);
  const models = [randomUUID(), randomUUID()].map((id, index) => ({ id, key: `fixture-team-${id}`, name: `协作验收${index + 1}` }));
  const sql = input => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'taibu'], { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const ids = models.map(model => `'${model.id}'`).join(',');
  sql(`BEGIN;
    ${models.map(model => `INSERT INTO public.ai_models(id,model_key,display_name,vendor,required_tier,usage_type,routing_mode,supports_reasoning,reasoning_required_tier,reasoning_effort_format) VALUES('${model.id}','${model.key}','${model.name}','local','free','chat','newapi',true,'free','reasoning_effort');
    INSERT INTO public.ai_model_gateway_bindings(model_id,gateway_id,model_id_override) SELECT '${model.id}',id,'${model.key}' FROM public.ai_gateways WHERE gateway_key='newapi';`).join('\n')}
    COMMIT;`);
  const dispose = () => sql(`BEGIN; DELETE FROM public.ai_model_gateway_bindings WHERE model_id IN (${ids}); DELETE FROM public.ai_models WHERE id IN (${ids}); COMMIT;`);
  try {
    assert.equal(sql("SELECT count(*) FROM public.agent_runs WHERE status IN ('queued','running','awaiting_input','cancelling');").trim(), '0', 'fixture catalog refresh requires no active tasks');
    const runtime = ['web', 'worker'].map(service => `${config.LOCAL_PROJECT}-${service}-1`);
    for (const container of runtime) {
      const marker = execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "io.taibu.local.instance"}}', container], { env, encoding: 'utf8' }).trim();
      validateResourceOwnership(marker, config.LOCAL_INSTANCE_ID);
    }
    execFileSync('docker', ['restart', ...runtime], { env, stdio: 'pipe' });
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      ready = runtime.every(container => execFileSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', container], { env, encoding: 'utf8' }).trim() === 'healthy');
      if (ready) break;
      await delay(500);
    }
    assert.ok(ready, 'owned Web and worker become healthy after the fixture catalog refresh');
  } catch (error) { dispose(); throw error; }
  return { models, dispose };
}

export async function verifyAgentCollaboration({ page, newChat, send, waitForRun, credits, output, fixture }) {
  const origin = new URL(page.url()).origin;
  await newChat();
  const trigger = page.getByRole('button', { name: /^选择模型：/ });
  await trigger.click();
  let dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await dialog.getByRole('menuitemradio', { name: '本地离线演示' }).click();
  // 努力程度是模型菜单的二级页（claude 同构），不再是内嵌单选组。
  await trigger.click();
  dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await dialog.getByRole('menuitem', { name: /^努力程度/ }).click();
  await page.getByRole('menu', { name: '努力程度', exact: true }).getByRole('menuitemradio', { name: '最高', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await trigger.click();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.floating-panel.chat-model-menu');
    if (!dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  });
  dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320 && bounds.y >= 0 && bounds.y + bounds.height <= 740, 'the model menu fits a 320px viewport');
  await page.screenshot({ path: path.join(output, 'agent-collaboration-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1100 });
  // 成员配置在设置 › 个性化 › 多模型协作：编辑后回到新对话，预设作为下一项任务配置生效。
  await page.goto(`${origin}/settings/personalization`);
  await page.getByRole('switch', { name: '启用多模型协作', exact: true }).click();
  // 成员默认一个都不选（0–4）：先加两名成员，再逐项配置。
  for (let index = 0; index < fixture.models.length; index++) await page.getByRole('button', { name: '添加成员', exact: true }).click();
  for (const [index, model] of fixture.models.entries()) {
    await page.getByLabel(`Agent ${index + 1} 模型`, { exact: true }).selectOption(model.key);
    await page.getByLabel(`Agent ${index + 1} 努力程度`, { exact: true }).selectOption(index ? 'xhigh' : 'max');
    await page.getByLabel(`Agent ${index + 1} 分工`, { exact: true }).fill(index ? '独立核对干支关系与不确定性' : '分析八字天干与日支');
  }
  await page.goto(`${origin}/chat`);
  await page.waitForFunction(() => document.querySelector('[data-agent-ready]'));
  await trigger.click();
  dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await dialog.getByRole('menuitem', { name: /多模型协作/ }).click();
  const collabMenu = page.getByRole('menu', { name: '多模型协作', exact: true });
  await collabMenu.waitFor();
  assert.equal(await collabMenu.getByRole('menuitemcheckbox', { checked: true }).count(), 2, 'the settings preset turns collaboration on for the next task');
  await page.keyboard.press('Escape');
  const before = await credits();
  const submitted = await send('Agent验收：多模型协作，请两位成员独立分析八字，主模型核对并汇总。');
  const run = await waitForRun(submitted.run.id, 'completed', 320);
  assert.equal(await credits(), before - 1, 'all collaborator requests share one task charge');
  assert.equal(submitted.payload.reasoningEffort, 'max');
  assert.equal(submitted.payload.collaborators.length, 2);
  const analyses = run.message.agent.parts.find(part => part.type === 'tool' && part.name === 'parallel_analysis').output.analyses;
  assert.equal(analyses.length, 2);
  for (const [index, model] of fixture.models.entries()) {
    const analysis = analyses.find(item => item.model === model.key);
    assert.equal(analysis.status, 'completed');
    assert.ok(analysis.answer.includes(`实际模型：${model.key}`));
    assert.ok(analysis.answer.includes(`实际推理档位：${index ? 'xhigh' : 'max'}`));
  }
  await page.reload();
  const process = page.locator('.agent-process-heading').first();
  await process.waitFor();
  assert.ok((await process.innerText()).includes('开启 2 个智能体'), 'the folded process line names the collaborating agents');
  if (await process.getAttribute('aria-expanded') !== 'true') await process.click();
  const teamStep = page.locator('.agent-step').filter({ has: page.locator('.agent-step-title', { hasText: '协作分析' }) }).first();
  await teamStep.locator('.agent-step-row').click();
  await teamStep.getByRole('button', { name: '在工作区查看', exact: true }).click();
  const panel = page.locator('aside#agent-workspace-panel, [role="dialog"][aria-label="工作区"]').first();
  await panel.waitFor();
  const collaboration = panel.locator('[data-workspace-view="collaboration"]');
  await collaboration.waitFor();
  assert.ok((await collaboration.innerText()).includes(fixture.models[0].name) && (await collaboration.innerText()).includes(fixture.models[1].name), 'persisted history retains actual collaborator names and models');
  await page.screenshot({ path: path.join(output, 'agent-collaboration-acceptance.png'), fullPage: true });
  await newChat();
  await trigger.click();
  dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await dialog.getByRole('menuitem', { name: /多模型协作/ }).click();
  const clearCollab = page.getByRole('menu', { name: '多模型协作', exact: true });
  await clearCollab.waitFor();
  // 逐项按名称取消：按 checked 过滤会在每次重渲染时丢掉目标，导致点击等待超时。
  for (const model of fixture.models) {
    const row = clearCollab.getByRole('menuitemcheckbox', { name: model.name, exact: true });
    if (await row.getAttribute('aria-checked') === 'true') await row.click();
  }
  await page.keyboard.press('Escape');
  await dialog.getByRole('menuitemradio', { name: '本地离线演示' }).click();
  console.log('多模型协作：两路真实 SDK 请求、max/xhigh、一次计费、历史恢复和 320px 菜单通过。');
}
