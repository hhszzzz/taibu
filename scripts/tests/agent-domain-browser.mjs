import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function verifyAgentDomain({ page, context, origin, output }) {
    const response=await context.request.get(`${origin}/api/user/settings`);
    assert.ok(response.ok()); const saved=(await response.json()).settings.chatPreferences;
    const name=`domain-${randomUUID().slice(0,8)}`;
    const count=saved.promptTemplates?.length??0;
    let memoryId;
    assert.ok(count<20,'acceptance account must have one spare template slot');
    const restore=async()=>{ const result=await context.request.patch(`${origin}/api/user/settings`,{data:{chatPreferences:{...saved,promptTemplates:saved.promptTemplates??[],memoryEnabled:saved.memoryEnabled===true}}});assert.ok(result.ok()); };
    try {
        await page.goto(`${origin}/settings/personalization`);
        const panel=page.getByRole('region',{name:'任务助手设置'});
        await panel.getByRole('button',{name:'添加模板',exact:true}).waitFor();
        await panel.getByRole('button',{name:'添加模板',exact:true}).click();
        await panel.getByLabel(`模板 ${count+1} 名称`,{exact:true}).fill(name);
        await panel.getByLabel(`模板 ${count+1} 正文`,{exact:true}).fill('模板验收：{{question}}');
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
        await page.addInitScript(()=>{
            window.__speechStarts=0;
            window.SpeechRecognition=class {
                start(){ window.__speechStarts++; this.timer=setTimeout(()=>{this.onresult?.({results:[{isFinal:true,0:{transcript:'语音验收文本'}}]});this.onend?.();},100); }
                stop(){clearTimeout(this.timer);this.onend?.();}
                abort(){clearTimeout(this.timer);this.onend?.();}
            };
        });
        await page.goto(`${origin}/chat`);
        const composer=page.locator('textarea').filter({visible:true}).last();
        await composer.fill('事业问题');
        await page.getByRole('button',{name:'问法模板',exact:true}).click();
        await page.getByRole('menuitem',{name,exact:true}).click();
        assert.equal(await composer.inputValue(),'模板验收：事业问题');
        assert.equal(await page.evaluate(()=>window.__speechStarts),0,'recording starts only after a user click');
        await page.getByRole('button',{name:'语音输入',exact:true}).click();
        await composer.waitFor();
        await page.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(input=>input.value.includes('语音验收文本')));
        assert.equal(await composer.inputValue(),'模板验收：事业问题\n语音验收文本');
        assert.equal(await page.evaluate(()=>window.__speechStarts),1);
        await mkdir(output,{recursive:true});
        await page.screenshot({path:path.join(output,'agent-domain-acceptance.png'),fullPage:true});
        await composer.fill('');
        console.log('模板插入、记忆保存删除、浏览器语音事件与不自动发送验收通过；语音服务采用测试替身。');
    } finally {
        if(memoryId){const result=await context.request.delete(`${origin}/api/user/agent-memory`,{data:{id:memoryId}});assert.ok(result.ok()||result.status()===404);}
        await restore();
    }
}
