import test, { beforeEach, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentTools, type ToolResultMessage } from '@earendil-works/pi-ai';
import { MockLanguageModelV3 } from 'ai/test';
import { DEFAULT_AGENT_EXTENSIONS_POLICY, type AgentExtensionsPolicy } from '../lib/agent/extensions/config';
import {
  SKILL_CONTENT_MAX_BYTES, SKILL_FILE_MAX_BYTES, SKILL_FILES_MAX, formatSkillBytes, parseSkillCommand, skillPathProblem,
} from '../lib/agent/skills/config';
import { SkillInputError, parseSkillDocument, parseSkillInput, skillBody } from '../lib/agent/skills/input.server';
import {
  SKILL_FILE_PAGE, SkillUnavailableError, availableSkills, expandSkillMessages, joinSkillTurn, loadSkill, openAgentSkills,
  readSkillFilePage, renderSkillDirectory, skillBlock, skillCommandBlock, skillCommands,
} from '../lib/agent/skills/catalog.server';
import type { SkillRow } from '../lib/agent/skills/store.server';
import type { SkillEntry } from '../lib/agent/skills/builtin.server';
import type { AgentRunRow } from '../lib/agent/store.server';
import type { AgentPart } from '../lib/agent/types';
import { AGENT_SKILL_TOOLS } from '../lib/agent/tool-catalog';
import { executeAgentRun } from '../lib/agent/runtime.server';
import { config, MemoryStore, row, scripted } from './helpers/agent-runtime-fixture';

const document = (fields: string, body = '# 做法\n\n先读命盘，再列要点。') => `---\n${fields}\n---\n${body}`;
const CASE_REVIEW = document('name: case-review\ndescription: 复盘一个命理案例');

const skill = (overrides: Partial<SkillRow> = {}): SkillEntry => ({
  id: `id-${overrides.name ?? 'case-review'}`, owner_id: null, name: 'case-review', description: '复盘一个命理案例', version: 1,
  is_enabled: true, disable_model_invocation: false, sort_order: 0,
  created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z', bytes: 64, files: [], source: 'platform', ...overrides,
});

const modules = () => ({
  store: require('../lib/agent/skills/store.server') as typeof import('../lib/agent/skills/store.server'),
  settings: require('../lib/app-settings') as typeof import('../lib/app-settings'),
  sdk: require('../lib/ai/providers/ai-sdk-provider') as typeof import('../lib/ai/providers/ai-sdk-provider'),
});

/** Skills as the database would hold them; the scope and the policy as an administrator left them. */
function useSkills(t: TestContext, options: {
  platform?: SkillRow[]; own?: SkillRow[]; policy?: AgentExtensionsPolicy | Error; scope?: boolean;
  contents?: Record<string, string>; files?: Record<string, string>;
} = {}) {
  const { store, settings } = modules();
  t.mock.method(store, 'platformSkills', async () => options.platform ?? []);
  const own = t.mock.method(store, 'userSkills', async () => options.own ?? []);
  const contents = t.mock.method(store, 'readSkillContent', async (id: string) => options.contents?.[id]);
  t.mock.method(store, 'readSkillFile', async (id: string, path: string) => options.files?.[`${id}/${path}`]);
  t.mock.method(settings, 'getAgentExtensionsPolicy', async () => {
    if (options.policy instanceof Error) throw options.policy;
    return options.policy ?? DEFAULT_AGENT_EXTENSIONS_POLICY;
  });
  t.mock.method(settings, 'readFeatureModuleStateFresh', async () => ({ status: options.scope === false ? 'disabled' as const : 'enabled' as const }));
  return { own, contents };
}

const unavailable = (pattern: RegExp) => (error: unknown) => error instanceof SkillUnavailableError && pattern.test(error.message);
const invalid = (pattern: RegExp) => (error: unknown) => error instanceof SkillInputError && pattern.test(error.message);

beforeEach((t) => {
  assert.ok('mock' in t);
  const { sdk } = modules();
  t.mock.method(sdk, 'isModelAvailable', () => true);
  t.mock.method(sdk, 'createModelFromConfig', () => new MockLanguageModelV3());
});

test('SKILL.md is read as pi reads it: YAML frontmatter with the name and description, then the instructions', () => {
  const parsed = parseSkillDocument('\uFEFF---\r\nname: case-review\r\ndescription: 复盘一个命理案例\r\ndisable-model-invocation: true\r\n---\r\n# 做法\r\n\r\n先读命盘。\r\n');
  assert.deepEqual([parsed.name, parsed.description, parsed.manualOnly], ['case-review', '复盘一个命理案例', true]);
  assert.ok(!parsed.content.startsWith('\uFEFF') && !parsed.content.includes('\r'), 'stored without the byte order mark, with \\n line ends');
  assert.equal(skillBody(parsed.content), '# 做法\n\n先读命盘。');
  assert.equal(parseSkillDocument(document('name: a\ndescription: b\ndisable-model-invocation: "true"')).manualOnly, false, 'only YAML true hides a skill');
  assert.equal(parseSkillDocument(document('name: a\ndescription: "  有空格的说明  "')).description, '有空格的说明');

  const rejected: Array<[string, RegExp]> = [
    ['# 只有正文', /frontmatter/],
    ['---\nname: a\ndescription: b\n', /frontmatter/],
    [document('name: [a'), /不是有效的 YAML/],
    [document('- a\n- b'), /键值/],
    [document('description: b'), /缺少 name/],
    [document('name: a'), /缺少 description/],
    [document('name: a\ndescription: "   "'), /缺少 description/],
    [document(`name: a\ndescription: ${'述'.repeat(1025)}`), /1024/],
    [document('name: a\ndescription: b', ''), /没有正文/],
    [document('name: a\ndescription: b', 'x\u0000y'), /不是文本/],
    [document('name: a\ndescription: b', 'x'.repeat(SKILL_CONTENT_MAX_BYTES)), /128 KB/],
  ];
  for (const name of ['Case', 'case--review', '-case', 'case-', 'case_review', 'cäse', 'a'.repeat(65)])
    rejected.push([document(`name: ${name}\ndescription: b`), /无效/]);
  for (const [raw, pattern] of rejected) assert.throws(() => parseSkillDocument(raw), invalid(pattern), raw.slice(0, 80));
});

test('a skill\'s files stay inside the skill, as text, within the limits', () => {
  for (const path of ['../secret', 'a/../b', '/etc/passwd', 'a//b', './a', 'a/.', 'a/', 'a\\b', 'a\u0000b', 'a\nb', 'a\u0085b', 'a\u2028b', 'SKILL.md', '', 'x'.repeat(257)])
    assert.ok(skillPathProblem(path), JSON.stringify(path));
  for (const path of ['references/terms.md', 'scripts/run.py', '.hidden', 'a b/c.md', '说明.md', 'docs/SKILL.md'])
    assert.equal(skillPathProblem(path), null, path);

  const base = { content: CASE_REVIEW };
  const rejected: Array<[unknown, RegExp]> = [
    [{}, /请填写 SKILL\.md/],
    [{ ...base, files: [{ path: 'a.md', content: 'x' }, { path: 'a.md', content: 'y' }] }, /重复/],
    [{ ...base, files: [{ path: '../a.md', content: 'x' }] }, /相对路径/],
    [{ ...base, files: Array.from({ length: SKILL_FILES_MAX + 1 }, (_, index) => ({ path: `f${index}.md`, content: '' })) }, /最多 64 个/],
    [{ ...base, files: [{ path: 'big.md', content: 'x'.repeat(SKILL_FILE_MAX_BYTES + 1) }] }, /超过 1 MB/],
    [{ ...base, files: [{ path: 'bin.dat', content: 'a\u0000b' }] }, /不是文本/],
    [{ ...base, files: [{ path: 'n.md', content: 3 }] }, /不是文本/],
    [{ ...base, sortOrder: 1.5 }, /排序/],
    [{ ...base, sortOrder: 20_000 }, /排序/],
    [{ ...base, enabled: 'yes' }, /启用状态/],
  ];
  for (const [value, pattern] of rejected) assert.throws(() => parseSkillInput(value, false), invalid(pattern), JSON.stringify(value).slice(0, 80));
  assert.equal('requiredTier' in parseSkillInput({ ...base, requiredTier: 'pro' }, false), false, 'no tier is read any more');
  // An edit sends only what changed; a listed file without content keeps the stored one.
  assert.deepEqual(parseSkillInput({ enabled: false, files: [{ path: 'refs/a.md' }] }, true), { enabled: false, files: [{ path: 'refs/a.md' }] });
  assert.deepEqual([formatSkillBytes(900), formatSkillBytes(1536), formatSkillBytes(20 * 1024), formatSkillBytes(3 * 1024 * 1024)], ['900 B', '1.5 KB', '20 KB', '3.0 MB']);
});

test('/skill:名称 is a command only at the start of a message', () => {
  assert.deepEqual(parseSkillCommand('/skill:case-review 看看这张盘'), { name: 'case-review', args: '看看这张盘' });
  assert.deepEqual(parseSkillCommand('/skill:case-review'), { name: 'case-review', args: '' });
  assert.deepEqual(parseSkillCommand('/skill:case-review\n第一行\n第二行\n'), { name: 'case-review', args: '第一行\n第二行' });
  assert.deepEqual(parseSkillCommand('/skill:'), { name: '', args: '' });
  for (const text of [' /skill:case-review', '请用 /skill:case-review', '/compact', '/skills']) assert.equal(parseSkillCommand(text), null, text);
});

test('a member gets the enabled platform skills and as many of their own as the policy allows', async (t) => {
  const platform = [
    skill({ name: 'case-review' }), skill({ name: 'deep-dive' }), skill({ name: 'retired', is_enabled: false }),
  ];
  const own = [
    skill({ name: 'mine-1', owner_id: 'u' }), skill({ name: 'retired', owner_id: 'u' }), skill({ name: 'mine-2', owner_id: 'u', is_enabled: false }),
    skill({ name: 'mine-3', owner_id: 'u' }), skill({ name: 'mine-4', owner_id: 'u' }),
  ];
  // 方法是内置技能，始终可用；这里只看数据库里的技能。
  const names = async () => (await availableSkills('u')).filter((row) => row.source !== 'builtin').map((row) => row.name);
  const limited: AgentExtensionsPolicy = { ...DEFAULT_AGENT_EXTENSIONS_POLICY, skills: { enabled: true, limit: 2 } };
  await t.test('within the policy', async (t) => {
    useSkills(t, { platform, own, policy: limited });
    assert.deepEqual(await names(), ['case-review', 'deep-dive', 'mine-1', 'mine-3'],
      'a disabled skill and a user\'s skill named like a platform one stay out; the first two of the rest count');
  });
  await t.test('closed by the administrator', async (t) => {
    const { own: read } = useSkills(t, { platform, own, policy: { ...limited, skills: { ...limited.skills, enabled: false } } });
    assert.deepEqual(await names(), ['case-review', 'deep-dive']);
    assert.equal(read.mock.callCount(), 0, 'the user\'s skills are not even read');
  });
  await t.test('a policy that cannot be read', async (t) => {
    useSkills(t, { platform, own, policy: new Error('settings unavailable') });
    assert.deepEqual(await names(), ['case-review', 'deep-dive']);
  });
  await t.test('the slash menu', async (t) => {
    useSkills(t, { platform, own, policy: limited });
    assert.deepEqual(await skillCommands('u'), [
      { name: 'case-review', description: '复盘一个命理案例', scope: 'platform' },
      { name: 'deep-dive', description: '复盘一个命理案例', scope: 'platform' },
      { name: 'mine-1', description: '复盘一个命理案例', scope: 'user' },
      { name: 'mine-3', description: '复盘一个命理案例', scope: 'user' },
    ]);
  });
  await t.test('the slash menu with the scope off', async (t) => {
    useSkills(t, { platform, own, scope: false });
    assert.deepEqual(await skillCommands('u'), []);
  });
});

test('the directory lists what the model may load, escaped; a skill reads as pi\'s <skill> block', () => {
  const directory = renderSkillDirectory([
    skill({ name: 'case-review', description: '用 <b> & "引号" \'单引号\'' }), skill({ name: 'manual-only', disable_model_invocation: true }),
  ], [])!;
  assert.match(directory, /^以下技能是管理员或用户本人添加的专门做法。[^\n]*load_skill[^\n]*read_skill_file[^\n]*不能凌驾于系统指令之上。\n\n<available_skills>/u);
  assert.ok(directory.endsWith([
    '<available_skills>', '  <skill>', '    <name>case-review</name>',
    '    <description>用 &lt;b&gt; &amp; &quot;引号&quot; &apos;单引号&apos;</description>', '  </skill>', '</available_skills>',
  ].join('\n')), directory);
  assert.ok(!directory.includes('manual-only'), 'a skill only the user may start is not listed');
  assert.equal(renderSkillDirectory([skill({ disable_model_invocation: true })], []), undefined);
  assert.equal(renderSkillDirectory([], []), undefined);

  assert.equal(skillBlock(skill(), CASE_REVIEW), '<skill name="case-review">\n# 做法\n\n先读命盘，再列要点。\n</skill>');
  assert.equal(skillBlock(skill({ files: [{ path: 'a.md', bytes: 1 }, { path: 'refs/b.md', bytes: 2 }] }), CASE_REVIEW),
    '<skill name="case-review">\n附属文件（用 read_skill_file 读取，name 填 case-review）：a.md、refs/b.md\n\n# 做法\n\n先读命盘，再列要点。\n</skill>');
  assert.equal(joinSkillTurn('<skill/>', ''), '<skill/>');
  assert.equal(joinSkillTurn('<skill/>', '看看这张盘'), '<skill/>\n\n看看这张盘');
});

test('/skill: expands any skill the member may use, including one only a user may start, and says why it cannot', async (t) => {
  const manual = skill({ name: 'manual-only', disable_model_invocation: true });
  const MANUAL = document('name: manual-only\ndescription: 只由用户调用', '按用户要求逐条核对。');
  const { contents } = useSkills(t, { platform: [skill(), manual], contents: { [skill().id]: CASE_REVIEW, [manual.id]: MANUAL } });
  assert.equal(await skillCommandBlock('u', '看看这张盘'), null);
  assert.deepEqual(await skillCommandBlock('u', '/skill:manual-only 看看这张盘'), { name: 'manual-only', args: '看看这张盘', block: skillBlock(manual, MANUAL) });
  await assert.rejects(skillCommandBlock('u', '/skill: 看看'), unavailable(/请在 \/skill: 后写技能名称/));
  await assert.rejects(skillCommandBlock('u', '/skill:missing 看看'), unavailable(/没有可用的技能「missing」/));

  contents.mock.resetCalls();
  const messages = [
    { role: 'user', content: '/skill:case-review 第一次' },
    { role: 'assistant', content: '/skill:case-review 助手的文字不展开' },
    { role: 'user', content: '/skill:case-review' },
    { role: 'user', content: '/skill:gone 还在吗' },
    { role: 'user', content: '普通消息' },
  ];
  const expanded = await expandSkillMessages(messages, 'u');
  const block = skillBlock(skill(), CASE_REVIEW);
  assert.deepEqual(expanded.map((message) => message.content), [
    joinSkillTurn(block, '第一次'), messages[1].content, block, '/skill:gone 还在吗', '普通消息',
  ], 'a skill that is gone leaves the message as written');
  assert.equal(contents.mock.callCount(), 1, 'each skill is read once');
  contents.mock.resetCalls();
  assert.deepEqual(await expandSkillMessages(messages.slice(4), 'u'), messages.slice(4));
  assert.equal(contents.mock.callCount(), 0, 'a history without commands reads nothing');
});

test('/skill: stops when the administrator turns the skills scope off', async (t) => {
  useSkills(t, { platform: [skill()], contents: { [skill().id]: CASE_REVIEW }, scope: false });
  await assert.rejects(skillCommandBlock('u', '/skill:case-review'), unavailable(/已被管理员关闭/));
  assert.deepEqual(await expandSkillMessages([{ role: 'user', content: '/skill:case-review' }], 'u'), [{ role: 'user', content: '/skill:case-review' }]);
  await assert.rejects(loadSkill('u', 'case-review'), unavailable(/已被管理员关闭/));
  // 方法是产品本身：技能开关关掉后，内置方法仍可加载，数据库里的技能不再出现。
  const session = await openAgentSkills('u');
  assert.ok(session.skills.every((row) => row.source === 'builtin') && session.skills.length > 0);
  assert.doesNotMatch(session.sectionText([AGENT_SKILL_TOOLS.load]), /case-review/u);
  const bazi = await loadSkill('u', 'bazi');
  assert.equal(bazi.details.scope, 'builtin');
  assert.ok(bazi.details.method?.instructions?.includes('子平八字'));
});

test('load_skill returns the block and refuses a skill only the user may start; read_skill_file reads a file page by page', async (t) => {
  const long = '甲'.repeat(SKILL_FILE_PAGE) + '乙'.repeat(10);
  const emoji = 'a'.repeat(SKILL_FILE_PAGE - 1) + '😀b';
  const reviewed = skill({ version: 3, files: [{ path: 'emoji.md', bytes: 1 }, { path: 'long.md', bytes: 1 }, { path: 'refs/terms.md', bytes: 9 }] });
  useSkills(t, {
    platform: [reviewed, skill({ name: 'manual-only', disable_model_invocation: true })],
    own: [skill({ name: 'mine', owner_id: 'u' })],
    contents: { [reviewed.id]: CASE_REVIEW, 'id-mine': document('name: mine\ndescription: 我的做法') },
    files: { [`${reviewed.id}/refs/terms.md`]: '术语表', [`${reviewed.id}/long.md`]: long, [`${reviewed.id}/emoji.md`]: emoji },
  });
  const loaded = await loadSkill('u', 'case-review');
  assert.equal(loaded.text, skillBlock(reviewed, CASE_REVIEW));
  assert.deepEqual(loaded.details, { name: 'case-review', version: 3, scope: 'platform', files: reviewed.files });
  assert.equal((await loadSkill('u', 'mine')).details.scope, 'user');
  await assert.rejects(loadSkill('u', 'manual-only'), unavailable(/只能由用户在输入框用 \/skill:manual-only 调用/));
  await assert.rejects(loadSkill('u', 'missing'), unavailable(/没有可用的技能「missing」/));

  const terms = await readSkillFilePage('u', 'case-review', 'refs/terms.md');
  assert.equal(terms.text, '技能「case-review」的文件 refs/terms.md（第 1–3 字，共 3 字）\n\n术语表');
  const first = await readSkillFilePage('u', 'case-review', 'long.md');
  assert.deepEqual(first.details, { name: 'case-review', path: 'long.md', offset: 0, total: SKILL_FILE_PAGE + 10, nextOffset: SKILL_FILE_PAGE });
  assert.match(first.text, /继续读取传 offset=8000）/u);
  const second = await readSkillFilePage('u', 'case-review', 'long.md', SKILL_FILE_PAGE);
  assert.deepEqual([second.details.nextOffset, second.text.endsWith(`\n\n${'乙'.repeat(10)}`)], [null, true]);
  const split = await readSkillFilePage('u', 'case-review', 'emoji.md');
  assert.equal(split.details.nextOffset, SKILL_FILE_PAGE - 1, 'a page does not cut a character in half');
  await assert.rejects(readSkillFilePage('u', 'case-review', 'nope.md'), unavailable(/可读的文件：emoji\.md、long\.md、refs\/terms\.md/));
  await assert.rejects(readSkillFilePage('u', 'mine', 'a.md'), unavailable(/没有附属文件/));
});

test('the skills section renders only for an agent that can load a skill', async (t) => {
  useSkills(t, { platform: [skill()] });
  const session = await openAgentSkills('u');
  const render = (tools: string[]) => session.section.render({ agent: { tools: tools.map((name) => ({ name })) } } as never, undefined as never);
  assert.equal(session.section.key, 'taibu_skills');
  assert.equal(render(['bazi']), undefined, 'a member of a parallel analysis has no load_skill');
  assert.equal(render([AGENT_SKILL_TOOLS.load]), renderSkillDirectory([skill()], [AGENT_SKILL_TOOLS.load]));
  assert.equal(session.sectionText([AGENT_SKILL_TOOLS.load]), `<taibu_skills>\n${renderSkillDirectory([skill()], [AGENT_SKILL_TOOLS.load])}\n</taibu_skills>`);
});

type ToolPart = Extract<AgentPart, { type: 'tool' }>;
const finished = (store: MemoryStore) => store.writes.filter(write => write.name === 'agent_finish_run').at(-1)!;
const toolParts = (store: MemoryStore) => ((finished(store).args.p_message as AgentRunRow['public_message']).agent?.parts ?? [])
  .filter((part): part is ToolPart => part.type === 'tool');
const results = (store: MemoryStore) => store.nativeEntries().flatMap(entry => entry.model ?? [])
  .filter((message): message is ToolResultMessage => message.role === 'toolResult');
const text = (message: ToolResultMessage) => message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');

test('a task lists its skills in the system prompt, and a loaded skill reaches the model and is counted', async (t) => {
  const reviewed = skill({ version: 2, files: [{ path: 'refs/terms.md', bytes: 9 }] });
  useSkills(t, { platform: [reviewed], contents: { [reviewed.id]: CASE_REVIEW }, files: { [`${reviewed.id}/refs/terms.md`]: '术语表' } });
  const store = new MemoryStore(), run = row();
  const skills = await openAgentSkills(run.user_id);
  const offered: string[][] = [], prompts: string[] = [];
  await executeAgentRun(store, run, undefined, { config, skills, streamFn: scripted(index => {
    if (index === 0) return [{ type: 'toolCall', id: 'skill', name: AGENT_SKILL_TOOLS.load, arguments: { name: 'case-review' } }];
    if (index === 1) return [{ type: 'toolCall', id: 'file', name: AGENT_SKILL_TOOLS.read, arguments: { name: 'case-review', path: 'refs/terms.md' } }];
    return [{ type: 'text', text: '按技能完成。' }];
  }, messages => {
    offered.push(getCurrentTools(messages).map(tool => tool.name));
    prompts.push(JSON.stringify(messages.filter(message => message.role === 'system')));
  }) });

  assert.equal(finished(store).args.p_status, 'completed');
  assert.ok(offered[0].includes(AGENT_SKILL_TOOLS.load) && offered[0].includes(AGENT_SKILL_TOOLS.read));
  assert.match(prompts[0], /<taibu_skills>[\s\S]*<name>case-review<\/name>[\s\S]*<\/taibu_skills>/u);
  assert.equal(text(results(store).find(message => message.toolName === AGENT_SKILL_TOOLS.load)!), skillBlock(reviewed, CASE_REVIEW));
  assert.match(text(results(store).find(message => message.toolName === AGENT_SKILL_TOOLS.read)!), /术语表$/u);
  const load = toolParts(store).find(part => part.name === AGENT_SKILL_TOOLS.load)!;
  assert.equal(load.title, '加载技能');
  assert.equal(typeof (load.output as { tokens?: unknown }).tokens, 'number', 'the context card reads the count from the card');
  const runtime = (finished(store).args.p_checkpoint as AgentRunRow['checkpoint']).runtime!;
  assert.equal(runtime.skills?.listed, 1);
  assert.ok((runtime.skills?.sectionTokens ?? 0) > 0);
});

test('a task without stored skills still lists the methods its tools reach', async (t) => {
  useSkills(t);
  const store = new MemoryStore(), run = row();
  const offered: string[][] = [], prompts: string[] = [];
  await executeAgentRun(store, run, undefined, { config, skills: await openAgentSkills(run.user_id), streamFn: scripted(() => [{ type: 'text', text: '完成。' }], messages => {
    offered.push(getCurrentTools(messages).map(tool => tool.name));
    prompts.push(JSON.stringify(messages.filter(message => message.role === 'system')));
  }) });
  // 方法是内置技能：没有管理员或用户的技能时，load_skill 与目录仍在，只是没有 available_skills。
  assert.ok(offered[0].includes(AGENT_SKILL_TOOLS.load));
  assert.match(prompts[0], /<taibu_skills>[\s\S]*方法是内置技能[\s\S]*<\/taibu_skills>/u);
  assert.doesNotMatch(prompts[0], /<available_skills>/u);
  const runtime = (finished(store).args.p_checkpoint as AgentRunRow['checkpoint']).runtime!;
  assert.equal(runtime.skills?.listed, 0, 'no stored skill is listed');
  assert.ok((runtime.skills?.sectionTokens ?? 0) > 0, 'the method directory is counted');
});

test('a /skill: message sent into a running task reaches the model expanded', async (t) => {
  useSkills(t, { platform: [skill()], contents: { [skill().id]: CASE_REVIEW } });
  const store = new MemoryStore(), run = row();
  store.pending = [{ sequence: 3, mode: 'follow_up', message: { id: 'follow', role: 'user', content: '/skill:case-review 再看事业', createdAt: '2026-10-27T01:00:00.000Z' } }];
  const contexts: string[] = [];
  await executeAgentRun(store, run, undefined, { config, skills: await openAgentSkills(run.user_id),
    streamFn: scripted(() => [{ type: 'text', text: '好的。' }], messages => { contexts.push(JSON.stringify(messages)); }) });
  assert.equal(finished(store).args.p_status, 'completed');
  assert.equal(contexts.length, 2, 'the follow-up starts a second answer');
  assert.ok(contexts[1].includes(JSON.stringify(joinSkillTurn(skillBlock(skill(), CASE_REVIEW), '再看事业')).slice(1, -1)), contexts[1]);
  assert.deepEqual(store.pending, []);
});
