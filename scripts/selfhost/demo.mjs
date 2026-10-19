import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
// Deliberately deterministic/offline. Never represents actual divination or model quality.
const content = '这是本地离线演示回复，仅用于验证请求、流式响应与保存流程，不提供真实 AI 分析。';
function agentReply(body) {
  if(!body.tools?.some(tool=>tool.function?.name==='bazi'))return {content};
  const messages=body.messages??[];
  const first=messages.find(message=>message.role==='user'&&String(message.content).includes('Agent验收：'));
  if(!first)return {content};
  const completed=new Map(messages.filter(message=>message.role==='tool').map(message=>[message.tool_call_id,message.content]));
  const call=(id,name,args)=>({content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const parallel=body.tools.find(tool=>tool.function?.name==='parallel_analysis');
  if(String(first.content).includes('多模型协作')&&parallel) {
    const agents=parallel.function.parameters.properties.tasks.items.properties.agentId.enum;
    if(!completed.has('fixture-team'))return call('fixture-team','parallel_analysis',{tasks:agents.map(agentId=>({agentId,system:'bazi',question:'Agent验收：协作子分析，男性，1990年1月15日9时，请使用真实工具计算并返回依据。'}))});
    if(!completed.has('fixture-team-select')) {
      const artifactIds=[...String(completed.get('fixture-team')).matchAll(/成果 ID: ([a-f0-9-]{36})/giu)].map(match=>match[1]);
      return call('fixture-team-select','select_final_artifacts',{artifactIds:[...new Set(artifactIds)]});
    }
    return {content:'多模型协作离线验收完成。各成员使用独立模型与推理档位，主模型汇总真实计算依据。此回复仅用于测试。'};
  }
  if(String(first.content).includes('补充信息')&&!completed.has('fixture-ask'))return call('fixture-ask','ask_user',{question:'请补充出生年月日、出生时刻和性别。'});
  if(!completed.has('fixture-bazi'))return call('fixture-bazi','bazi',{gender:'male',birthYear:1990,birthMonth:1,birthDay:15,birthHour:9});
  if(String(first.content).includes('协作子分析'))return {content:`协作子分析完成；实际模型：${body.model}；实际推理档位：${body.reasoning_effort??body.reasoning?.effort??'off'}。${String(completed.get('fixture-bazi')).match(/成果 ID: [a-f0-9-]{36}/iu)?.[0]??''}。此结论仅用于测试。`};
  if(String(first.content).includes('全体系命盘联动')) {
    const plans = [
      ['bazi', {}], ['ziwei', {gender:'male',birthYear:1990,birthMonth:1,birthDay:15,birthHour:9}],
      ['qimen', {year:2026,month:3,day:15,hour:16,minute:51,timezone:'Asia/Shanghai'}],
      ['liuyao', {question:'本月事业运势如何？',yongShenTargets:['官鬼'],method:'auto',date:'2026-02-10T09:30:00'}],
      ['meihua', {question:'这次合作能否谈成？',method:'time',date:'2026-04-04T10:30:00'}],
      ['daliuren', {date:'2026-03-15',hour:16,minute:53,timezone:'Asia/Shanghai',question:'今日运势如何'}],
      ['xiaoliuren', {lunarMonth:3,lunarDay:15,hour:8,question:'今日运势如何'}],
      ['tarot', {spreadType:'three-card',question:'本月运势如何？',referenceYear:2026}],
      ['taiyi', {mode:'hour',system:'traditional',date:'2026-04-10',hour:9,timezone:'Asia/Shanghai'}],
      ['astrology', {birthYear:1990,birthMonth:1,birthDay:1,birthHour:12,birthMinute:30,latitude:31.2304,longitude:121.4737,timezone:'Asia/Shanghai',transitDateTime:'2026-04-10T09:30:00'}],
      ['almanac', {birthYear:1990,birthMonth:1,birthDay:15,birthHour:9,date:'2026-02-14'}],
    ];
    const reference = id => 'artifact:' + String(completed.get(id)).match(/成果 ID: ([a-f0-9-]{36})/iu)?.[1];
    const chartLabels = {bazi:'八字',ziwei:'紫微',qimen:'奇门',liuyao:'六爻',meihua:'梅花易数',daliuren:'大六壬',xiaoliuren:'小六壬',tarot:'塔罗',taiyi:'太乙',astrology:'西方占星',almanac:'黄历'};
    const directory = id => { const text=String(completed.get(id)); return JSON.parse(text.slice(text.lastIndexOf('{"reference":'))); };
    const selectors = {bazi:'bazi-relation-',qimen:':八门',liuyao:'liuyao:line:2',meihua:'meihua:trigram:体卦',daliuren:'daliuren:transmission:1',xiaoliuren:'xiaoliuren:result',tarot:'tarot:card:1',taiyi:':star:',astrology:':aspect:',almanac:'almanac:hour:'};
    for(const [name,args] of plans) {
      const calc=name==='bazi'?'fixture-bazi':'fixture-all-'+name, inspect='fixture-all-inspect-'+name, focus='fixture-all-focus-'+name;
      if(!completed.has(calc))return call(calc,name,args);
      if(!completed.has(inspect))return call(inspect,'inspect_chart',{reference:reference(calc)});
      let targets=directory(inspect).targets;
      if(name==='ziwei') {
        const stars='fixture-all-stars';
        if(!completed.has(stars))return call(stars,'inspect_chart',{reference:reference(calc),palace:targets.find(target=>target.id==='ziwei:palace:0').label.split(' ')[0]});
        targets=directory(stars).targets.filter(target=>target.id.startsWith('ziwei:star:'));
      }
      if(!completed.has(focus))return call(focus,'focus_chart',{reference:reference(calc),targetIds:[targets.find(target=>selectors[name]&&target.id.includes(selectors[name]))?.id??targets[0].id],caption:'正在分析'+(chartLabels[name]??name)+'的实际盘面位置',includeRelated:true});
    }
    if(!completed.has('fixture-all-select'))return call('fixture-all-select','select_final_artifacts',{artifactIds:plans.map(([name])=>reference(name==='bazi'?'fixture-bazi':'fixture-all-'+name).slice(9))});
    return {content:'全体系命盘联动离线验收完成。十一种盘面均通过真实工具、原生记录和 SSE 定位；此回复仅用于测试。'};
  }
  if(String(first.content).includes('命盘联动')) {
    const reference = id => 'artifact:' + String(completed.get(id)).match(/成果 ID: ([a-f0-9-]{36})/iu)?.[1];
    const directory = id => {
      const text = String(completed.get(id));
      return JSON.parse(text.slice(text.lastIndexOf('{"reference":')));
    };
    if(!completed.has('fixture-inspect-bazi'))return call('fixture-inspect-bazi','inspect_chart',{reference:reference('fixture-bazi')});
    if(!completed.has('fixture-focus-day'))return call('fixture-focus-day','focus_chart',{reference:reference('fixture-bazi'),targetIds:['bazi:cell:2:1'],caption:'正在查看日支'});
    if(!completed.has('fixture-focus-relation'))return call('fixture-focus-relation','focus_chart',{reference:reference('fixture-bazi'),targetIds:[directory('fixture-inspect-bazi').targets.find(target=>target.id.startsWith('bazi-relation-')).id],caption:'正在查看干支关系'});
    if(!completed.has('fixture-ziwei'))return call('fixture-ziwei','ziwei',{gender:'male',birthYear:1990,birthMonth:1,birthDay:15,birthHour:9});
    if(!completed.has('fixture-inspect-ziwei'))return call('fixture-inspect-ziwei','inspect_chart',{reference:reference('fixture-ziwei')});
    const palace=directory('fixture-inspect-ziwei').targets.find(target=>target.id==='ziwei:palace:0');
    if(!completed.has('fixture-inspect-stars'))return call('fixture-inspect-stars','inspect_chart',{reference:reference('fixture-ziwei'),palace:palace.label.split(' ')[0]});
    if(!completed.has('fixture-focus-star'))return call('fixture-focus-star','focus_chart',{reference:reference('fixture-ziwei'),targetIds:[directory('fixture-inspect-stars').targets.find(target=>target.id.startsWith('ziwei:star:')).id],includeRelated:true,caption:'正在查看宫位与星曜'});
  }
  if(String(first.content).includes('跨命盘')&&!completed.has('fixture-other'))return call('fixture-other','bazi',{gender:'female',birthYear:1995,birthMonth:6,birthDay:20,birthHour:10,birthMinute:30});
  if(!completed.has('fixture-select')) {
    const artifactIds=[...completed.entries()].filter(([id])=>id.startsWith('fixture-bazi')||id==='fixture-other'||id==='fixture-ziwei').map(([,text])=>String(text).match(/成果 ID: ([a-f0-9-]{36})/iu)?.[1]).filter(Boolean);
    return call('fixture-select','select_final_artifacts',{artifactIds});
  }
  return {content:'Agent 离线验收已完成真实工具排盘和成果选择。此文字来自确定性测试模型，用于验证后台执行、恢复和保存流程。'};
}
if (!process.env.DEMO_API_KEY) throw new Error('缺少演示密钥');
http.createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.DEMO_API_KEY}`) { response.writeHead(401).end(); return; }
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'taibu-demo', object: 'model', owned_by: 'local-demo' }] })); return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let raw = '';
  try {
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1_048_576) { response.writeHead(413).end(); return; }
    }
    const body = JSON.parse(raw);
    if (body.tools && (body.messages ?? []).some(message => message.role === 'user' && String(message.content).includes('Agent验收：崩溃恢复'))) await delay(3000);
    const base = { id: 'chatcmpl-local-demo', created: 0, model: body.model ?? 'taibu-demo' };
    const message=agentReply(body);
    if (body.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const deltas = message.tool_calls?[{role:'assistant'},...message.tool_calls.map((call,index)=>({tool_calls:[{index,...call}]})),{}]:[{ role: 'assistant' }, ...Array.from(message.content.matchAll(/.{1,12}/gu), match => ({ content: match[0] })), {}];
      for (let index = 0; index < deltas.length; index++) {
        if (response.destroyed) return;
        response.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: deltas[index], finish_reason: index === deltas.length - 1 ? message.tool_calls?'tool_calls':'stop' : null }] })}\n\n`);
        await delay(60);
      }
      response.end('data: [DONE]\n\n');
    } else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls?'tool_calls':'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
}).listen(8000, '0.0.0.0');
