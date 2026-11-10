import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuestions, validateAnswers, formatQuestionAnswers, questionLabel } from '../lib/agent/questions';
import { validateTodos } from '../lib/agent/todos';
import { forkConversationMessages, conversationHtml, conversationMarkdown } from '../lib/chat/conversation-transfer';
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

test('timeout reminders stay out of exported markdown and forks', () => {
    const reminder: ChatMessage = { id: 't', role: 'user', content: '［系统］用户未在 5 分钟内回答。', createdAt: 'now', metadata: { askTimeout: true, askTimeoutMinutes: 5 } };
    const markdown = conversationMarkdown('导出', [{ id: 'u', role: 'user', content: '帮我看盘', createdAt: 'now' }, reminder]);
    assert.ok(markdown.includes('帮我看盘'));
    assert.ok(!markdown.includes('［系统］'));
    let sequence = 0;
    const fork = forkConversationMessages([
        { id: 'u', role: 'user', content: '帮我看盘', createdAt: 'now' },
        reminder,
        { id: 'a', role: 'assistant', content: '按现有信息继续分析。', createdAt: 'now', agent: { version: 1, runId: 'r', status: 'completed', parts: [] } },
    ], 'a', () => `fork-${++sequence}`);
    assert.deepEqual(fork.map(message => message.content), ['帮我看盘', '按现有信息继续分析。']);
});

test('static HTML exports render GFM tables and block executable HTML, URLs and credentials', () => {
    const html = conversationHtml('<script>title</script>','| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![bad](data:image/svg+xml;base64,abc)');
    assert.match(html,/<table>/); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('href="javascript:'));
    assert.ok(!html.includes('src="data:image/svg'));
    const message:ChatMessage={id:'a',role:'assistant',content:'结果',createdAt:'now',agent:{version:1,runId:'r',status:'completed',parts:[{type:'tool',id:'t',name:'tool',title:'工具',status:'completed',input:{apiKey:'private',systemPrompt:'hidden',visible:'ok'}}]}};
    const markdown=conversationMarkdown('导出',[message],true);
    assert.ok(!markdown.includes('private')); assert.ok(!markdown.includes('hidden')); assert.ok(markdown.includes('visible'));
});

test('private input contains stable attachment IDs without embedding upload data', () => {
    const message={content:'请查看资料',createdAt:'2026-10-24T15:51:30.000Z',attachments:{ids:['00000000-0000-4000-8000-000000000001'],fileName:'file'}} as Pick<ChatMessage, 'content'|'attachments'|'createdAt'>;
    const text=agentInputContent(message);
    assert.match(text,/太卜资料:00000000/); assert.ok(!text.includes('base64')); assert.ok(!text.includes('http'));
    assert.ok(!text.includes('发送时间'), 'undated without a time zone');
});

test('a task handed to a member opens with when the server received it, in the user\'s time zone', () => {
    const message={content:'现在帮我起一卦',createdAt:'2026-10-24T15:51:30.000Z'} as Pick<ChatMessage, 'content'|'attachments'|'createdAt'>;
    assert.equal(agentInputContent(message,'Asia/Shanghai'),'【发送时间：2026-10-24 23:51 星期六，Asia/Shanghai（UTC+08:00）】\n现在帮我起一卦');
    assert.equal(agentInputContent(message,'America/New_York').split('\n')[0],'【发送时间：2026-10-24 11:51 星期六，America/New_York（UTC-04:00）】');
});

test('static HTML exports turn a visual block into a note and collapsible source', () => {
    const html = conversationHtml('导出', '```visual\n<!-- 时间轴 -->\n<div id="x">甲</div>\n<script>alert(1)</script>\n```');
    assert.match(html, /可视化「时间轴」/);
    assert.match(html, /<details><summary>查看源码<\/summary>/);
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;div id=&quot;x&quot;&gt;甲&lt;/div&gt;'));
});
