import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function verifyAgentDomain({ page, context, origin, output }) {
    const response=await context.request.get(`${origin}/api/user/settings`);
    assert.ok(response.ok()); const saved=(await response.json()).settings.chatPreferences;
    const name=`domain-${randomUUID().slice(0,8)}`;
    let memoryId;
    const restore=async()=>{ const result=await context.request.patch(`${origin}/api/user/settings`,{data:{chatPreferences:{...saved,memoryEnabled:saved.memoryEnabled===true}}});assert.ok(result.ok()); };
    try {
        await page.goto(`${origin}/settings/personalization`);
        const panel=page.getByRole('region',{name:'任务助手设置'});
        await panel.getByRole('switch',{name:'允许任务助手读取和保存长期记忆'}).check();
        const savedSettings=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/user/settings'&&r.request().method()==='PATCH');
        await panel.getByRole('button',{name:'保存任务助手设置',exact:true}).click();
        assert.ok((await savedSettings).ok());
        await panel.getByLabel('新记忆标题',{exact:true}).fill(name);
        await panel.getByLabel('新记忆正文',{exact:true}).fill('验收记录：我希望回答简洁直接。');
        const created=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/user/agent-memory'&&r.request().method()==='POST');
        await panel.getByRole('button',{name:'保存这条记忆',exact:true}).click();
        const createdResponse=await created;assert.ok(createdResponse.ok());
        memoryId=(await createdResponse.json()).memory.id;
        await panel.getByRole('button',{name:`删除记忆 ${name}`,exact:true}).waitFor();
        const deleted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/user/agent-memory'&&r.request().method()==='DELETE');
        await panel.getByRole('button',{name:`删除记忆 ${name}`,exact:true}).click();assert.ok((await deleted).ok());
        await page.goto(`${origin}/chat`);
        // 前置模块可能把对话方式留在普通对话，这里恢复到 Agent（验收账号默认）。
        const agentMode=page.getByRole('radio',{name:'Agent',exact:true});
        await agentMode.waitFor();
        if (await agentMode.getAttribute('aria-checked')!=='true') await agentMode.click();
        const composer=page.locator('textarea').filter({visible:true}).last();
        await composer.fill('事业问题');
        await mkdir(output,{recursive:true});
        await page.screenshot({path:path.join(output,'agent-domain-acceptance.png'),fullPage:true});
        await composer.fill('');
        console.log('记忆保存删除、任务助手设置与草稿输入验收通过。');
    } finally {
        if(memoryId){const result=await context.request.delete(`${origin}/api/user/agent-memory`,{data:{id:memoryId}});assert.ok(result.ok()||result.status()===404);}
        await restore();
    }
}
