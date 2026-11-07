// Demo Agent conversations for seed-local-demo.mjs, built the way the runtime
// projects a task (tools.server.ts, runtime.server.ts, durable-projection.server.ts):
// Core charts, calculations and drilldowns run through taibu-core at the
// runtime's detail levels (the model's default reading plus the full-detail
// board), every other tool carries the details its implementation returns,
// and parts use the projection's IDs, order and cached tool rows.
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const MINUTE = 60_000;

// Labels the runtime gives its own tools (tools.server.ts auxiliaryToolTitles and
// tool-catalog.ts extension titles); Core tools use their definition titles.
const TOOL_TITLES = {
  list_user_data: '检索个人资料', read_user_data: '读取命盘与历史', read_user_notes: '读取每日笔记',
  search_conversations: '检索以往对话', record_user_event: '记入档案', propose_archive_entry: '生成保存卡片',
  read_user_profile: '个性化档案', search_knowledge: '知识库检索', web_search: '联网检索', ask_user: '补充必要信息',
  inspect_chart: '查看命盘', todo_write: '更新计划', load_skill: '加载技能',
  read_skill_file: '读取技能文件', read_attachment: '读取附件', read_user_memory: '读取长期记忆', remember_user_fact: '记住偏好',
  codemode: '运行脚本', tool_search: '查找工具', submit_plan: '提交计划', background_agent: '后台子分析',
};

/** `md5(text)::uuid`, as agent_archive_entry_id computes it. */
const md5Uuid = (text) => {
  const hex = createHash('md5').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const stableSeed = (runId, callId) => createHash('sha256').update(`${runId}:${callId}`).digest().readUInt32BE(0);
const text = (rendered) => rendered.content.map((part) => part.text).join('\n');

export async function buildAgentDemo({ root, baziChartId, plainConversations, now = Date.now() }) {
  // ts-register resolves '@/...' against the working directory.
  process.chdir(root);
  const require = createRequire(import.meta.url);
  require('./ts-register.cjs');
  const { getDrilldownTargets } = require('../src/lib/agent/chart-interaction.ts');
  const { agentDrilldownCiteNote } = require('../src/lib/agent/tool-catalog.ts');
  const { getAgentChart } = require('../src/lib/agent/tool-presentation.ts');
  const { normalizeQuestions, formatQuestionAnswers } = require('../src/lib/agent/questions.ts');
  const { normalizeAgentArchiveProposal } = require('../src/lib/agent/archive.ts');
  const { loadAnalysisMethod } = require('../src/lib/agent/methods.server.ts');
  const { formatBaziPromptText } = require('../src/lib/bazi-prompt.ts');
  const { agentInputContent } = require('../src/lib/agent/attachment-input.ts');
  // Read from the engine itself: a seeded task must claim the engine the worker actually runs.
  const { AGENT_ENGINE: ENGINE } = require('../src/lib/agent/engine.ts');
  const core = await import('taibu-core/mcp');
  const definitions = new Map(core.listToolDefinitions().map((definition) => [definition.name, definition]));
  const titleOf = (name) => TOOL_TITLES[name] ?? definitions.get(name)?.title ?? name;
  /** Core 的规范文本，截断成成员过程里放得下的长度（真实运行也只保留开头）。 */
  const coreText = async (name, input, limit = 520) => text(core.buildToolSuccessPayload(name, await core.executeTool(name, { ...input }), { detailLevel: 'full' })).slice(0, limit);
  const isChart = (name) => ['bazi', 'ziwei', 'qimen', 'liuyao', 'meihua', 'daliuren', 'xiaoliuren', 'tarot', 'taiyi', 'astrology', 'almanac'].includes(name);

  const artifacts = [];
  const memories = [];
  const records = [];
  const conversations = [];
  const attachments = [];

  /**
   * One Agent task. Each `turn()` is one model response: its reasoning, text and
   * tool calls become parts in that order, and every call's attachments (the
   * question it asked, the pages it found, a script's own calls) follow it.
   */
  function createTask({ runId, startedAt, citeBase = 0, model = { id: 'demo-model', name: '本地演示模型' } }) {
    const parts = [];
    const responses = [];
    const answers = [];
    const state = { entry: 0, index: 0, task: 0, clock: startedAt, cite: citeBase, citeCalls: {}, todos: undefined, question: undefined };
    const turn = (ms = 2600) => {
      state.entry += 1;
      state.index = 0;
      const begin = state.clock;
      state.clock += ms;
      responses.push({ id: `${state.entry}:0`, durationMs: ms - 40, startedAt: begin, endedAt: state.clock });
    };
    const think = (value) => parts.push({ type: 'reasoning', id: `native:${state.entry}:${state.index++}`, text: value });
    const say = (value) => parts.push({ type: 'text', id: `native:${state.entry}:${state.index++}`, text: value });
    const ids = () => {
      state.task += 1;
      const callId = `toolu_${String(state.entry).padStart(2, '0')}${String(state.index++).padStart(2, '0')}`;
      return { taskId: state.task, callId, cacheId: `${state.task}:${callId}` };
    };
    /** A settled call; `details` may read the call's cache ID. */
    const call = async (name, input, { ms = 500, status = 'completed', details, canonicalText, cache, attach } = {}) => {
      const { taskId, callId, cacheId } = ids();
      const begin = state.clock;
      state.clock += ms;
      const settled = typeof details === 'function' ? await details({ taskId, callId, cacheId }) : { output: details };
      const canonical = settled?.canonicalText ?? canonicalText;
      const part = {
        type: 'tool', id: `native-tool:${state.entry}:${callId}`, name, title: titleOf(name), status, input,
        ...(settled?.output === undefined ? {} : { output: settled.output }),
        ...(canonical === undefined ? {} : { canonicalText: canonical }),
        ...(status === 'completed' || status === 'failed' ? { durationMs: Math.max(1, ms - 30) } : {}),
        startedAt: begin, ...(status === 'completed' || status === 'failed' ? { endedAt: state.clock } : {}),
      };
      // Tools the runtime wraps cache their result as an agent_run_artifacts row (agent_cache_tool).
      if (cache !== false && status === 'completed' && settled?.output !== undefined && !settled.cached) {
        artifacts.push({ id: randomUUID(), runId, callId: cacheId, toolName: name, kind: 'tool', args: input,
          result: { content: [{ type: 'text', text: settled.text ?? canonical ?? JSON.stringify(settled.output) }], details: settled.output, ...(canonical ? { canonicalText: canonical } : {}) } });
      }
      parts.push(part, ...(attach ? attach({ cacheId, part }) : []));
      return { part, taskId, callId, cacheId, ...settled };
    };

    /** A Core reading or calculation, cached with its full-detail snapshot like the runtime's calculation tools. */
    const coreResult = async (name, input, cacheId) => {
      const stable = { ...input };
      if (definitions.get(name)?.inputSchema.properties?.seed && stable.seed == null) stable.seed = String(stableSeed(runId, cacheId));
      const raw = await core.executeTool(name, stable);
      const rendered = core.buildToolSuccessPayload(name, raw, { detailLevel: core.normalizeTransportDetailLevel(input.detailLevel) });
      const snapshot = isChart(name)
        ? core.buildToolSuccessPayload(name, raw, { detailLevel: name === 'astrology' && raw?.chartMeta?.calculationMode === 'approximate' ? 'more' : 'full' })
        : null;
      const id = randomUUID();
      const canonical = text(rendered);
      artifacts.push({ id, runId, callId: cacheId, toolName: name, kind: 'calculation', args: input,
        result: { content: rendered.content, details: rendered.structuredContent ?? raw, canonicalText: canonical,
          ...(snapshot ? { chartSnapshot: { kind: name, result: snapshot.structuredContent, canonicalText: text(snapshot) } } : {}) } });
      const output = { artifactId: id, result: rendered.structuredContent ?? raw, ...(snapshot ? { board: snapshot.structuredContent } : {}) };
      const chart = snapshot ? {
        kind: name, reference: `artifact:${id}`, args: stable, board: snapshot.structuredContent, boardText: text(snapshot),
        value: getAgentChart({ name, status: 'completed', output: { board: snapshot.structuredContent } }),
      } : null;
      return { output, canonicalText: canonical, chart, cached: true };
    };
    const chart = (name, input, options = {}) => call(name, input, { ms: 900, ...options, details: ({ cacheId }) => coreResult(name, input, cacheId) });
    const calculate = chart;

    /**
     * A drilldown of a reading: Core's same-named tool on the reading's own input, located on its board and numbered
     * after the conversation's evidence, as the runtime numbers the main agent's own drilldowns.
     */
    const drill = (name, reading, selection, options = {}) => {
      const input = { reference: reading.reference, ...selection };
      return call(name, input, { ms: 700, ...options, details: async ({ cacheId }) => {
        const rendered = core.buildToolSuccessPayload(name, await core.executeTool(name, { ...reading.args, ...selection }),
          { detailLevel: core.normalizeTransportDetailLevel(selection.detailLevel) });
        const targets = getDrilldownTargets(reading.value, rendered.structuredContent).map(({ id, label }) => ({ id, label }));
        state.cite += 1;
        state.citeCalls[cacheId] = state.cite;
        const output = { chartReference: reading.reference, chartKind: reading.kind, selection, result: rendered.structuredContent, targets, cite: state.cite };
        artifacts.push({ id: randomUUID(), runId, callId: cacheId, toolName: name, kind: 'tool', args: input,
          result: { content: [{ type: 'text', text: text(rendered) }, { type: 'text', text: agentDrilldownCiteNote(state.cite) }], details: output, canonicalText: text(rendered) } });
        return { output, canonicalText: text(rendered), cached: true };
      } });
    };
    /** Search rows numbered after the conversation's evidence, as stampCitations does. */
    const stamp = (cacheId, rows) => {
      const stamped = rows.map((row) => ({ ...row, cite: ++state.cite }));
      if (stamped.length) state.citeCalls[cacheId] = state.cite;
      return stamped;
    };
    const knowledge = (query, rows) => call('search_knowledge', { query }, { ms: 800, details: ({ cacheId }) => ({ output: stamp(cacheId, rows) }) });
    const web = (query, rows) => call('web_search', { query }, { ms: 1600, details: ({ cacheId }) => ({ output: stamp(cacheId, rows) }),
      attach: ({ cacheId, part }) => part.output.map((row, index) => ({ type: 'source', id: `${cacheId}:${index}`, title: row.title, url: row.url, content: row.content })) });
    const tool = (name, input, details, options = {}) => call(name, input, { ...options, details });
    const todo = async (items) => {
      const revision = state.todos?.revision ?? 0;
      const result = await call('todo_write', { revision, items }, { ms: 120, details: { revision: revision + 1, items } });
      state.todos = { revision: revision + 1, items };
      return result;
    };
    /** ask_user: waiting leaves the card open; answered adds the user's reply for this question. */
    const ask = async (questions, reply) => {
      const normalized = normalizeQuestions(questions);
      const question = normalized.map((item) => item.question).join('\n\n');
      const result = await call('ask_user', { questions }, { status: reply ? 'completed' : 'awaiting_input', ms: reply ? 600 : 0, cache: false,
        details: reply ? { question, questions: normalized, awaitingUser: true } : undefined,
        attach: ({ cacheId }) => [{ type: 'question', id: cacheId, question, questions: normalized }] });
      if (reply) answers.push({ questionId: result.cacheId, content: formatQuestionAnswers(normalized, reply), answers: reply });
      else state.question = { question, questions: normalized, questionId: result.cacheId };
      return result;
    };
    /** A plan submission and its decision: 批准, or 要求修改 with the feedback the user typed. */
    const plan = async (planText, decision = 'approve', feedback = '') => {
      const questions = [{ id: 'plan', question: '是否按这个计划执行？', options: [{ id: 'approve', label: '批准' }, { id: 'revise', label: '要求修改' }], allowCustom: true, allowSkip: false }];
      const approved = decision === 'approve';
      const result = await call('submit_plan', { plan: planText }, { ms: 400, cache: false,
        details: { plan: planText, approved, ...(approved || !feedback ? {} : { feedback }) },
        attach: ({ cacheId }) => [{ type: 'question', id: cacheId, question: questions[0].question, questions }] });
      const reply = approved ? ['approve'] : [feedback || 'revise'];
      answers.push({ questionId: result.cacheId, content: formatQuestionAnswers(questions, { plan: reply }), answers: { plan: reply } });
      return result;
    };
    /** A code mode script and the calls it made, nested under its card in call order. */
    const script = async (code, calls, printed) => {
      const nested = [];
      const result = await call('codemode', { code }, { ms: 4200, cache: false, details: async ({ callId }) => {
        const rows = [];
        for (const [index, [name, input]] of calls.entries()) {
          state.task += 1;
          const taskId = state.task, number = index + 1;
          const settled = await coreResult(name, input, `${taskId}:${callId}/c${number}`);
          const begin = state.clock - 3800 + index * 600;
          rows.push({ id: number, name, args: JSON.stringify(input), status: 'ok', error: null });
          nested.push({ type: 'tool', id: `nested:${taskId}`, name, title: titleOf(name), status: 'completed', input, output: settled.output,
            canonicalText: settled.canonicalText, scriptCall: number, startedAt: begin, endedAt: begin + 420 });
        }
        return { output: { calls: rows, output: printed } };
      }, attach: ({ part }) => nested.map((item) => ({ ...item, parentId: part.id })) });
      return result;
    };
    const finish = ({ status = 'completed', followUps, usage = 18_400 } = {}) => {
      const todoPart = state.todos ? [{ type: 'todo', id: 'task-list', ...state.todos }] : [];
      const tools = parts.filter((part) => part.type === 'tool').length;
      const runtime = {
        model: { ...model, contextWindow: 200_000, limitSource: 'configured' },
        responses,
        context: { tokens: usage, measuredTokens: usage - 1200, estimatedTokens: 1200, source: 'mixed', input: usage - 2600, output: 2600, cacheRead: Math.round(usage * 0.4), compactions: 0 },
        // 系统提示注入的方法目录占的 token（真实运行由网关 count_tokens 计数，这里取一个相近的固定值）。
        skillsTokens: 720,
        usage: { models: { [model.id]: { input: usage * 3, output: 2600 * tools, totalTokens: usage * 3 + 2600 * tools } }, tools: {}, totalTokens: usage * 3 + 2600 * tools },
        ...(status === 'awaiting_input' ? { activity: { phase: 'awaiting_input' } } : {}),
      };
      return {
        status, runtime, answers, endedAt: state.clock,
        parts: [...todoPart, ...parts],
        followUps,
        checkpoint: {
          ...(state.todos ? { todos: state.todos } : {}),
          ...(state.question ?? {}),
          citations: { base: citeBase, calls: state.citeCalls },
        },
        lastCite: state.cite,
      };
    };
    return { turn, think, say, call, chart, calculate, drill, knowledge, web, tool, todo, ask, plan, script, finish, resolve: coreResult };
  }

  /** A conversation of one or more tasks, each with its question, the task's message and any replies. */
  async function conversation({ id, title, hoursAgo, rounds }) {
    const messages = [];
    const runs = [];
    let citeBase = 0;
    let clock = now - hoursAgo * 60 * MINUTE;
    const createdAt = clock;
    for (const round of rounds) {
      const runId = round.runId;
      const question = { at: clock, content: round.question };
      // Files sent with the question: the message keeps their names and IDs, the model reads their markers.
      const attached = round.attachments?.length
        ? { attachments: { fileName: round.attachments.map((item) => item.name).join('、'), ids: round.attachments.map((item) => item.id) } } : {};
      const task = createTask({ runId, startedAt: clock + 3000, citeBase, model: round.model });
      const result = await round.build(task);
      citeBase = result.lastCite;
      const input = {
        model: (round.model ?? { id: 'demo-model' }).id, reasoning: true, reasoningEffort: 'medium', webEnabled: round.webEnabled ?? false,
        codeMode: round.codeMode ?? false, planMode: round.planMode ?? false, memoryEnabled: round.memoryEnabled ?? true,
        ...(round.collaborators ? { collaborators: round.collaborators } : {}), timezone: 'Asia/Shanghai',
        systemPrompt: '本地演示任务', title, userMessage: { id: `${id}-${runId.slice(-2)}-u`, role: 'user', content: round.question, createdAt: new Date(question.at).toISOString(), ...attached },
      };
      const agent = { version: 1, runId, status: result.status, parts: result.parts, runtime: result.runtime, ...(result.followUps ? { followUps: result.followUps } : {}) };
      const answer = result.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
      const settledAt = result.endedAt + 1500;
      const model = round.model ?? { id: 'demo-model', name: '本地演示模型' };
      // conversation_messages.metadata holds the rest of the ChatMessage (replace_conversation_messages); readers spread it back.
      const assistant = { id: `agent:${runId}`, role: 'assistant', content: answer, createdAt: new Date(settledAt).toISOString(), model: model.id, modelName: model.name, agent, metadata: {} };
      messages.push({ sequence: messages.length, messageId: input.userMessage.id, role: 'user', content: round.question, metadata: attached, createdAt: question.at });
      messages.push({ sequence: messages.length, messageId: assistant.id, role: 'assistant', content: answer, metadata: { model: model.id, modelName: model.name, agent, metadata: {} }, createdAt: settledAt });
      for (const [index, reply] of result.answers.entries()) {
        messages.push({ sequence: messages.length, messageId: `${id}-${runId.slice(-2)}-a${index + 1}`, role: 'user', content: reply.content,
          metadata: { metadata: { agentRunId: runId, agentCommandMode: 'reply', agentQuestionId: reply.questionId, agentAnswers: reply.answers } }, createdAt: question.at + 60_000 * (index + 1) });
      }
      runs.push({
        id: runId, status: result.status, input, billing: 'metered',
        checkpoint: {
          version: 2, durable: { engine: ENGINE, seeded: true, started: true },
          messages: [{ role: 'user', content: agentInputContent(input.userMessage, input.timezone), timestamp: question.at }],
          parts: result.parts, runtime: result.runtime, ...result.checkpoint,
          ...(result.followUps ? { followUps: result.followUps } : {}),
          ...(round.planMode ? { planApproved: true } : {}),
        },
        publicMessage: assistant, createdAt: question.at, updatedAt: settledAt,
      });
      clock = settledAt + (round.gapMinutes ?? 20) * MINUTE;
    }
    conversations.push({ id, title, createdAt, updatedAt: clock, messages, runs });
  }

  const birth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, birthPlace: '上海市', longitude: 121.47, timezone: 'Asia/Shanghai' };
  const run = (n) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const conv = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const savedChartText = formatBaziPromptText({ name: '演示命盘', gender: 'male', birthDate: '1990-01-15', birthTime: '09:00', birthPlace: '上海市', longitude: 121.47, calendarType: 'solar', timezone: 'Asia/Shanghai', disambiguation: 'reject' }, null, undefined, 20);
  const noteRows = [
    { date: '2026-10-23', mood: '焦虑', content: '睡得晚，但早上还是按计划起来了。' },
    { date: '2026-10-22', mood: '安宁', content: '今天把手机放在另一个房间，专注时间明显变长。' },
  ];
  // A private document sent with the archive task; the seed stores the file and its agent_attachments row.
  const resume = {
    id: 'ffffffff-0000-4000-8000-000000000001', name: '工作经历.txt',
    text: '工作经历\n\n2019.07–2024.02  某互联网公司 · 产品经理\n- 负责会员增长线，一年内会员续费率提升 18%\n- 主导两次改版，熟悉 C 端增长与数据分析\n\n2024.03–至今  现公司 · 高级产品经理\n- 负责 B 端协同产品，带 3 人小组\n- 2024.06 试用期提前转正\n\n下一步：希望转向有决策权的产品负责人岗位。',
  };
  attachments.push(resume);
  const resumeBytes = Buffer.from(resume.text, 'utf-8');
  const resumeRead = { id: resume.id, name: resume.name, kind: 'text', mimeType: 'text/plain', size: resumeBytes.length, sha256: createHash('sha256').update(resumeBytes).digest('hex') };
  // The memory the user already had, and the preference task 7 writes from their own words.
  const memoryRows = [
    { id: randomUUID(), title: '称呼偏好', content: '叫我阿卜就好', kind: 'preference', updated_at: new Date(now - 200 * 60 * MINUTE).toISOString() },
  ];
  const rememberRow = { id: randomUUID(), title: '时间表述偏好', content: '以后都用公历时间跟我说', kind: 'preference', updated_at: new Date(now - 75 * 60 * MINUTE).toISOString() };
  memories.push({ ...memoryRows[0], sourceRunId: null, sourceText: '' }, { ...rememberRow, sourceRunId: run(9), sourceText: '记住以后都用公历时间跟我说' });

  // 1. 八字流年，两轮：首轮排盘、详查与引用；次轮沿用同一张盘扫描流年并给出保存卡片。
  let baziReading;
  await conversation({
    id: conv(5), title: '看看 2026 年的流年运势', hoursAgo: 3,
    rounds: [
      {
        runId: run(1), question: '帮我排个八字，看看 2026 年的流年运势。男，1990 年 1 月 15 日 9 点，出生地上海。',
        build: async (t) => {
          t.turn();
          t.think('出生信息齐全：公历 1990-01-15 09:00，上海，经度约 121.47°，需要按真太阳时排盘。先列计划，再排原局，流年重点看丙午与原局的刑冲合害。');
          await t.todo([
            { id: 'chart', title: '按真太阳时排八字原局', status: 'in_progress' },
            { id: 'luck', title: '核对大运与 2026 年流年关系', status: 'pending' },
            { id: 'answer', title: '结合依据给出结论', status: 'pending' },
          ]);
          t.turn();
          t.say('先按出生地的真太阳时排盘。');
          baziReading = (await t.chart('bazi', birth)).chart;
          t.turn();
          t.think('需要大运和流年的刑冲合害，先加载低频工具。');
          await t.call('tool_search', { query: '大运 流年 刑冲合害' }, { ms: 200, cache: false, details: { loaded: ['bazi_dayun', 'bazi_relations', 'bazi_wuxing'], labels: ['大运', '八字岁运刑冲合害', '八字五行旺衰'] } });
          t.turn();
          await t.todo([
            { id: 'chart', title: '按真太阳时排八字原局', status: 'completed' },
            { id: 'luck', title: '核对大运与 2026 年流年关系', status: 'in_progress' },
            { id: 'answer', title: '结合依据给出结论', status: 'pending' },
          ]);
          await t.calculate('bazi_dayun', birth);
          await t.drill('bazi_relations', baziReading, { year: 2026 });
          await t.drill('bazi_wuxing', baziReading, {});
          t.turn();
          await t.knowledge('庚金 七杀 丙午 流年 丑午相害', [
            { id: 'kb-1', kbId: 'demo-kb', content: '# 七杀与正官的区别\n七杀主压力、竞争与突破，正官主规则、名分与责任。身强逢杀，可化压力为权柄。', method: 'fts', metadata: { file_name: '十神总论.md', category: '命理基础' } },
            { id: 'kb-2', kbId: 'demo-kb', content: '# 流年与提纲\n流年冲害原局，先看被冲害之神在原局的喜忌，再看有无合解；冲害提纲者，多主环境与节奏的变化。', method: 'vector', metadata: { file_name: '流年判断.md', category: '流年' } },
          ]);
          await t.tool('read_user_notes', { since: '2026-10-01' }, { notes: noteRows, more: false }, { ms: 150 });
          await t.tool('read_user_profile', {}, { profile: { identity: '互联网产品经理，正在考虑转向更有决策权的岗位' }, defaultBaziChartId: baziChartId, defaultZiweiChartId: null }, { ms: 120 });
          t.turn(5200);
          await t.todo([
            { id: 'chart', title: '按真太阳时排八字原局', status: 'completed' },
            { id: 'luck', title: '核对大运与 2026 年流年关系', status: 'completed' },
            { id: 'answer', title: '结合依据给出结论', status: 'completed' },
          ]);
          // 建议问题由投影从回答尾部拆出（follow-ups.ts），正文里不再出现。
          t.say('2026 年是丙午年。你是庚金日主、生在丑月，月令土旺、日主得相[2]；流年丙火七杀透出[1]，对你来说这一年的主题是“在压力里找方向”：七杀主压力，也主突破[3]。\n\n具体看三点：\n\n1. **事业**：七杀代表有分量的机会，但会伴随更高的要求。上半年适合把已有项目做深，不建议同时开三条战线。\n2. **节奏**：流年午火与月支丑土相害[1]，提纲受扰，多主环境与节奏的变化[4]。你最近的笔记也提到睡得晚，把重要决定放在精力稳定的时段，别在赶工后拍板。\n3. **财务**：有机会增加收入，但冲动型支出也会变多，先留出三个月的缓冲。\n\n整体不是“大起大落”的一年，更像一次结构升级：把不合适的部分放掉，留下真正能长期做的。');
          // One suggestion per answer (follow-ups.ts): the next round's question is exactly this one.
          return t.finish({ followUps: ['2026 年适合换工作吗？'] });
        },
      },
      {
        runId: run(2), question: '2026 年适合换工作吗？',
        build: async (t) => {
          t.turn();
          t.think('用户问换工作。沿用上一轮的盘；再看已保存的命盘和断事笔记，扫描 2026–2028 年的流年。');
          await t.tool('list_user_data', { types: ['bazi_chart'] }, { items: [{ id: baziChartId, type: 'bazi_chart', name: '演示命盘', preview: '八字命盘 - 1990-01-15', createdAt: new Date(now - 26 * 60 * MINUTE).toISOString() }], errors: [] }, { ms: 160 });
          await t.tool('read_user_data', { type: 'bazi_chart', id: baziChartId }, { id: baziChartId, type: 'bazi_chart', chartReference: `bazi_chart:${baziChartId}` },
            { ms: 220, canonicalText: savedChartText });
          t.turn();
          await t.drill('bazi_liunian_scan', baziReading, { fromYear: 2026, toYear: 2028 });
          t.turn();
          await t.call('propose_archive_entry', { kind: 'conclusion', category: 'prediction', title: '2026 年下半年适合换岗', content: '七杀透出、丑午相害，上半年做深现有项目，下半年再争取更有决策权的岗位。', date: '2026-09', tags: ['事业'] },
            { ms: 180, details: ({ cacheId }) => ({
              output: { runId: run(2), callId: cacheId, proposal: normalizeAgentArchiveProposal({ kind: 'conclusion', category: 'prediction', title: '2026 年下半年适合换岗', content: '七杀透出、丑午相害，上半年做深现有项目，下半年再争取更有决策权的岗位。', date: '2026-09', tags: ['事业'] }, null) },
              text: '已生成「结论」保存卡片，由用户决定是否保存；不要声称已保存。',
            }) });
          t.turn(4200);
          t.say('可以换，但别急在上半年。\n\n- **2026 年**：七杀透出、午火与月支丑土相害[5]，外部要求多。上半年在现岗位把成果做扎实，攒下谈判筹码；下半年再争取更有决策权的岗位。\n- **2027 年**：丁未与月支丑土相冲又相刑[5]，是三年里变动最大的一年。如果 2026 年没动，换岗多半会被推着发生，提前准备比被动应对好。\n- **2028 年**：巳申相合，但合中带刑带破[5]，适合在新岗位上稳住，不宜再大动。\n\n我把这条判断做成了一张保存卡片，你觉得有用可以点保存，之后回看是否应验。');
          return t.finish({ followUps: ['换岗前要准备什么？'] });
        },
      },
    ],
  });

  // 2. 奇门择时：起局、开门所在宫位的详查、择日筛选与联网检索。
  await conversation({
    id: conv(6), title: '下个月适合安排重要沟通吗', hoursAgo: 2,
    rounds: [{
      runId: run(3), webEnabled: true,
      question: '用奇门看一下，下个月适合安排一场重要沟通吗？我在上海，想问工作上的合作。',
      build: async (t) => {
        t.turn();
        t.think('按提问时间起局，问沟通合作先看开门落宫；择日用黄历筛选下月的候选日。');
        const qimen = (await t.chart('qimen', { year: 2026, month: 10, day: 24, hour: 15, minute: 30, timezone: 'Asia/Shanghai', question: '下个月的重要合作沟通' })).chart;
        t.turn();
        await t.call('tool_search', { query: '奇门宫位 择日' }, { ms: 200, cache: false, details: { loaded: ['qimen_palace', 'almanac_select'], labels: ['奇门宫位', '黄历择日筛选'] } });
        t.turn();
        await t.drill('qimen_palace', qimen, { palace: 9 });
        await t.calculate('almanac_select', { startDate: '2026-11-01', endDate: '2026-11-30', activity: '订盟', excludeClash: ['蛇'], timezone: 'Asia/Shanghai' });
        t.turn();
        await t.web('重要商务谈判 前期准备 要点', [
          { title: '商务谈判前的三项准备', url: 'https://example.com/negotiation-prep', content: '明确底线、准备替代方案、提前确认决策人，是谈判前最有效的三项准备。' },
          { title: '如何安排一场高效的合作会议', url: 'https://example.com/meeting-agenda', content: '会前发送议程与材料，会上先对齐目标再讨论细节，会后 24 小时内发出纪要。' },
        ]);
        t.turn(4800);
        t.say('可以安排，但要多做准备。\n\n开门落离九宫，天盘戊土得令、月干临宫，事情本身有人推动[1]；但离宫火克开门金，门受宫制[1]，说明**阻力在环境与准备，不在时机**。建议放在下月上旬，提前三天把方案、底线和可让步项写清楚[2][3]。\n\n如果要挑具体日子，择日筛选里下月初的几个候选日更合适（见工作区里的择日结果）；但真正决定结果的，是你带去的信息是否具体。');
        return t.finish({ followUps: ['换成六爻再对照一次'] });
      },
    }],
  });

  // 3. 多模型协作：三位成员分工会诊，主模型自己排紫微并详查；次轮交给常驻后台子分析继续跟进。
  const collaborators = [
    { id: 'member-ziping', name: '子平', model: 'demo-model', focus: '格局与用神', reasoning: true, reasoningEffort: 'high' },
    { id: 'member-ziwei', name: '紫微', model: 'demo-model', focus: '官禄宫与运限', reasoning: true, reasoningEffort: 'medium' },
    { id: 'member-review', name: '复核', model: 'demo-model', focus: '逐条核对生克', reasoning: false, reasoningEffort: null },
  ];
  await conversation({
    id: conv(7), title: '八字和紫微一起看事业方向', hoursAgo: 28,
    rounds: [
      {
        runId: run(4), collaborators,
        question: '八字和紫微一起看看我的事业方向，适合继续做产品还是转管理？',
        build: async (t) => {
          t.turn();
          t.think('启用了多模型协作：三位成员分工，主任务自己排紫微并核对官禄宫，最后汇总分歧。');
          const ziwei = (await t.chart('ziwei', { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, longitude: 121.47, timezone: 'Asia/Shanghai' })).chart;
          await t.call('tool_search', { query: '紫微宫位 运限' }, { ms: 200, cache: false, details: { loaded: ['ziwei_palace', 'ziwei_horoscope'], labels: ['紫微宫位', '紫微运限'] } });
          t.turn();
          await t.drill('ziwei_palace', ziwei, { palace: '官禄' });
          await t.calculate('ziwei_horoscope', { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, longitude: 121.47, timezone: 'Asia/Shanghai', targetDate: '2026-10-24' });
          t.turn();
          const topics = [{ title: '是否转管理', options: ['继续做产品', '转管理'] }, { title: '时间窗口' }];
          // 成员过程里的参数与返回都用真实 Core 输出，展开成员步骤时看到的是具体数据。
          const memberBirth = { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, longitude: 121.47, timezone: 'Asia/Shanghai' };
          const memberText = {
            bazi: await coreText('bazi', memberBirth),
            wuxing: await coreText('bazi_wuxing', memberBirth),
            relations: await coreText('bazi_relations', { ...memberBirth, year: 2027 }),
            ziwei: await coreText('ziwei', memberBirth),
            palace: await coreText('ziwei_palace', { ...memberBirth, palace: '官禄' }),
          };
          await t.call('parallel_analysis', {
            title: '三方会诊', topics,
            tasks: [
              { agentId: 'member-ziping', system: 'bazi', question: '按子平法看事业格局与用神，判断适合继续做产品还是转管理。', name: '子平' },
              { agentId: 'member-ziwei', system: 'ziwei', question: '看官禄宫与当前大限、流年，判断适合继续做产品还是转管理。', name: '紫微' },
              { agentId: 'member-review', system: 'bazi', question: '逐条复核生克关系，指出前两位可能的偏差。', name: '复核' },
            ],
          }, { ms: 52_000, cache: false, details: { title: '三方会诊', topics, analyses: [
            { system: 'bazi', conversationId: 31, status: 'completed', agentId: 'member-ziping', name: '子平', model: 'demo-model', modelName: '本地演示模型', reasoningEffort: 'high', focus: '格局与用神',
              answer: '庚金生丑月，身不弱，七杀透出可作权柄。宜往带团队、有决策权的方向走，转管理更能发挥格局。', positions: { 是否转管理: '转管理', 时间窗口: '2026 年下半年' }, toolCalls: 3, durationMs: 41_000,
              steps: [
                { name: 'bazi', title: '八字命盘', status: 'completed', note: '先按真太阳时排盘。', input: JSON.stringify(memberBirth), output: memberText.bazi, truncated: true },
                { name: 'bazi_wuxing', title: '八字五行旺衰', status: 'completed', input: JSON.stringify({ sections: ['通根', '缺失五行'] }), output: memberText.wuxing, truncated: true },
                { name: 'bazi_relations', title: '八字岁运刑冲合害', status: 'completed', input: JSON.stringify({ year: 2027 }), output: memberText.relations, truncated: true },
              ] },
            { system: 'ziwei', conversationId: 32, status: 'completed', agentId: 'member-ziwei', name: '紫微', model: 'demo-model', modelName: '本地演示模型', reasoningEffort: 'medium', focus: '官禄宫与运限',
              answer: '官禄宫主星稳重，适合专业路线；当前大限偏重积累，转管理可以，但要先在专业上立住。', positions: { 是否转管理: '继续做产品', 时间窗口: '2027 年春' }, toolCalls: 2, durationMs: 36_000,
              steps: [
                { name: 'ziwei', title: '紫微斗数命盘', status: 'completed', input: JSON.stringify(memberBirth), output: memberText.ziwei, truncated: true },
                { name: 'ziwei_palace', title: '紫微宫位', status: 'completed', note: '重点看官禄宫。', input: JSON.stringify({ palace: '官禄' }), output: memberText.palace, truncated: true },
              ] },
            { system: 'bazi', conversationId: 33, status: 'completed', agentId: 'member-review', name: '复核', model: 'demo-model', modelName: '本地演示模型', reasoningEffort: 'off', focus: '逐条核对生克',
              answer: '两位的依据都成立，分歧在节奏：子平看格局，紫微看大限。建议先争取管理职责，再换岗位名义。', positions: { 是否转管理: '转管理', 时间窗口: '2026 年下半年至 2027 年春' }, toolCalls: 1, durationMs: 18_000,
              steps: [{ name: 'bazi', title: '八字命盘', status: 'completed', input: JSON.stringify(memberBirth), output: memberText.bazi, truncated: true }] },
          ] } });
          t.turn(5600);
          t.say('三位成员的结论有分歧，但方向一致：**可以往管理走，关键在节奏。**\n\n| 成员 | 判断 | 时间窗口 |\n|---|---|---|\n| 子平 | 转管理，七杀可作权柄 | 2026 年下半年 |\n| 紫微 | 先在专业上立住，再转 | 2027 年春 |\n| 复核 | 先争取管理职责，再换名义 | 2026 下半年至 2027 春 |\n\n我自己看的紫微官禄宫是武曲、贪狼同坐，生年禄、权都落在这里[1]，做事务实、执行力强，所以更稳妥的做法是：**今年下半年先在现岗位接带人的职责**，做出一两件有说服力的事，2027 年春天再正式换岗或换名义。');
          return t.finish({ followUps: ['让后台继续跟进紫微流年'] });
        },
      },
      {
        runId: run(5), collaborators,
        question: '让后台继续跟进一下紫微流年，有变化再告诉我。',
        build: async (t) => {
          t.turn();
          await t.call('background_agent', { action: 'spawn', name: '紫微流年跟进', system: 'ziwei', message: '按用户命盘逐月跟进 2026 年下半年的紫微流月，有明显变化时回报。' },
            { ms: 9000, cache: false, details: { action: 'spawn', name: '紫微流年跟进', system: 'ziwei', conversationId: 41, reporterId: 7, analyses: [
              { system: 'ziwei', conversationId: 41, status: 'completed', name: '紫微流年跟进', answer: '2026 年 11 月流月官禄宫有化权，适合主动争取职责；12 月节奏放缓。', toolCalls: 2, durationMs: 9000,
                steps: [
                  { name: 'ziwei', title: '紫微斗数命盘', status: 'completed', input: JSON.stringify({ gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, longitude: 121.47, timezone: 'Asia/Shanghai' }),
                    output: await coreText('ziwei', { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, longitude: 121.47, timezone: 'Asia/Shanghai' }), truncated: true },
                  { name: 'ziwei_horoscope', title: '紫微斗数运限', status: 'completed', input: JSON.stringify({ targetDate: '2026-11-15' }),
                    output: await coreText('ziwei_horoscope', { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, longitude: 121.47, timezone: 'Asia/Shanghai', targetDate: '2026-11-15' }), truncated: true },
                ] },
            ] } });
          t.turn(2400);
          t.say('已经交给后台的“紫微流年跟进”。它的第一次回报：**11 月流月官禄宫有化权，适合主动争取职责；12 月节奏放缓。** 之后有明显变化会继续在这里告诉你。');
          return t.finish();
        },
      },
    ],
  });

  // 4. 代码模式：一段脚本批量排五个时辰，嵌套调用挂在脚本卡片下。
  await conversation({
    id: conv(8), title: '比较早上几个时辰的命盘差异', hoursAgo: 30,
    rounds: [{
      runId: run(6), codeMode: true,
      question: '我出生时间不太确定，大概在早上 7 点到 11 点之间，帮我比较一下这几个时辰的八字有什么不同。',
      build: async (t) => {
        t.turn();
        t.think('需要批量排盘比较，用代码模式一次调用多个时辰，只把差异汇总出来。');
        const hours = [7, 8, 9, 10, 11];
        await t.script(
          'const rows = [];\nfor (const birthHour of [7, 8, 9, 10, 11]) {\n  const { data } = await tools.bazi({ gender: "male", birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour, timezone: "Asia/Shanghai" });\n  rows.push(`${birthHour} 点：${data.四柱.map(p => p.干支).join(" ")}`);\n}\nconsole.log(rows.join("\\n"));',
          hours.map((birthHour) => ['bazi', { gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour, timezone: 'Asia/Shanghai' }]),
          '7 点：己巳 丁丑 庚辰 庚辰\n8 点：己巳 丁丑 庚辰 庚辰\n9 点：己巳 丁丑 庚辰 辛巳\n10 点：己巳 丁丑 庚辰 辛巳\n11 点：己巳 丁丑 庚辰 壬午',
        );
        t.turn(3600);
        t.say('五个时辰只落在三个时柱上：\n\n| 出生时间 | 时柱 | 差别 |\n|---|---|---|\n| 7–9 点前 | 庚辰 | 比肩坐印，自主性强 |\n| 9–11 点前 | 辛巳 | 劫财坐七杀，压力与竞争感更明显 |\n| 11 点后 | 壬午 | 食神透出，表达欲与创造力更强 |\n\n年、月、日三柱不变，所以大方向一致，差别主要在“晚年与子女、具体做事方式”。如果你记得出生时天是否已经大亮、或者家里人说过“快中午了”，可以告诉我，我再帮你缩小范围。');
        return t.finish({ followUps: ['帮我用出生时的细节反推时辰'] });
      },
    }],
  });

  // 5. 计划模式：先研究、提交计划并经用户批准，再起卦、详查与择日。
  await conversation({
    id: conv(9), title: '帮我规划 2027 年的重要节点', hoursAgo: 50,
    rounds: [{
      runId: run(7), planMode: true,
      question: '帮我做一份 2027 年的重要节点规划，事业为主，最好能落到具体月份。',
      build: async (t) => {
        t.turn();
        t.think('计划模式：先查方法、确定体系，再提交计划等待批准。');
        await t.tool('load_skill', { name: 'liuyao' }, {
          name: 'liuyao', version: 0, scope: 'builtin', files: [], method: loadAnalysisMethod('liuyao'),
        }, { ms: 140 });
        t.turn();
        await t.plan('## 分析计划\n1. 用六爻起一卦，问 2027 年事业的总体走向，用神取官鬼。\n2. 详查世爻与动爻，看变化落在哪几个月。\n3. 用黄历筛选 2027 年适合启动新项目的日子。', 'revise', '节点要落到季度，并给出可以启动的具体月份');
        t.turn();
        await t.plan('## 分析计划\n1. 用六爻起一卦，问 2027 年事业的总体走向，用神取官鬼。\n2. 详查世爻与动爻，看变化落在哪几个月。\n3. 用黄历筛选 2027 年适合启动新项目的日子，给出具体月份。\n4. 汇总成按季度的节点表。');
        t.turn();
        const liuyao = (await t.chart('liuyao', { question: '2027 年事业的总体走向', yongShenTargets: ['官鬼'], method: 'auto', date: '2026-10-22T10:00:00', timezone: 'Asia/Shanghai' })).chart;
        await t.call('tool_search', { query: '六爻动爻 择日' }, { ms: 200, cache: false, details: { loaded: ['liuyao_line', 'almanac_select'], labels: ['六爻逐爻详查', '黄历择日筛选'] } });
        t.turn();
        await t.drill('liuyao_line', liuyao, { role: '世' });
        await t.chart('almanac', { date: '2027-03-01', timezone: 'Asia/Shanghai', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 });
        await t.calculate('almanac_select', { startDate: '2027-03-01', endDate: '2027-03-31', activity: '开市', excludeClash: ['蛇', '猪'], timezone: 'Asia/Shanghai' });
        t.turn(5000);
        t.say('按批准的计划，2027 年的事业节点如下：\n\n| 季度 | 节点 | 建议 |\n|---|---|---|\n| 一季度 | 世爻得助，适合启动 | 3 月挑一个黄历宜开市的日子正式启动新项目 |\n| 二季度 | 动爻生变 | 调整团队分工，别同时铺太多线 |\n| 三季度 | 官鬼持世 | 压力最大的阶段，提前准备述职材料 |\n| 四季度 | 收尾 | 复盘成果，为 2028 年的晋升做铺垫 |\n\n三月的候选日已经在工作区的择日结果里，可以直接挑。');
        return t.finish();
      },
    }],
  });

  // 6. 等待回答：补充必要信息的问题停在输入框位置（提交会因本地没有模型与任务状态而失败，仅用于查看布局）。
  await conversation({
    id: conv(10), title: '感情方面最近该注意什么', hoursAgo: 0.5,
    rounds: [{
      runId: run(8), question: '感情方面最近该注意什么？',
      build: async (t) => {
        t.turn();
        t.think('没有出生信息，不能猜。先问出生时间和关注点。');
        t.say('要看感情走势，需要先确认两点信息。');
        await t.ask([
          { id: 'birth', header: '出生时间', question: '你的出生日期和时间是？\n精确到小时即可，不确定可以写大概范围。', allowCustom: true, allowSkip: false },
          { id: 'focus', header: '关注点', question: '你最想了解哪方面？', options: [{ id: 'single', label: '单身，想知道何时遇到合适的人' }, { id: 'relationship', label: '有对象，想看关系走向' }, { id: 'marriage', label: '考虑结婚的时机' }], multiple: false, allowCustom: true, allowSkip: true },
        ]);
        return t.finish({ status: 'awaiting_input', usage: 6400 });
      },
    }],
  });

  // 7. 多种占术对照：塔罗、梅花、小六壬、大六壬（含课传详查）、太乙、占星（含单点详查）；记忆读写与一次失败的联网检索。
  await conversation({
    id: conv(11), title: '用几种占术对照看看下半年', hoursAgo: 75,
    rounds: [{
      runId: run(9), webEnabled: true,
      question: '用几种不同的占术对照看看我下半年的整体运势，记住以后都用公历时间跟我说。',
      build: async (t) => {
        t.turn();
        t.think('用户要求多种占术对照，同时明确了一个长期偏好：以后都用公历时间。先读记忆，再记下这个偏好。');
        await t.tool('read_user_memory', {}, memoryRows.slice(0, 1), { ms: 120 });
        await t.call('remember_user_fact', { title: '时间表述偏好', content: '以后都用公历时间跟我说', kind: 'preference', evidence: '记住以后都用公历时间跟我说' },
          { ms: 160, details: rememberRow });
        t.turn();
        await t.chart('tarot', { spreadType: 'three-card', question: '下半年的整体运势', referenceYear: 2026 });
        await t.chart('meihua', { question: '下半年的整体运势', method: 'time', date: '2026-10-21T20:00:00' });
        await t.chart('xiaoliuren', { date: '2026-10-21', hour: 20, question: '下半年的整体运势' });
        t.turn();
        const daliuren = (await t.chart('daliuren', { date: '2026-10-21', hour: 20, minute: 0, timezone: 'Asia/Shanghai', question: '下半年的整体运势' })).chart;
        await t.call('tool_search', { query: '大六壬课传 占星单点' }, { ms: 200, cache: false, details: { loaded: ['daliuren_lessons', 'astrology_point'], labels: ['大六壬课传详查', '占星单点详查'] } });
        await t.drill('daliuren_lessons', daliuren, {});
        await t.chart('taiyi', { mode: 'day', date: '2026-10-21', timezone: 'Asia/Shanghai', question: '下半年的整体运势' });
        t.turn();
        const astrology = (await t.chart('astrology', { birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9, birthMinute: 0, latitude: 31.2304, longitude: 121.4737, timezone: 'Asia/Shanghai', transitDateTime: '2026-10-21T20:00:00' })).chart;
        await t.drill('astrology_point', astrology, { planet: 'saturn' });
        t.turn();
        await t.call('web_search', { query: '2026 年下半年 土星 逆行 时间' }, { status: 'failed', ms: 8000, cache: false, details: '联网检索暂时不可用，请稍后再试' });
        t.turn(6000);
        t.say('几种占术对照下来，结论比较一致：**下半年先稳后升，11 月是转折点。**\n\n- **塔罗**：三张牌从“过去的消耗”走向“新的开始”，提醒先清理旧事务。\n- **梅花易数**：本卦到变卦是由阻转通，前半段要耐心。\n- **小六壬 / 大六壬**：课传指向“先难后易”，贵人在 11 月前后出现。\n- **太乙**：整体局势平稳，不宜冒进。\n- **占星**：土星行运压在事业宫，带来责任，也带来实打实的积累。\n\n联网核对土星逆行时间这一步没有成功，具体日期等联网恢复后我再帮你补上。以后我都会用公历时间跟你说。');
        return t.finish({ followUps: ['11 月具体该做什么？'] });
      },
    }],
  });

  // 8. 档案：从用户讲述里记一条人生事件，检索以往对话与笔记，并给出事件保存卡片。
  await conversation({
    id: conv(12), title: '记一下我 2024 年换工作的事', hoursAgo: 100,
    rounds: [{
      runId: run(10), attachments: [resume],
      question: '帮我记一下：2024 年 3 月我从老东家离职，去了现在这家公司，工作经历在附件里。顺便看看我以前聊过的跳槽相关的内容。',
      build: async (t) => {
        t.turn();
        t.think('用户亲口讲述了一件已发生的事，可以记入档案；先读附件里的工作经历，再检索以往对话和笔记。');
        await t.tool('read_attachment', { id: resume.id }, { ...resumeRead, text: resume.text, offset: 0, total: resume.text.length, nextOffset: null }, { ms: 180 });
        await t.call('record_user_event', { date: '2024-03', category: '事业', title: '离职并加入现公司', evidence: '2024 年 3 月我从老东家离职，去了现在这家公司' }, { ms: 200, details: ({ cacheId }) => {
          const id = md5Uuid(`${run(10)}:${cacheId}`);
          records.push({ id, title: '离职并加入现公司', content: '2024 年 3 月我从老东家离职，去了现在这家公司', category: 'event', tags: ['事业'], eventDate: '2024-03-01', sourceRunId: run(10) });
          return { output: { target: 'record', id, event: { date: '2024-03-01', category: '事业', title: '离职并加入现公司', detail: '2024 年 3 月我从老东家离职，去了现在这家公司', chart: null } },
            text: '已记入命理记录（人生事件）：2024-03-01｜事业｜离职并加入现公司' };
        } });
        await t.tool('search_conversations', { query: '工作 压力' }, plainConversations.slice(0, 1).map((item) => ({
          conversationId: item.id, messageId: `${item.id}-1`, title: item.title, updatedAt: new Date(now - 24 * 60 * MINUTE).toISOString(),
          role: 'user', excerpt: item.messages[0][1], reply: item.messages[1][1].slice(0, 60), question: null,
        })), { ms: 260 });
        await t.tool('read_user_notes', { keyword: '专注' }, { notes: noteRows.slice(1), more: false }, { ms: 140 });
        t.turn();
        const proposalArgs = { kind: 'event', category: '事业', title: '新公司试用期转正', content: '加入现公司三个月后顺利转正。', date: '2024-06' };
        await t.call('propose_archive_entry', proposalArgs, { ms: 160, details: ({ cacheId }) => ({
          output: { runId: run(10), callId: cacheId, proposal: normalizeAgentArchiveProposal(proposalArgs, null, '2026-10-24') },
          text: '已生成「事件」保存卡片，由用户决定是否保存；不要声称已保存。',
        }) });
        t.turn(3000);
        t.say('已经把“2024 年 3 月离职并加入现公司”记进了命理记录的人生事件。\n\n你的工作经历里写着 2024 年 6 月试用期提前转正、现在带 3 人小组，这和你想转向产品负责人的方向是连贯的。以前你聊过“最近工作压力有点大”，当时的建议是把压力拆成三件具体的事；你 10 月的笔记里也提到专注时间变长了，看得出状态在变好。\n\n另外我按附件生成了一张“新公司试用期转正”的事件卡片，如果时间对得上，可以点保存。');
        return t.finish();
      },
    }],
  });

  // 9. 已停止的任务：排完紫微后用户停止，没有最终回答。
  await conversation({
    id: conv(13), title: '排一下紫微（已停止）', hoursAgo: 120,
    rounds: [{
      runId: run(11), question: '帮我排一下紫微斗数命盘，女，1992 年 8 月 8 日晚上 8 点，杭州。',
      build: async (t) => {
        t.turn();
        t.say('先排命盘。');
        await t.chart('ziwei', { gender: 'female', birthYear: 1992, birthMonth: 8, birthDay: 8, birthHour: 20, birthMinute: 0, longitude: 120.15, timezone: 'Asia/Shanghai' });
        return t.finish({ status: 'cancelled', usage: 5200 });
      },
    }],
  });

  // 10. 合盘：一方直接引用库里已存的命盘，另一方给出出生信息；只列两盘之间的事实，不打分。
  await conversation({
    id: conv(14), title: '和他的八字合不合', hoursAgo: 8,
    rounds: [{
      runId: run(12), question: '我是 1990 年 1 月 15 日早上 9 点在上海生的，他是 1992 年 8 月 3 日下午 2 点，帮我看看我们合不合。',
      build: async (t) => {
        t.turn();
        t.think('双方出生信息齐全；我的八字就是库里那张已存命盘，直接引用，不必重排。');
        const partner = { name: '他', gender: 'male', birthYear: 1992, birthMonth: 8, birthDay: 3, birthHour: 14, birthMinute: 0, timezone: 'Asia/Shanghai' };
        // 模型只传引用与另一方的出生信息，出生参数由服务端重建（pairing.server.ts）。
        const pairing = await t.call('bazi_hepan',
          { a: { name: '我', reference: `bazi_chart:${baziChartId}` }, b: partner },
          { ms: 900, details: ({ cacheId }) => t.resolve('bazi_hepan', { a: { ...birth, name: '我' }, b: partner }, cacheId) });
        const facts = pairing.output?.result ?? {};
        const [me, him] = facts.双方 ?? [];
        const lines = [
          me && him ? `- 日主：我 ${me.日主}，他 ${him.日主}；${facts.日主互见?.五行生克 ?? ''}` : '',
          ...(facts.日主互见?.说明 ?? []).map((line) => `- ${line}`),
          ...(facts.日柱之间?.length ? facts.日柱之间.map((row) => `- 日柱之间：${row.说明}`) : ['- 日柱之间：没有同时涉及双方日柱的合冲刑害。']),
          ...(facts.年柱之间?.length ? facts.年柱之间.map((row) => `- 年柱之间：${row.说明}`) : ['- 年柱之间：没有同时涉及双方年柱的合冲刑害。']),
          ...(facts.其余关系 ?? []).slice(0, 2).map((row) => `- 其余：${row.说明}`),
          ...(facts.五行互补 ?? []).map((line) => `- ${line}`),
        ].filter(Boolean);
        t.turn(2000);
        t.say(`两盘之间的事实如下：\n\n${lines.join('\n')}\n\n这些只说明两边先天的呼应；合不合还要看各自的大运流年与相处方式，需要的话我再按年份细看。`);
        return t.finish();
      },
    }],
  });

  return { conversations, artifacts, memories, records, attachments };
}
