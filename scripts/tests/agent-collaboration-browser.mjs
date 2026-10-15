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
  await newChat();
  const trigger = page.getByRole('button', { name: /^选择模型：/ });
  await trigger.click();
  let dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await dialog.getByRole('menuitemradio', { name: fixture.models[0].name, exact: true }).click();
  await trigger.click();
  dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await dialog.getByRole('radiogroup', { name: '推理档位', exact: true }).getByRole('radio', { name: '最高', exact: true }).click();
  await dialog.getByLabel('启用多模型协作', { exact: true }).check();
  for (const [index, model] of fixture.models.entries()) {
    // The menu edits one member at a time; its chip toggles the editor.
    const chip = dialog.getByRole('group', { name: '协作成员', exact: true }).locator('button[aria-pressed]').nth(index);
    if (await chip.getAttribute('aria-pressed') !== 'true') await chip.click();
    await dialog.getByLabel(`Agent ${index + 1} 模型`, { exact: true }).selectOption(model.key);
    await dialog.getByLabel(`Agent ${index + 1} 推理档位`, { exact: true }).selectOption(index ? 'xhigh' : 'max');
    await dialog.getByLabel(`Agent ${index + 1} 分工`, { exact: true }).fill(index ? '独立核对干支关系与不确定性' : '分析八字天干与日支');
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.floating-panel.chat-model-menu');
    if (!dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  });
  const bounds = await dialog.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320 && bounds.y >= 0 && bounds.y + bounds.height <= 740, 'combined collaboration settings fit a 320px viewport');
  await page.screenshot({ path: path.join(output, 'agent-collaboration-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1100 });
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
  const result = page.locator('.agent-collaboration-results');
  await result.waitFor();
  assert.ok((await result.innerText()).includes(fixture.models[0].name) && (await result.innerText()).includes(fixture.models[1].name), 'persisted history retains actual collaborator names and models');
  await page.screenshot({ path: path.join(output, 'agent-collaboration-acceptance.png'), fullPage: true });
  await newChat();
  await trigger.click();
  dialog = page.getByRole('dialog', { name: '模型与分析设置', exact: true });
  await dialog.getByLabel('启用多模型协作', { exact: true }).uncheck();
  await dialog.getByRole('menuitemradio', { name: '本地离线演示', exact: true }).click();
  console.log('多模型协作：两路真实 SDK 请求、max/xhigh、一次计费、历史恢复和 320px 菜单通过。');
}
