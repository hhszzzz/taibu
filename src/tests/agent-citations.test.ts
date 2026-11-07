import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '../types';
import type { AgentPart } from '../lib/agent/types';
import { getCitedParagraphs, remarkCitations, splitCitations } from '../lib/chat/markdown-citations';
import { countAgentEvidence, getAgentCitationBase, getAgentCitationLabels, getAgentEvidence, getConversationCitationLabels, nextAgentCitation } from '../lib/agent/evidence';
import { buildAgentWorkspace, parseAgentCitationTarget, resolveAgentWorkspaceLocation } from '../lib/agent/workspace';
import { getAgentCitedParagraph } from '../components/chat/agent/presentation';

const known = (...numbers: number[]) => (cite: number) => numbers.includes(cite);
const REFERENCE = 'bazi_chart:11111111-1111-4111-8111-111111111111';
type Tool = Extract<AgentPart, { type: 'tool' }>;
const knowledge = (id: string, cites: Array<number | undefined>): Tool => ({ type: 'tool', id, name: 'search_knowledge', title: '知识库检索', status: 'completed', input: { query: '庚金' },
    output: cites.map((cite, index) => ({ content: `# 古籍 ${id}-${index + 1}\n段落 ${index + 1}`, ...(cite === undefined ? {} : { cite }) })) });
// The removed focus_chart tool, as older conversations recorded it.
const focus = (id: string, cite?: number): Tool => ({ type: 'tool', id, name: 'focus_chart', title: '定位分析位置', status: 'completed',
    output: { chartFocus: { version: 1, reference: REFERENCE, targetIds: [], includeRelated: true, caption: '月柱 丁丑' }, ...(cite === undefined ? {} : { cite }) } });
const CAST = 'artifact:22222222-2222-4222-8222-222222222222';
const drilldown = (id: string, cite?: number): Tool => ({ type: 'tool', id, name: 'bazi_relations', title: '八字岁运刑冲合害', status: 'completed', input: { reference: CAST, year: 2027 },
    output: { chartReference: CAST, chartKind: 'bazi', selection: { year: 2027 }, result: {}, targets: [{ id: 'bazi:cell:1:1', label: '月柱地支 丑' }], ...(cite === undefined ? {} : { cite }) } });
const answer = (parts: AgentPart[], content: string): ChatMessage => ({ id: `m-${content.length}-${parts.length}`, role: 'assistant', content, createdAt: '2026-10-11',
    agent: { version: 1, runId: 'run', status: 'completed', parts } });

test('citation markers count only when every number in the group is known', () => {
    assert.deepEqual(splitCitations('庚金带煞[1]。用神[2, 3]，见【1、2】与[1][3]。', known(1, 2, 3)),
        ['庚金带煞', { cite: 1 }, '。用神', { cite: 2 }, { cite: 3 }, '，见', { cite: 1 }, { cite: 2 }, '与', { cite: 1 }, { cite: 3 }, '。']);
    assert.deepEqual(splitCitations('数组[0]、编号[1, 9]与[12]', known(1)), ['数组[0]、编号[1, 9]与[12]'], 'an unknown or invented number keeps the whole group as text');
    assert.deepEqual(splitCitations('', known(1)), []);
});

test('the remark plugin turns markers into badges outside code, links and definitions', () => {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations, { isKnown: known(1, 2) });
    const tree = processor.runSync(processor.parse('结论[1]，依据[2]。\n\n`arr[1]` 与 [链接[1]](https://example.com) 不是引用。\n\n```\n[2]\n```\n\n> 引文[1]'));
    const found: unknown[] = [];
    const walk = (node: { type: string; data?: { hProperties?: { dataCite?: number } }; children?: unknown[] }) => {
        if (node.type === 'citation') found.push(node.data?.hProperties?.dataCite);
        (node.children as typeof node[] | undefined)?.forEach(walk);
    };
    walk(tree as Parameters<typeof walk>[0]);
    assert.deepEqual(found, [1, 2, 1], 'inline code, link text and code blocks keep their brackets');
});

test('a later answer badges numbers from an earlier turn', () => {
    const messages = [answer([knowledge('earlier', [1, 2])], '首轮[1][2]。'), answer([focus('now', 3), knowledge('late', [4])], '结论[1][2][3][4]。')];
    const labels = getConversationCitationLabels(messages);
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations, { isKnown: cite => labels.has(cite) });
    const found: unknown[] = [];
    const walk = (node: { type: string; data?: { hProperties?: { dataCite?: number } }; children?: unknown[] }) => {
        if (node.type === 'citation') found.push(node.data?.hProperties?.dataCite);
        (node.children as typeof node[] | undefined)?.forEach(walk);
    };
    walk(processor.runSync(processor.parse(messages[1].content)) as Parameters<typeof walk>[0]);
    assert.deepEqual(found, [1, 2, 3, 4], 'numbers continue across turns and a later answer can cite every earlier source');
});


test('adjacent citations survive the reference link their numeric brackets parse as', () => {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCitations, { isKnown: known(1, 2, 3, 4) });
    const found: unknown[] = [];
    const walk = (node: { type: string; data?: { hProperties?: { dataCite?: number } }; children?: unknown[] }) => {
        if (node.type === 'citation') found.push(node.data?.hProperties?.dataCite);
        if (node.type === 'link' || node.type === 'linkReference') found.push('link');
        (node.children as typeof node[] | undefined)?.forEach(walk);
    };
    walk(processor.runSync(processor.parse('结论[2][3][4]。\n\n[3]: https://example.com/source')) as Parameters<typeof walk>[0]);
    assert.deepEqual(found, [2, 3, 4], 'the reference link text, its label and the following marker are all citations');
    walk(processor.runSync(processor.parse('见[2]。\n\n[2]: https://example.com/source')) as Parameters<typeof walk>[0]);
    assert.deepEqual(found.slice(3), [2], 'a shortcut reference with a numeric label is that citation');
    found.length = 0;
    walk(processor.runSync(processor.parse('见[链接][3]。\n\n[3]: https://example.com/source')) as Parameters<typeof walk>[0]);
    assert.deepEqual(found, ['link'], 'a named reference link is left alone');
    assert.deepEqual([...getCitedParagraphs('第一段[1][2]。\n\n[2]: https://example.com/source', known(1, 2))], [[1, 1], [2, 1]]);
});

test('the cited paragraph counts prose blocks only and keeps the first citing block', () => {
    const markdown = '# 结论\n\n第一段[1]。\n\n- 列表[2]\n- 再次[1]\n\n```\n[3]\n```\n\n---\n\n第三段[3]，又见[2]。';
    assert.deepEqual([...getCitedParagraphs(markdown, known(1, 2, 3))], [[1, 1], [2, 2], [3, 3]]);
    assert.equal(getCitedParagraphs('  ', known(1)).size, 0);
});

test('evidence is numbered once per conversation from the stamps the server wrote', () => {
    assert.equal(nextAgentCitation(4, 7), 7, 'a stamp moves forward');
    assert.equal(nextAgentCitation(4, 3), 5, 'a stale stamp never reuses a number');
    assert.equal(nextAgentCitation(4, null), 5, 'rows saved before numbering continue after the highest number');
    const parts: AgentPart[] = [
        { type: 'text', id: 't', text: '先检索' },
        knowledge('kb', [5, 6]),
        focus('focus', 7),
        { type: 'tool', id: 'web', name: 'web_search', title: '联网检索', status: 'completed', output: [{ title: '来源', url: 'https://example.com', content: '摘要' }] },
        { type: 'tool', id: 'pending', name: 'search_knowledge', title: '知识库检索', status: 'running' },
    ];
    const evidence = getAgentEvidence(parts, 4);
    assert.deepEqual(evidence.map(item => [item.n, item.kind, item.citable]), [[5, 'knowledge', true], [6, 'knowledge', true], [7, 'chart', true], [8, 'web', false]],
        'an unstamped row is listed but its number was never shown to the model');
    assert.deepEqual(countAgentEvidence(evidence), { total: 4, knowledge: 2, chart: 1, web: 1 });
    assert.deepEqual([...getAgentCitationLabels(parts)], [[5, '古籍 kb-1'], [6, '古籍 kb-2'], [7, '八字 · 月柱 丁丑']]);
    assert.equal(getAgentEvidence([knowledge('stale', [2])], 4)[0].citable, false, 'a stamp behind the conversation is not citable');
});

test('a numbered drilldown is chart evidence under its own title; one from before numbering keeps old numbers in place', () => {
    const evidence = getAgentEvidence([knowledge('kb', [1]), drilldown('old'), drilldown('relations', 2), focus('older', 3)]);
    assert.deepEqual(evidence.map(item => [item.n, item.kind, item.toolId, item.citable]), [[1, 'knowledge', 'kb', true], [2, 'chart', 'relations', true], [3, 'chart', 'older', true]]);
    const [, relations] = evidence;
    assert.ok(relations.kind === 'chart');
    assert.equal(relations.chartLabel, '八字', 'the art the drilldown recorded');
    assert.deepEqual(relations.focus.targetIds, ['bazi:cell:1:1']);
    assert.deepEqual([...getConversationCitationLabels([answer([drilldown('relations', 2)], '丑未相冲[2]。')])], [[2, '八字岁运刑冲合害']]);
    // A conversation from before numbering: its drilldowns were never shown a number, so they take none.
    assert.equal(getAgentCitationBase([{ agent: { version: 1, runId: 'a', status: 'completed', parts: [knowledge('legacy', [undefined]), drilldown('legacy-drill')] } }]), 1);
});

test('a new task numbers after the highest number its conversation used', () => {
    const messages: Pick<ChatMessage, 'agent'>[] = [
        { agent: { version: 1, runId: 'a', status: 'completed', parts: [knowledge('a', [1, 2])] } },
        { agent: undefined },
        { agent: { version: 1, runId: 'b', status: 'completed', parts: [knowledge('legacy', [undefined]), focus('b', 4)] } },
    ];
    assert.equal(getAgentCitationBase(messages), 4);
    assert.equal(getAgentCitationBase([]), 0);
    assert.deepEqual([...getConversationCitationLabels(messages)], [[1, '古籍 a-1'], [2, '古籍 a-2'], [4, '八字 · 月柱 丁丑']],
        'a later answer may cite a number an earlier turn returned');
});

test('a citation opens its source and finds the paragraph of the answer that cited it', () => {
    const first = [knowledge('kb', [1, 2])], second = [focus('focus', 3)];
    const messages = [answer(first, '庚金带煞[1]。\n\n用神专求月令[2]。'), answer(second, '月柱丁丑[3]。\n\n再引[2][3][4]。')];
    assert.equal(getAgentCitedParagraph(messages, 2), 2);
    assert.equal(getAgentCitedParagraph(messages, 3), 1);
    assert.equal(getAgentCitedParagraph(messages, 9), null, 'an unknown number cites nothing');
    assert.equal(getAgentCitedParagraph([answer(second, '这里提到 [1] 但不是本轮的依据')], 1), null, 'an answer needs an actual source from its conversation');

    assert.equal(parseAgentCitationTarget('cite:12'), 12);
    for (const id of ['cite:0', 'cite:01', 'cite:x', 'tool:kb', 'cite:1234567890']) assert.equal(parseAgentCitationTarget(id), null, id);
    const model = buildAgentWorkspace({ parts: [...first, ...second], artifacts: [], attachmentIds: [] });
    assert.equal(resolveAgentWorkspaceLocation(model, 'cite:1'), 'evidence');
    assert.equal(resolveAgentWorkspaceLocation(model, 'cite:3'), 'evidence', 'with searches in the conversation, chart positions are listed beside them');
    const chartOnly = buildAgentWorkspace({ parts: second, artifacts: [], attachmentIds: [] });
    const chart = chartOnly.locations.get('focus');
    assert.ok(chart && chart !== 'evidence');
    assert.equal(resolveAgentWorkspaceLocation(chartOnly, 'cite:3'), chart, 'without searches a chart citation opens the chart');
    assert.equal(resolveAgentWorkspaceLocation(chartOnly, 'cite:5'), null);
    const drilled = buildAgentWorkspace({ parts: [drilldown('relations', 4)], artifacts: [], attachmentIds: [] });
    assert.equal(resolveAgentWorkspaceLocation(drilled, 'cite:4'), drilled.chartResources.get(CAST), 'a drilldown citation opens the chart it drilled into');
});
