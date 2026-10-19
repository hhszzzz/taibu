import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
// Deliberately deterministic/offline. Never represents actual divination or model quality.
const content = '这是本地离线演示回复，仅用于验证请求、流式响应与保存流程，不提供真实 AI 分析。';
const call=(id,name,args)=>({content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const artifactOf=text=>String(text).match(/成果 ID: ([a-f0-9-]{36})/iu)?.[1];
// inspect_chart 与详查的最后一段是 {"reference":…,"targets":[…]}，演示脚本按它取盘面位置。
const directoryOf=text=>{ const value=String(text); const start=value.lastIndexOf('{"reference":'); return start<0?{targets:[]}:JSON.parse(value.slice(start)); };

/*
 * 演示数据场景（pnpm local:showcase 按原文发起）：每个场景是一串确定的真实工具调用，模拟 Agent 自主多步查看，
 * 最后给一段预置的中文解读。盘面与详查数据都来自真实计算；文字只是示例，结尾注明来源。
 */
const SHOWCASE_NOTE='\n\n——本地离线演示模型生成：工具调用与盘面数据为真实计算，解读文字为预置示例。';
const BIRTH_A={gender:'male',birthYear:1988,birthMonth:2,birthDay:3,birthHour:13};
const MEMBER_ROLES=[
  {key:'格局',drill:['bazi_wuxing',{}],look:'看五行流通',say:'命盘是丁卯 · 癸丑 · 戊子 · 己未，日主戊土生丑月。看五行的轻重与流通。',answer:'日主戊土生丑月得令，又通根丑、未两支；五行土重（5.2）、金仅 0.1，土生金一段最薄，格局取用宜从泄秀流通入手。'},
  {key:'关系',drill:['bazi_relations',{year:2027}],look:'看 2027 流年的干支关系',say:'命盘排好了，原局丑未冲刑、子未相害。叠加 2027 丁未年，看会引动什么。',answer:'原局丑未相冲、子未相害，2027 年丁未入局再冲丑土，宫位变动的信号集中在这一年。'},
  {key:'应期',drill:['bazi_liunian_scan',{fromYear:2026,toYear:2030}],look:'扫描 2026–2030 的流年',say:'命盘排好了，日主戊土。逐年扫描 2026–2030 的流年与原局、大运的关系。',answer:'流年扫描显示 2027、2029 两年与原局冲合最密，2028 年相对平稳，可作缓冲期。'},
];
const weddingDays=c=>String(c.completed.get('s5-select-days')).split('\n').filter(line=>/^- \d{4}-\d{2}-\d{2}｜/u.test(line)).map(line=>line.slice(2).split('｜'));
const weddingDay=c=>{ const days=weddingDays(c); return days.find(day=>day[4]?.includes('黄道'))??days[0]??['2026-11-01','','','','']; };
const SHOWCASE=[
  {prompt:'帮我细看这个八字：男，1988年2月3日13点出生。命局里干支之间有哪些刑冲合害？五行流通顺不顺？2026 到 2030 年哪年变动最大？',steps:[
    ['s1-bazi','bazi',()=>BIRTH_A,'先把八字排出来，再逐项细看关系、五行和流年。'],
    ['s1-inspect','inspect_chart',c=>({reference:c.ref('s1-bazi')}),'命盘排好了：丁卯 · 癸丑 · 戊子 · 己未，日主戊土。先通读整张盘。'],
    ['s1-relations','bazi_relations',c=>({reference:c.ref('s1-bazi')}),'地支关系很密：丑未冲又刑、子未相害，还有丑子六合。用关系详查把原局逐条核对一遍。'],
    ['s1-relations-2027','bazi_relations',c=>({reference:c.ref('s1-bazi'),year:2027}),'原局八条关系核对完，冲、害、刑都落在时支未上。再看 2027 丁未年叠加进来会引动什么。'],
    ['s1-wuxing','bazi_wuxing',c=>({reference:c.ref('s1-bazi')}),'2027 丁未与月柱癸丑天克地冲（反吟），丑未冲刑同时被引动。接着看五行流通。'],
    ['s1-scan','bazi_liunian_scan',c=>({reference:c.ref('s1-bazi'),fromYear:2026,toYear:2030}),'五行土重（5.2）、金只有 0.1，土生金这一段最薄。最后扫一遍 2026–2030 的流年，比较哪年变动最大。'],
    ['s1-focus','focus_chart',c=>({reference:c.ref('s1-bazi'),targetIds:c.targets('s1-inspect').filter(t=>t.id.startsWith('bazi-relation-')&&/丑未|子未|恃势/u.test(t.label)).map(t=>t.id),caption:'冲、害、刑都落在时支未上'}),'2027 反吟、2029 岁运并临且冲太岁，这两年最突出。把盘面定位到时支未相关的关系上，方便对照。'],
    ['s1-select','select_final_artifacts',c=>({artifactIds:[c.artifact('s1-bazi')]})],
  ],answer:'**结论**：原局的冲、害、刑都落在时支未上，五行土重金弱，2027 年与 2029 年变动最大。\n\n1. **刑冲合害**：月支丑与时支未相冲又相刑（恃势之刑），日支子与未相害，同时丑子六合；天干癸戊相合、丁癸冲克。月、时两支一冲一刑，往往表现为外部环境与晚年、子女宫之间的拉扯。\n2. **五行流通**：日主戊土生丑月得令，通根丑、未；五行统计土 5.2、水 2.9、木 1.7、火 1.3、金仅 0.1。木→火→土→金→水 的相生链完整，但金只在丑中余气出现，土生金、金生水一段最薄。\n3. **2026–2030**：2027 丁未与月柱癸丑天克地冲（反吟），丑未冲刑一并被引动；2029 己酉岁运并临、卯酉冲太岁，也是大年；2028 戊申只有癸戊合与申子半合，相对平稳，适合巩固。'},
  {prompt:'用紫微斗数看看我的命宫，再看看今年的迁移宫：女，1992年8月8日20点出生。',steps:[
    ['s2-ziwei','ziwei',()=>({gender:'female',birthYear:1992,birthMonth:8,birthDay:8,birthHour:20})],
    ['s2-ming','ziwei_palace',c=>({reference:c.ref('s2-ziwei'),palace:'命宫'}),'命盘排好了，命宫在戌，廉贞、天府同坐。先详查命宫和它的三方四正。'],
    ['s2-move','ziwei_palace',c=>({reference:c.ref('s2-ziwei'),palace:'迁移',scope:'yearly',targetDate:'2026-10-19'}),'命宫三方会紫微化权与武曲化忌，左辅化科坐命。再看 2026 年的流年迁移宫落在哪里。'],
    ['s2-focus','focus_chart',c=>({reference:c.ref('s2-ziwei'),targetIds:c.targets('s2-move').slice(0,4).map(t=>t.id),caption:'今年迁移宫与它的三方四正',includeRelated:true}),'流年迁移落入本命福德宫（壬子），贪狼坐守，流年文昌化科飞入。把盘面定位到这一组宫位。'],
    ['s2-select','select_final_artifacts',c=>({artifactIds:[c.artifact('s2-ziwei')]})],
  ],answer:'**命宫**：廉贞（利）天府（庙）同坐戌宫，左辅生年化科；三方会财帛宫紫微化权、官禄宫武曲化忌——能掌事、重承诺，但事业宫带忌，责任与压力会一起来。\n\n**今年的迁移宫**：2026 丙午年的流年迁移落在本命福德宫（壬子），贪狼（旺）坐守，流年文昌化科飞入；同宫火星、擎羊皆陷。外出、换环境的机会增多，消息与文书也顺，但冲动之下容易起争执，先把细节谈清楚再动。'},
  {prompt:'下周要谈一个合作项目，用奇门遁甲起一局看看形势和时机。',steps:[
    ['s3-qimen','qimen',()=>({year:2026,month:10,day:19,hour:10,minute:30,timezone:'Asia/Shanghai',question:'下周合作项目谈判'})],
    ['s3-palace-a','qimen_palace',c=>({reference:c.ref('s3-qimen'),palace:2}),'阴遁六局，值符天辅、值使杜门，全盘门伏吟。时干癸代表这件事，先看它所在的坤 2 宫。'],
    ['s3-palace-b','qimen_palace',c=>({reference:c.ref('s3-qimen'),palace:7}),'坤 2 宫逢死门、天蓬，时空且癸入墓，事情眼下推不动。再看日干丙所在的兑 7 宫，也就是我方。'],
    ['s3-focus','focus_chart',c=>({reference:c.ref('s3-qimen'),targetIds:c.targets('s3-palace-b').slice(0,3).map(t=>t.id),caption:'日干丙落兑7，值符坎1、值使巽4'}),'兑 7 宫惊门、天任、太阴，天任生宫。把我方宫位与值符、值使所在宫一起定位出来。'],
    ['s3-select','select_final_artifacts',c=>({artifactIds:[c.artifact('s3-qimen')]})],
  ],answer:'**形势**：日干丙代表我方，临兑 7 宫，逢惊门、天任、太阴，天任生宫——我方准备充分、宜低调谋划，但惊门主口舌，措辞要稳。时干癸代表这件事，落坤 2 宫，逢死门、天蓬，且时空、癸入墓，眼下推进的动力不足。\n\n**时机**：全盘门伏吟，八门各回本宫，事情一时难有大动，下周宜以沟通试探为主，不急于签约；值符天辅落坎 1 却逢庚加癸的大格，先把分歧条款理清，再约定落地时间。'},
  {prompt:'这份新工作 offer 要不要接？先起一课大六壬，再用六爻对照看看。',steps:[
    ['s4-liuren','daliuren',()=>({date:'2026-10-19',hour:10,minute:30,timezone:'Asia/Shanghai',question:'新工作 offer 是否接受'})],
    ['s4-lessons','daliuren_lessons',c=>({reference:c.ref('s4-liuren'),focus:'传'}),'课式是丙寅日第六局、比用课，三传子→亥→戌。详查三传的旺衰与空亡。'],
    ['s4-liuyao','liuyao',()=>({question:'新工作 offer 是否接受',yongShenTargets:['官鬼'],method:'select',hexagramName:'天火同人',changedHexagramName:'乾为天',date:'2026-10-19T10:30:00'}),'初、中两传官鬼克日干，中、末两传旬空。换六爻对照：按卦象起天火同人之乾为天。'],
    ['s4-shi','liuyao_line',c=>({reference:c.ref('s4-liuyao'),role:'世'}),'六爻排好，世爻在九三官鬼亥水。先看世爻受哪些作用。'],
    ['s4-moving','liuyao_line',c=>({reference:c.ref('s4-liuyao'),role:'动'}),'世爻月克、旬空，又被动爻丑土所克，九五申金暗动来生。再看唯一的动爻六二。'],
    ['s4-focus-liuren','focus_chart',c=>({reference:c.ref('s4-liuren'),targetIds:c.targets('s4-lessons').slice(0,3).map(t=>t.id),caption:'初传子水乘腾蛇，官鬼克日干'}),'六二丑土化出寅木回头克。两盘都看完了，分别在盘面上定位关键位置。'],
    ['s4-focus-liuyao','focus_chart',c=>({reference:c.ref('s4-liuyao'),targetIds:c.targets('s4-moving').slice(0,2).map(t=>t.id),caption:'动爻与它变出的爻'})],
    ['s4-select','select_final_artifacts',c=>({artifactIds:[c.artifact('s4-liuren'),c.artifact('s4-liuyao')]})],
  ],answer:'**两盘对照**：六壬三传子→亥→戌，初、中两传官鬼克日干且旺衰为死，末传戌土子孙得令而旺，但中、末两传都落旬空——开头的压力来自职位本身，后段能收尾，承诺却可能多于兑现。六爻天火同人变乾为天，世爻九三官鬼亥水正应所问之职，月克且旬空；唯一明动的六二子孙丑土动来克世，又化出寅木回头克，阻力会在磨合中被化解，九五申金暗动生世，有人在背后推一把。\n\n**建议**：可以接，但入职前把岗位职责和考核方式写清楚，两盘都提示前期落空与磨合的风险。'},
  {prompt:'看看我的本命盘里金星和第七宫的情况（1990年1月1日12点30分生于上海），再帮我挑下个月适合嫁娶的日子。',steps:[
    ['s5-astro','astrology',()=>({birthYear:1990,birthMonth:1,birthDay:1,birthHour:12,birthMinute:30,latitude:31.2304,longitude:121.4737,timezone:'Asia/Shanghai',transitDateTime:'2026-10-19T10:00:00'})],
    ['s5-venus','astrology_point',c=>({reference:c.ref('s5-astro'),planet:'venus'}),'本命盘排好了，上升白羊、太阳摩羯在第 9 宫。先详查金星。'],
    ['s5-house','astrology_point',c=>({reference:c.ref('s5-astro'),house:7}),'金星在水瓶座第 10 宫且逆行，与火星六合、与莉莉丝四分。再看第七宫。'],
    ['s5-select-days','almanac_select',()=>({startDate:'2026-11-01',endDate:'2026-11-30',activity:'嫁娶'}),'第七宫宫头天秤，宫主星正是金星，宫内有冥王星与莉莉丝。接着在下个月里筛选宜嫁娶的日子。'],
    ['s5-almanac','almanac',c=>({birthYear:1990,birthMonth:1,birthDay:1,birthHour:12,date:weddingDay(c)[0]}),c=>{ const [date,,,,god]=weddingDay(c); return `下个月有 ${weddingDays(c).length} 个宜嫁娶的候选日，${date}（${god}）是第一个黄道日。打开这一天的黄历看时辰。`; }],
    ['s5-focus','focus_chart',c=>({reference:c.ref('s5-astro'),targetIds:c.targets('s5-venus').slice(0,3).map(t=>t.id),caption:'金星与它的主要相位'}),'黄历已打开。最后在星盘上定位金星与它的主要相位。'],
    ['s5-select','select_final_artifacts',c=>({artifactIds:[c.artifact('s5-astro'),c.artifact('s5-almanac')]})],
  ],answer:c=>{ const [date,ganzhi,,duty,god]=weddingDay(c); return `**金星与第七宫**：本命金星在水瓶座 6°、第 10 宫且逆行，与火星六合、与莉莉丝紧密四分（0.2°）；第七宫宫头天秤座，宫主星正是金星，宫内有冥王星与莉莉丝——关系里看重平等与独立，也有较深的情感与掌控议题。眼下流运冥王星正入相合本命金星，关系模式在经历重塑。\n\n**下月择日**：${date}（${ganzhi}日，${god}，${duty}）是候选里第一个黄道日，宜嫁娶；黄历卡里可以再看当天的时辰带，挑吉时。`; }},
  {prompt:'请几位分析师一起会诊这个八字：男，1988年2月3日13点出生，重点看事业转折的时机和方向。',collaboration:true,steps:[
    ['s6-team','parallel_analysis',c=>({title:'三派会诊',topics:[{title:'转折年份',options:['2027','2028','2029']},{title:'方向',options:['守成深耕','主动变动']}],
      tasks:c.agents.map((agentId,index)=>({system:'bazi',question:`会诊·${MEMBER_ROLES[index%MEMBER_ROLES.length].key}：男，1988年2月3日13点出生，重点看事业转折的时机和方向。`,...(agentId?{agentId}:{})}))}),'这个问题适合分头看：请三位成员分别从格局、干支关系和流年应期独立分析。'],
    ['s6-check','bazi',()=>BIRTH_A,'三位成员都完成了：两位选 2027、一位选 2029。我自己再排一次盘，核对 2027 年的干支关系。'],
    ['s6-relations','bazi_relations',c=>({reference:c.ref('s6-check'),year:2027})],
    ['s6-select','select_final_artifacts',c=>({artifactIds:[...new Set([...String(c.completed.get('s6-team')).matchAll(/成果 ID: ([a-f0-9-]{36})/giu)].map(m=>m[1]).concat(c.artifact('s6-check')))]}),'复核与关系派一致：2027 丁未与月柱癸丑天克地冲，丑未冲刑被引动。整理共识与分歧。'],
  ],answer:'**共识**：三位成员都认为 2027 年是转折点——原局丑未相冲在丁未年被再次引动。\n\n**分歧**：格局派倾向守成深耕、先补金气；关系与应期两位倾向主动变动。主模型复核干支关系后认为：2027 年可以变动，但 2026 年先做准备。'},
  ...MEMBER_ROLES.map(role=>({prompt:`会诊·${role.key}：`,steps:[
    ['m-bazi','bazi',()=>BIRTH_A,`按分工先排出命盘，然后${role.look}。`],
    ['m-drill',role.drill[0],c=>({reference:c.ref('m-bazi'),...role.drill[1]}),role.say],
  ],answer:c=>`${role.answer}\n\n实际模型：${c.model}；成果 ID: ${c.artifact('m-bazi')}\n<positions>\n转折年份：${role.key==='应期'?'2029':'2027'}\n方向：${role.key==='格局'?'守成深耕':'主动变动'}\n</positions>`})),
  {prompt:'帮我排个八字，看看今年运势怎么样。',steps:[
    ['s7-ask','ask_user',()=>({questions:[
      {id:'birth',header:'出生日期',question:'请告诉我出生的年月日（公历或农历都可以）。',allowCustom:true},
      {id:'hour',header:'出生时辰',question:'大概几点出生？',options:[{id:'morning',label:'上午'},{id:'afternoon',label:'下午'},{id:'night',label:'晚上'},{id:'unknown',label:'不清楚'}],allowCustom:true},
      {id:'gender',header:'性别',question:'性别是？',options:[{id:'male',label:'男'},{id:'female',label:'女'}]},
    ]})],
  ],answer:'收到资料后我会先排盘，再看今年的流年。'},
  {prompt:'对比一下我和对象的八字合不合：我是男，1990年1月15日9点；她是女，1995年6月20日10点30分。',steps:[
    ['s8-me','bazi',()=>({gender:'male',birthYear:1990,birthMonth:1,birthDay:15,birthHour:9})],
    ['s8-her','bazi',()=>({gender:'female',birthYear:1995,birthMonth:6,birthDay:20,birthHour:10,birthMinute:30})],
    ['s8-me-rel','bazi_relations',c=>({reference:c.ref('s8-me')}),'两张盘都排好了：男方日主庚金，女方日主壬水。分别核对两盘原局的刑冲合害。'],
    ['s8-her-rel','bazi_relations',c=>({reference:c.ref('s8-her')})],
    ['s8-select','select_final_artifacts',c=>({artifactIds:[c.artifact('s8-me'),c.artifact('s8-her')]}),'男方原局只有丑辰相破；女方亥巳相冲、午午自刑。整理两盘对照。'],
  ],answer:'**两盘对照**：男方日主庚金生丑月，女方日主壬水生午月；金能生水，男方是女方的印星来源，互补明显。\n\n**需要注意**：男方原局只有丑辰相破，相对平稳；女方年时亥巳相冲、月日午午自刑，情绪与节奏起伏较大，遇事先沟通再决定。'},
  {prompt:'今天心情有点低落，有什么调整状态的小建议吗？',steps:[],answer:'可以试试三件小事：\n\n1. 出门走二十分钟，晒晒太阳；\n2. 把今天让你烦的事写下来，只写事实，不评价；\n3. 早点睡，明天再看这张纸。\n\n如果愿意告诉我出生信息，我也可以从命盘里看看近期的节奏。'},
];

function showcaseReply(body, messages, completed) {
  const first=messages.find(message=>message.role==='user');
  const text=String(first?.content??'');
  // 成员的首条消息带分工前缀，用 includes 匹配；成员场景排在会诊之后，但前缀不同不会误配。
  const scenario=SHOWCASE.find(item=>text.includes(item.prompt));
  if(!scenario)return null;
  const parallel=body.tools?.find(tool=>tool.function?.name==='parallel_analysis');
  const context={completed,model:body.model,
    agents:parallel?.function.parameters.properties.tasks.items.properties.agentId?.enum??[undefined],
    ref:id=>'artifact:'+artifactOf(completed.get(id)),artifact:id=>artifactOf(completed.get(id)),targets:id=>directoryOf(completed.get(id)).targets??[]};
  for(const [id,name,args,narration] of scenario.steps) if(!completed.has(id)) return {...call(id,name,args(context)),content:(typeof narration==='function'?narration(context):narration)??null};
  return {content:(typeof scenario.answer==='function'?scenario.answer(context):scenario.answer)+SHOWCASE_NOTE};
}

function agentReply(body) {
  if(!body.tools?.some(tool=>tool.function?.name==='bazi'))return {content};
  const messages=body.messages??[];
  const completed=new Map(messages.filter(message=>message.role==='tool').map(message=>[message.tool_call_id,message.content]));
  const showcase=showcaseReply(body,messages,completed);
  if(showcase)return showcase;
  const first=messages.find(message=>message.role==='user'&&String(message.content).includes('Agent验收：'));
  if(!first)return {content};
  const parallel=body.tools.find(tool=>tool.function?.name==='parallel_analysis');
  if(String(first.content).includes('多模型协作')&&parallel) {
    // 没有配置成员时 agentId 没有枚举：只派一项，不带 agentId。
    const agents=parallel.function.parameters.properties.tasks.items.properties.agentId?.enum??[undefined];
    if(!completed.has('fixture-team'))return call('fixture-team','parallel_analysis',{tasks:agents.map(agentId=>({...(agentId?{agentId}:{}),system:'bazi',question:'Agent验收：协作子分析，男性，1990年1月15日9时，请使用真实工具计算并返回依据。'}))});
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
    const reference = id => 'artifact:' + artifactOf(completed.get(id));
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
      const deltas = [{ role: 'assistant' }, ...Array.from(String(message.content ?? '').matchAll(/.{1,12}/gsu), match => ({ content: match[0] })), ...(message.tool_calls ?? []).map((call, index) => ({ tool_calls: [{ index, ...call }] })), {}];
      for (let index = 0; index < deltas.length; index++) {
        if (response.destroyed) return;
        response.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: deltas[index], finish_reason: index === deltas.length - 1 ? message.tool_calls?'tool_calls':'stop' : null }] })}\n\n`);
        await delay(60);
      }
      response.end('data: [DONE]\n\n');
    } else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls?'tool_calls':'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
}).listen(8000, '0.0.0.0');
