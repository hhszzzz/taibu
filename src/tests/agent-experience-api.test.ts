import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { createMockAuthContext } from './helpers/supabase-mock';
import { mockAIRateLimit } from './helpers/route-mock';
import { GET as search } from '../app/api/search/route';
import { GET as conversations } from '../app/api/conversations/route';
import { POST as enhance } from '../app/api/chat/enhance/route';
import { POST as upload } from '../app/api/agent/attachments/route';
import { GET as attachment } from '../app/api/agent/attachments/[id]/route';
import { POST as fork } from '../app/api/conversations/[id]/fork/route';
import { PATCH as configuration } from '../app/api/conversations/[id]/configuration/route';
import { GET as memories, POST as saveMemory, DELETE as deleteMemory } from '../app/api/user/agent-memory/route';

/** Hybrid double: legacy supabase-style `db` for not-yet-migrated routes, `scoped` for Kysely routes. */
function fixture(t: TestContext) {
    const owner = randomUUID(), id = randomUUID();
    const calls: { table: string; field: string; value: unknown }[] = [];
    const rows: Record<string, unknown> = {};
    const errors: Record<string, unknown> = {};
    const inserts: Record<string, unknown> = {};
    let rpcError: unknown = null, rpcData: unknown = [];
    const db = {
        from(table: string) {
            const result = () => ({ data: rows[table] ?? null, error: errors[table] ?? null });
            const query = {
                select: () => query, in: (field: string,value: unknown) => { calls.push({table,field,value}); return query; },
                eq: (field: string,value: unknown) => { calls.push({table,field,value}); return query; },
                ilike: (field: string,value: unknown) => { calls.push({table,field,value}); return query; },
                abortSignal: () => query,
                insert: (value: unknown) => { inserts[table] = value; return query; },
                update: (value: unknown) => { inserts[table] = value; return query; },
                upsert: (value: unknown) => { inserts[table] = value; return query; }, delete: () => query,
                order: () => query, limit: () => query, range: () => query,
                maybeSingle: async () => result(), single: async () => result(),
                then: (resolve: (value: unknown) => void) => resolve(result()),
            }; return query;
        },
        rpc: (_name: string, args?: Record<string, unknown>) => {
            calls.push({table:'rpc',field:_name,value:args});
            const result = Promise.resolve({ data: rpcData, error: rpcError });
            return Object.assign(result, { abortSignal: () => result });
        },
        storage: { from: () => ({ upload: async () => ({error:null}), download: async () => ({data:new Blob(['资料正文']),error:null}) }) },
    };
    const unwrap = (value: unknown): unknown => {
        if (!value || typeof value !== 'object' || !('toOperationNode' in value)) return value;
        const node = (value as { toOperationNode(): { parameters?: { value?: unknown }[] } }).toOperationNode();
        const parameter = node.parameters?.[0]?.value;
        return typeof parameter === 'string' ? JSON.parse(parameter) : value;
    };
    const table = (name: string) => {
        const query: Record<string, unknown> = {};
        const read = () => {
            if (errors[name]) throw errors[name];
            const value = rows[name];
            if (value === undefined) return [];
            return Array.isArray(value) ? value : [value];
        };
        Object.assign(query, {
            select: () => query,
            selectAll: () => query,
            where: (field: string, _operator: string, value: unknown) => { calls.push({ table: name, field, value }); return query; },
            orderBy: () => query, limit: () => query, offset: () => query, groupBy: () => query,
            innerJoin: () => query, leftJoin: () => query,
            values: (value: unknown) => { inserts[name] = unwrap(value); return query; },
            set: (value: unknown) => {
                inserts[name] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, unwrap(entry)]));
                return query;
            },
            returning: () => query, returningAll: () => query, onConflict: () => query,
            execute: async () => read(),
            executeTakeFirst: async () => read()[0] ?? null,
            executeTakeFirstOrThrow: async () => {
                const first = read()[0];
                if (!first) throw new Error('not found');
                return first;
            },
        });
        return query;
    };
    const scoped = {
        scope: { kind: 'user' as const, userId: owner },
        tx: async (work: (trx: unknown) => unknown) => work({ selectFrom: table, insertInto: table, updateTable: table, deleteFrom: table }),
        rpc: async (name: string, args?: Record<string, unknown>) => {
            calls.push({ table: 'rpc', field: name, value: args });
            if (rpcError) throw rpcError;
            return rpcData;
        },
    };
    const api = require('../lib/api-utils') as typeof import('../lib/api-utils');
    t.mock.method(api,'requireUserContext',async () => createMockAuthContext(db,owner,scoped as never));
    t.mock.method(api,'getSystemAdminClient',() => db as unknown as ReturnType<typeof api.getSystemAdminClient>);
    const supabaseServer=require('../lib/supabase-server') as typeof import('../lib/supabase-server');
    t.mock.method(supabaseServer,'getSystemAdminClient',() => db as unknown as ReturnType<typeof supabaseServer.getSystemAdminClient>);
    const contextModule=require('../lib/db/context.server') as typeof import('../lib/db/context.server');
    t.mock.method(contextModule,'systemDb',() => scoped as unknown as ReturnType<typeof contextModule.systemDb>);
    return { owner,id,db,calls,rows,errors,inserts,api,rpc(data:unknown,error:unknown=null){rpcData=data;rpcError=error;} };
}
const request = (url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, body === undefined ? {} : { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body) });
const params = (id:string) => ({params:Promise.resolve({id})});

test('memory API scopes every read/delete to the current account and ignores forged ownership on save', async t => {
    const f=fixture(t);
    f.rows.user_agent_memory=[{id:f.id,title:'偏好',content:'简洁表达',kind:'preference'}];
    assert.equal((await memories(request('/api/user/agent-memory'))).status,200);
    f.rows.user_agent_memory={id:f.id};
    assert.equal((await saveMemory(request('/api/user/agent-memory',{user_id:randomUUID(),title:'偏好',content:'简洁表达',kind:'preference'}))).status,200);
    assert.equal((f.inserts.user_agent_memory as {user_id:string}).user_id,f.owner);
    assert.equal((await saveMemory(request('/api/user/agent-memory',{title:'',content:'',kind:'preference'}))).status,400);
    f.rows.user_agent_memory=[];
    assert.equal((await deleteMemory(new NextRequest('http://localhost/api/user/agent-memory',{method:'DELETE',body:JSON.stringify({id:f.id})}))).status,404);
    assert.ok(f.calls.filter(call=>call.table==='user_agent_memory').some(call=>call.field==='user_id'&&call.value===f.owner));
    assert.equal((await memories(new NextRequest('http://localhost/api/user/agent-memory',{headers:{'X-Expected-User-Id':randomUUID()}}))).status,409);
    t.mock.method(f.api,'requireUserContext',async()=>({error:{message:'请登录',status:401}}));
    assert.equal((await memories(request('/api/user/agent-memory'))).status,401);
});

test('search validates literals, forwards request cancellation and reports bounded database timeouts',async t => {
    const f=fixture(t); f.rpc([{conversationId:f.id,messageId:'visible',preview:'literal_%'}]);
    const success=await search(request('/api/search?q=literal_%25')); assert.equal(success.status,200);
    assert.deepEqual(f.calls[0].value,{p_query:'literal_%',p_limit:30});
    // 空词 = 搜索弹层的「最近使用」：列出最近对话，不查命盘。
    f.rows.conversations_with_archive_status=[{id:f.id,title:'最近对话',updated_at:'2026-10-01'}];
    const recent=await search(request('/api/search?q=')); assert.equal(recent.status,200);
    assert.deepEqual((await recent.json()).results.map((row:{title:string})=>row.title),['最近对话']);
    f.rpc(null,{code:'57014'}); assert.equal((await search(request('/api/search?q=query'))).status,504);
    t.mock.method(f.api,'requireUserContext',async()=>({error:{message:'请登录',status:401}}));
    assert.equal((await search(request('/api/search?q=query'))).status,401);
});

test('search adds owner-scoped chart matches and omits only a failed chart group',async t => {
    const f=fixture(t); f.rpc([]);
    f.rows.bazi_charts=[{id:'bazi-1',name:'张三',birth_date:'1990-01-15',birth_time:'09:00'}];
    f.errors.ziwei_charts={message:'ziwei unavailable'};
    const response=await search(request('/api/search?q=张')); assert.equal(response.status,200);
    const body=await response.json() as {charts:Array<{id:string;kind:string}>};
    assert.deepEqual(body.charts.map(chart=>[chart.id,chart.kind]),[['bazi-1','bazi']]);
    for (const table of ['bazi_charts','ziwei_charts'])
        assert.ok(f.calls.some(call=>call.table===table&&call.field==='user_id'&&call.value===f.owner),`${table} must be scoped to the caller`);
});

test('conversation list filters by Agent mode and rejects unknown modes',async t => {
    const f=fixture(t);
    f.rows.conversations_with_archive_status=[{id:f.id,title:'任务会话',has_agent_run:true}];
    const modeCalls=()=>f.calls.filter(call=>call.table==='conversations_with_archive_status'&&call.field==='has_agent_run').map(call=>call.value);
    assert.equal((await conversations(request('/api/conversations?mode=agent'))).status,200);
    assert.deepEqual(modeCalls(),[true]);
    f.calls.length=0;
    assert.equal((await conversations(request('/api/conversations?mode=plain'))).status,200);
    assert.deepEqual(modeCalls(),[false]);
    f.calls.length=0;
    assert.equal((await conversations(request('/api/conversations'))).status,200);
    assert.deepEqual(modeCalls(),[]);
    assert.equal((await conversations(request('/api/conversations?mode=all'))).status,400);
    t.mock.method(f.api,'requireUserContext',async()=>({error:{message:'请登录',status:401}}));
    assert.equal((await conversations(request('/api/conversations?mode=agent'))).status,401);
});

test('enhancement rejects free users and claims quota before every actual call without a debit',async t => {
    const f=fixture(t); let membership:'free'|'plus'='free'; let attempts=0;
    const credits=require('../lib/user/credits') as typeof import('../lib/user/credits');
    const guard=require('../lib/api/ai-feature-guard') as typeof import('../lib/api/ai-feature-guard');
    const configs=require('../lib/server/ai-config') as typeof import('../lib/server/ai-config');
    const ai=require('../lib/ai/ai') as typeof import('../lib/ai/ai');
    t.mock.method(guard,'getGlobalAIFeatureGuardResponse',async()=>null);
    t.mock.method(credits,'getUserAuthInfo',async()=>({effectiveMembership:membership,credits:10,hasCredits:true}));
    t.mock.method(configs,'getModelConfigAsync',async()=>({id:'fixture',name:'fixture',vendor:'other',apiKeyEnvVar:'KEY',requiredTier:'free'}));
    t.mock.method(ai,'callAI',async (...args: Parameters<typeof ai.callAI>) => { await args[4]?.beforeModelAttempt?.(); attempts++; return '清晰的问题'; });
    assert.equal((await enhance(request('/api/chat/enhance',{text:'问题',model:'fixture'}))).status,403); assert.equal(attempts,0);
    membership='plus'; f.rpc(true);
    assert.equal((await enhance(request('/api/chat/enhance',{text:'问题',model:'fixture'}))).status,200); assert.equal(attempts,1);
    f.rpc(false); assert.equal((await enhance(request('/api/chat/enhance',{text:'问题',model:'fixture'}))).status,429); assert.equal(attempts,1);
    assert.ok(f.calls.every(call=>call.field==='claim_prompt_enhancement'));
});

test('private upload validates real image bytes, downsamples and stores only an owned ID',async t => {
    const f=fixture(t); const bytes=await sharp({create:{width:2200,height:1,channels:3,background:'#123456'}}).png().toBuffer();
    const form=new FormData(); form.append('file',new File([bytes],'fixture.png',{type:'image/png'}));
    f.rows.agent_attachments={id:f.id,user_id:f.owner,name:'fixture.png',kind:'image',mime_type:'image/jpeg',size:10,sha256:'digest',status:'ready',width:2048,height:1};
    const response=await upload(new NextRequest('http://localhost/api/agent/attachments',{method:'POST',body:form}));
    assert.equal(response.status,201);
    const row=f.inserts.agent_attachments as {status:string}; assert.equal(row.status,'ready');
    const body=await response.json(); assert.equal(body.attachment.id,f.id); assert.equal(body.attachment.width,2048); assert.ok(!JSON.stringify(body).includes('object_path'));
    const invalid=new FormData(); invalid.append('file',new File(['not an image'],'bad.png',{type:'image/png'}));
    assert.equal((await upload(new NextRequest('http://localhost/api/agent/attachments',{method:'POST',body:invalid}))).status,400);
});

test('private document upload stores the extracted text under its own name within the document rate limit',async t => {
    const f=fixture(t); const limits:string[]=[]; let allowed=true;
    mockAIRateLimit(t,async(identifier,endpoint,config)=>{limits.push(`${identifier}:${endpoint}`);return {allowed,remaining:0,resetAt:new Date(Date.now()+config.windowMs)};});
    // The row is read while its bytes upload, before it is marked ready.
    const stored:{row:unknown;text:string;contentType:string}[]=[];
    t.mock.method(f.db.storage,'from',()=>({upload:async(_path:string,bytes:Buffer,options:{contentType:string})=>{stored.push({row:f.inserts.agent_attachments,text:bytes.toString('utf8'),contentType:options.contentType});return {error:null};}}));
    const send=(file:File)=>{const form=new FormData();form.append('file',file);return upload(new NextRequest('http://localhost/api/agent/attachments',{method:'POST',body:form}));};
    f.rows.agent_attachments={id:f.id,user_id:f.owner,name:'命书.md',kind:'text',mime_type:'text/plain',size:12,sha256:'digest',status:'ready'};
    assert.equal((await send(new File(['# 命书\r\n甲辰'],'命书.md',{type:'text/markdown'}))).status,201);
    const row=stored[0].row as {name:string;kind:string;mime_type:string;user_id:string};
    assert.deepEqual([row.name,row.kind,row.mime_type,row.user_id],['命书.md','text','text/plain',f.owner]);
    assert.deepEqual([stored[0].text,stored[0].contentType],['# 命书\n甲辰','text/plain']);
    assert.deepEqual(limits,[`${f.owner}:document-text`]);
    delete f.inserts.agent_attachments;
    const unsupported=await send(new File(['MZ'],'tool.exe',{type:'application/octet-stream'}));
    assert.equal(unsupported.status,415); assert.equal((await unsupported.json()).code,'UNSUPPORTED_FORMAT');
    allowed=false; assert.equal((await send(new File(['正文'],'资料.txt',{type:'text/plain'}))).status,429);
    assert.equal(f.inserts.agent_attachments,undefined,'a refused document is never stored'); assert.equal(stored.length,1);
});

test('private text reads verify ownership, hash and pagination; unavailable IDs stay private',async t => {
    const f=fixture(t); const bytes=Buffer.from('资料正文');
    f.rows.agent_attachments=[{id:f.id,user_id:f.owner,object_path:`${f.owner}/${f.id}`,name:'资料.txt',kind:'text',mime_type:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'ready'}];
    const response=await attachment(request(`/api/agent/attachments/${f.id}?content=1&offset=1&length=2`),params(f.id));
    assert.equal(response.status,200); assert.equal((await response.json()).text,'料正');
    assert.ok(f.calls.some(call=>call.field==='user_id' && call.value===f.owner));
    f.rows.agent_attachments=[]; assert.equal((await attachment(request(`/api/agent/attachments/${f.id}`),params(f.id))).status,404);
    assert.equal((await attachment(request('/api/agent/attachments/invalid'),params('invalid'))).status,400);
});

test('fork API owner scopes its snapshot, discards active state and reports a branch race',async t => {
    const f=fixture(t); const history=[{id:'u',role:'user',content:'问题',createdAt:'now'},{id:'a',role:'assistant',content:'回答',createdAt:'now'}];
    const loader=require('../lib/server/conversation-messages') as typeof import('../lib/server/conversation-messages');
    t.mock.method(loader,'loadAllConversationMessages',async()=>({messages:history,error:null}));
    f.rows.conversations={id:f.id,title:'标题',messages:history}; f.rpc(randomUUID());
    assert.equal((await fork(request('/fork',{messageId:'a'}),params(f.id))).status,200);
    const value=f.calls.find(call=>call.field==='fork_conversation_snapshot')?.value as {p_messages:{id:string;metadata:{forkHistory:boolean}}[]} | undefined;
    assert.ok(value);
    assert.equal(value.p_messages.length,2); assert.ok(value.p_messages.every(message=>message.metadata.forkHistory)); assert.notEqual(value.p_messages[0].id,'u');
    assert.ok(f.calls.some(call=>call.field==='user_id' && call.value===f.owner));
    f.rpc(null,{code:'40001'}); assert.equal((await fork(request('/fork',{messageId:'a'}),params(f.id))).status,409);
    f.rows.conversations=null; assert.equal((await fork(request('/fork',{messageId:'a'}),params(f.id))).status,404);
});

test('next-task preferences reject malformed values and strip keys from the stored preference',async t => {
    const f=fixture(t); f.rows.conversations={id:f.id};
    const saved=await configuration(request('/configuration',{model:'fixture',reasoning:false,webEnabled:false,apiKey:'private'}),params(f.id)); assert.equal(saved?.status,200);
    assert.deepEqual(f.inserts.conversations,{next_task_config:{model:'fixture',reasoning:false,webEnabled:false,codeMode:false,planMode:false,reasoningEffort:null,collaborators:[]}});
    const malformed=await configuration(request('/configuration',{model:'fixture',reasoning:'yes',webEnabled:false}),params(f.id)); assert.equal(malformed?.status,400);
    const codeMode=await configuration(request('/configuration',{model:'fixture',reasoning:false,webEnabled:false,codeMode:'on'}),params(f.id)); assert.equal(codeMode?.status,400);
    const planMode=await configuration(request('/configuration',{model:'fixture',reasoning:false,webEnabled:false,planMode:'on'}),params(f.id)); assert.equal(planMode?.status,400);
    f.rows.conversations=null; const missing=await configuration(request('/configuration',{model:'fixture',reasoning:false,webEnabled:false}),params(f.id)); assert.equal(missing?.status,404);
});
