import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuestions, validateAnswers, formatQuestionAnswers, questionLabel } from '../lib/agent/questions';
import { validateTodos } from '../lib/agent/todos';
import { forkConversationMessages, conversationHtml, conversationMarkdown } from '../lib/chat/conversation-transfer';
import { briefingLocalDate, initialBriefingPreferences, validBriefingPreferences } from '../lib/briefing-preferences';
import { agentInputContent } from '../lib/agent/attachment-input';
import type { ChatMessage } from '../types';

test('structured questions keep stable IDs, validate choices and skips, and retain legacy input', () => {
    const questions = normalizeQuestions([{ id:'choice',question:'选择范围',options:[{id:'a',label:'工作'},{id:'b',label:'生活'}],multiple:true,allowCustom:true },{id:'optional',question:'可补充资料',allowSkip:true,allowCustom:true}]);
    const answers = validateAnswers(questions,{choice:['a','实际补充'],optional:null});
    assert.equal(formatQuestionAnswers(questions,answers),'选择范围\n工作、实际补充\n\n可补充资料\n已跳过');
    assert.throws(() => validateAnswers(questions,{choice:['a']}));
    assert.throws(() => normalizeQuestions([{id:'x',question:'a'},{id:'x',question:'b'}]));
    const legacy = normalizeQuestions(undefined,'出生时间？');
    assert.equal(formatQuestionAnswers(legacy,validateAnswers(legacy,{question:['09:00']})),'出生时间？\n09:00');
    const single = normalizeQuestions([{id:'one',question:'选择',options:[{id:'a',label:'A'}],allowCustom:false,allowSkip:false}]);
    assert.throws(() => validateAnswers(single,{one:['unknown']}));
    assert.throws(() => validateAnswers(single,{one:['a','a']}));
    assert.throws(() => validateAnswers(single,{one:null}));
});

test('question navigation labels use the short header, shorten long ones and fall back to the first line', () => {
    const [labelled, long, plain, blank] = normalizeQuestions([
        { id: 'birth', question: '她的出生日期和时间？\n尽量精确到分钟。', header: ' 出生时间 ' },
        { id: 'long', question: '历法', header: '这是一个超过十二个字的很长很长的标签' },
        { id: 'plain', question: '出生时间准确吗？\n不确定可以跳过。' },
        { id: 'blank', question: '最想了解哪些方面以及为什么想了解这些内容？', header: '   ' },
    ]);
    assert.equal(labelled.header, '出生时间');
    assert.equal(questionLabel(labelled), '出生时间');
    assert.equal(long.header?.length, 12);
    assert.equal(plain.header, undefined);
    assert.equal(questionLabel(plain), '出生时间准确吗');
    assert.equal(blank.header, undefined);
    assert.equal(questionLabel(blank), '最想了解哪些方面以及为…');
    // Stored questions written before headers existed still normalize unchanged.
    assert.deepEqual(Object.keys(normalizeQuestions([{ id: 'old', question: '出生地？' }])[0]).sort(), ['allowCustom', 'allowSkip', 'id', 'multiple', 'options', 'question']);
});

test('task lists reject duplicate IDs, excess items and concurrent in-progress steps', () => {
    assert.equal(validateTodos([{id:'first',title:'查看资料',status:'in_progress'}]).length,1);
    assert.throws(() => validateTodos([{id:'a',title:'A',status:'in_progress'},{id:'b',title:'B',status:'in_progress'}]));
    assert.throws(() => validateTodos(Array.from({length:51},(_,id)=>({id:String(id),title:'步骤',status:'pending'}))));
    assert.throws(() => validateTodos([{id:'a',title:'A',status:'pending'},{id:'a',title:'B',status:'completed'}]));
});

test('forks copy only the completed visible branch, preserve attachment references, and discard live state', () => {
    let sequence=0;
    const history: ChatMessage[] = [{id:'u',role:'user',content:'问题',createdAt:'2026-01-01',attachments:{ids:['attachment'],fileName:'资料'},versions:[]},{id:'a',role:'assistant',content:'回答',createdAt:'2026-01-01',metadata:{sources:[]},agent:{version:1,runId:'old-run',status:'completed',parts:[{type:'question',id:'q',question:'已回答'},{type:'tool',id:'t',name:'bazi',title:'命盘',status:'completed',canonicalText:'命盘依据'}]}},{id:'later',role:'user',content:'后续',createdAt:'2026-01-01'}];
    const fork = forkConversationMessages(history,'a',()=>`new-${++sequence}`);
    assert.equal(fork.length,2); assert.equal(fork[0].versions,undefined); assert.deepEqual(fork[0].attachments,history[0].attachments);
    assert.ok(fork.every(message=>message.metadata?.forkHistory));
    assert.notEqual(fork[1].agent?.runId,'old-run'); assert.equal(fork[1].agent?.parts.length,1);
    assert.match(conversationMarkdown('标题',fork),/命盘依据/);
    assert.throws(()=>forkConversationMessages(history,'u',()=>''));
    assert.throws(()=>forkConversationMessages([{...history[1],agent:{...history[1].agent!,status:'running'}}],'a',()=>''));
});

test('static HTML exports render GFM tables and block executable HTML, URLs and credentials', () => {
    const html = conversationHtml('<script>title</script>','| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![bad](data:image/svg+xml;base64,abc)');
    assert.match(html,/<table>/); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:'));
    assert.ok(!html.includes('src="data:image/svg'));
    const message:ChatMessage={id:'a',role:'assistant',content:'结果',createdAt:'now',agent:{version:1,runId:'r',status:'completed',parts:[{type:'tool',id:'t',name:'tool',title:'工具',status:'completed',input:{apiKey:'private',systemPrompt:'hidden',visible:'ok'}}]}};
    const markdown=conversationMarkdown('导出',[message],true);
    assert.ok(!markdown.includes('private')); assert.ok(!markdown.includes('hidden')); assert.ok(markdown.includes('visible'));
});

test('briefing dates follow local calendar days including DST and invalid zones fail validation', () => {
    assert.equal(briefingLocalDate(new Date('2026-03-08T04:30:00Z'),'America/New_York'),'2026-03-07');
    assert.equal(briefingLocalDate(new Date('2026-03-08T08:30:00Z'),'America/New_York'),'2026-03-08');
    assert.equal(briefingLocalDate(new Date('2026-10-07T20:30:00Z'),'Asia/Shanghai'),'2026-10-08');
    assert.equal(validBriefingPreferences({timezone:'Fake/Zone',time:'08:00'}),false);
    assert.equal(validBriefingPreferences({timezone:'Asia/Shanghai',time:'24:00'}),false);
});

test('briefing initialization uses the browser timezone until the user saves a choice', () => {
    const saved = { timezone: 'Asia/Shanghai', time: '09:15' };
    assert.deepEqual(initialBriefingPreferences(saved, false, 'America/New_York'), { timezone: 'America/New_York', time: '08:00' });
    assert.deepEqual(initialBriefingPreferences(saved, true, 'America/New_York'), saved);
    assert.deepEqual(initialBriefingPreferences(saved, false, 'Fake/Zone'), { timezone: 'Asia/Shanghai', time: '08:00' });
    assert.deepEqual(initialBriefingPreferences(saved, false), { timezone: 'Asia/Shanghai', time: '08:00' });
});

test('private input contains stable attachment IDs without embedding upload data', () => {
    const text=agentInputContent({content:'请查看资料',attachments:{ids:['00000000-0000-4000-8000-000000000001'],fileName:'file'}} as Pick<ChatMessage, 'content'|'attachments'>);
    assert.match(text,/太卜资料:00000000/); assert.ok(!text.includes('base64')); assert.ok(!text.includes('http'));
});
