import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolRegistration } from '@earendil-works/pi-durable';
import {
  AGENT_PROFILE_LIMITS, BUILTIN_AGENT_PROFILES, profileGrants, profileTokenLabel, profileTokenProblem,
  type AgentProfileView, type ProfileGrantContext,
} from '../lib/agent/profiles/config';
import { ProfileInputError, parseBuiltinProfileInput, parseProfileInput } from '../lib/agent/profiles/input.server';
import { createMemberKit, memberInstructions } from '../lib/agent/profiles/members.server';
import { AGENT_MEMBER_DENIED_TOOLS } from '../lib/agent/tool-catalog';
import type { SkillEntry } from '../lib/agent/skills/builtin.server';

/** Every tool a main agent may be offered, as a role's grants read it. */
const OFFERED = [
  'bazi', 'bazi_dayun', 'bazi_relations', 'ziwei', 'ziwei_palace', 'liuyao',
  'read_user_data', 'read_user_profile', 'search_knowledge', 'web_search', 'web_fetch', 'load_skill', 'read_skill_file',
  'read_user_memory', 'mcp__exa__web_search_exa', 'mcp__notes__find', 'mcp__mine_1a2b__lookup',
  ...AGENT_MEMBER_DENIED_TOOLS,
];
const MCP_SERVERS = new Map([['mcp__exa__web_search_exa', 'exa'], ['mcp__notes__find', 'notes']]);
const context = (systemTools: string[] = []): ProfileGrantContext => ({ systemTools: new Set(systemTools), mcpServer: tool => MCP_SERVERS.get(tool) });
const role = (name: string) => BUILTIN_AGENT_PROFILES.find(profile => profile.name === name)!;
const custom = (overrides: Partial<AgentProfileView> = {}): AgentProfileView => ({
  ...role('researcher'), name: 'archivist', builtin: false, displayName: '档案员', description: '整理资料', instructions: '',
  tools: { inherit: false, allow: [], deny: [] }, ...overrides,
});
const registrations = (names: readonly string[]) => names.map(name => ({ name }) as unknown as ToolRegistration);

test('no role grants a tool only the main agent may use, whatever it inherits or names', () => {
  const everything = profileGrants({ inherit: true, allow: [...AGENT_MEMBER_DENIED_TOOLS], deny: [] }, OFFERED, context());
  assert.deepEqual(everything.filter(tool => AGENT_MEMBER_DENIED_TOOLS.has(tool)), []);
  assert.ok(everything.includes('mcp__mine_1a2b__lookup'), 'inheriting keeps the user\'s own connector tools the task offers');
  assert.ok(['ask_user', 'parallel_analysis', 'background_agent', 'remember_user_fact', 'inspect_chart', 'tool_search', 'codemode']
    .every(tool => AGENT_MEMBER_DENIED_TOOLS.has(tool)));
});

test('a role\'s families, single tools and denials pick the tools it keeps, in the task\'s order', () => {
  const grants = (tools: AgentProfileView['tools'], systemTools?: string[]) => profileGrants(tools, OFFERED, context(systemTools));
  assert.deepEqual(grants({ inherit: true, allow: [], deny: ['web', 'mcp:exa', 'data', 'read_user_memory'] }), [
    'bazi', 'bazi_dayun', 'bazi_relations', 'ziwei', 'ziwei_palace', 'liuyao', 'search_knowledge',
    'load_skill', 'read_skill_file', 'mcp__notes__find', 'mcp__mine_1a2b__lookup',
  ]);
  assert.deepEqual(grants({ inherit: false, allow: ['core:bazi', 'knowledge'], deny: ['bazi_relations'] }), ['bazi', 'bazi_dayun', 'search_knowledge']);
  assert.deepEqual(grants({ inherit: false, allow: ['core'], deny: ['core:ziwei'] }), ['bazi', 'bazi_dayun', 'bazi_relations', 'liuyao']);
  assert.deepEqual(grants({ inherit: false, allow: ['system'], deny: [] }, ['ziwei', 'ziwei_palace']), ['ziwei', 'ziwei_palace']);
  assert.deepEqual(grants({ inherit: false, allow: ['system'], deny: [] }), [], 'without a system the system family is empty');
  assert.deepEqual(grants({ inherit: false, allow: ['mcp:exa', 'skills', 'web_fetch'], deny: [] }), ['web_fetch', 'load_skill', 'read_skill_file', 'mcp__exa__web_search_exa']);
  assert.deepEqual(grants({ inherit: false, allow: ['mcp:mine'], deny: [] }), [], 'a user\'s connector belongs to no platform service');
  assert.deepEqual(grants({ inherit: false, allow: [], deny: [] }), []);
});

test('tokens are checked as the admin page saves them, and read back as labels', () => {
  assert.equal(profileTokenProblem('web', 'allow'), null);
  assert.equal(profileTokenProblem('core:bazi', 'allow'), null);
  assert.equal(profileTokenProblem('mcp:exa', 'deny'), null);
  assert.equal(profileTokenProblem('bazi_relations', 'allow'), null);
  assert.match(profileTokenProblem('ask_user', 'allow') ?? '', /只有主任务能用/);
  assert.equal(profileTokenProblem('ask_user', 'deny'), null, 'denying a tool no member gets is harmless');
  assert.match(profileTokenProblem('mcp:Exa-Search', 'allow') ?? '', /MCP 服务名/);
  assert.match(profileTokenProblem('rm -rf', 'allow') ?? '', /不是工具名/);
  assert.deepEqual(['system', 'core:ziwei', 'web', 'mcp:exa', 'bazi'].map(profileTokenLabel), ['所给体系', '紫微命盘', '联网', 'MCP：exa', 'bazi']);
});

test('a custom role is parsed in full when added and by what changed when edited', () => {
  const fields = parseProfileInput({
    name: 'archivist', displayName: ' 档案员 ', description: '整理资料', instructions: '先列来源',
    tools: { inherit: false, allow: ['web', 'web', ' knowledge '], deny: ['mcp:exa'] }, skills: ['case-review', 'case-review'],
    model: ' gpt-x ', reasoningEffort: 'high', modes: ['background', 'parallel'], requiredTier: 'plus', enabled: false, sortOrder: 5,
  }, false);
  assert.deepEqual(fields, {
    name: 'archivist', displayName: '档案员', description: '整理资料', instructions: '先列来源',
    tools: { inherit: false, allow: ['web', 'knowledge'], deny: ['mcp:exa'] }, skills: ['case-review'],
    model: 'gpt-x', reasoningEffort: 'high', modes: ['parallel', 'background'], requiredTier: 'plus', enabled: false, sortOrder: 5,
  });
  assert.deepEqual(parseProfileInput({ model: null, enabled: true }, true), { model: null, enabled: true });

  const refused = (body: unknown, partial: boolean, pattern: RegExp) => assert.throws(() => parseProfileInput(body, partial), (error: unknown) =>
    error instanceof ProfileInputError && pattern.test(error.message));
  refused({ name: 'researcher', displayName: '研究员' }, false, /内置角色/);
  refused({ name: 'Bad_Name', displayName: 'x' }, false, /标识/);
  refused({ name: 'archivist' }, false, /名称/);
  refused({ displayName: '一二三四五六七八九十一二三' }, true, /最多 12/);
  refused({ tools: { allow: ['web'] } }, true, /工具设置/);
  refused({ tools: { inherit: true, allow: ['parallel_analysis'] } }, true, /只有主任务能用/);
  refused({ tools: { inherit: true, deny: Array.from({ length: AGENT_PROFILE_LIMITS.tokens + 1 }, (_, index) => `tool_${index}`) } }, true, /最多 64/);
  refused({ skills: ['a', 'b', 'c', 'd', 'e'] }, true, /最多 4/);
  refused({ skills: ['Not A Skill'] }, true, /技能名/);
  refused({ modes: [] }, true, /至少选择一种/);
  refused({ modes: ['solo'] }, true, /用途/);
  refused({ reasoningEffort: 'extreme' }, true, /推理档位/);
  refused({ sortOrder: 1.5 }, true, /整数/);
  refused({ requiredTier: 'vip' }, true, /会员等级/);
  refused([], true, /请求格式/);

  assert.deepEqual(parseBuiltinProfileInput({ enabled: false }), { enabled: false });
  assert.throws(() => parseBuiltinProfileInput({ enabled: false, instructions: '改写' }), /只能启用或停用/);
});

test('a member\'s instructions follow what its tools let it do', () => {
  const specialist = memberInstructions({ identity: '你是专项分析助手。', profile: { instructions: '' }, system: 'ziwei', tools: ['ziwei', 'load_skill'] });
  assert.match(specialist, /^你是专项分析助手。只处理所给任务/);
  assert.match(specialist, /先用 load_skill 加载 ziwei（紫微斗数）方法/);
  assert.match(specialist, /所排命盘的引用（artifact:…）/);
  assert.doesNotMatch(specialist, /\[编号\]/);

  const researcher = memberInstructions({ identity: '你是研究员。', profile: role('researcher'), tools: ['web_search', 'search_knowledge'] });
  assert.match(researcher, /不要写 \[编号\]/, 'a member\'s sources are not numbered, so it names them');
  assert.match(researcher, /你负责查找与核对资料/);
  assert.doesNotMatch(researcher, /Core 工具|artifact:/);

  const reasoner = memberInstructions({ identity: '你是成员。', profile: { instructions: '  只做推理。  ' }, tools: [] });
  assert.match(reasoner, /只做推理。缺少必要资料时/);
  assert.match(reasoner, /不能保存记忆、写入档案或派生子任务/);
});

test('the main agent chooses among the roles that work in a mode, each with what it can use in this task', () => {
  const backgroundOnly = custom({ modes: ['background'], tools: { inherit: false, allow: ['data'], deny: [] } });
  const kit = createMemberKit({ roles: [...BUILTIN_AGENT_PROFILES, backgroundOnly], tools: registrations(OFFERED), mcpServers: MCP_SERVERS });
  assert.deepEqual(kit.roles('parallel').map(profile => profile.name), ['specialist', 'researcher', 'verifier']);
  assert.deepEqual(kit.roles('background').map(profile => profile.name), ['specialist', 'researcher', 'verifier', 'archivist']);
  assert.equal(kit.role(undefined, 'parallel').name, 'specialist');
  assert.throws(() => kit.role('archivist', 'parallel'), /没有可用的角色「archivist」；可用：specialist、researcher、verifier/);

  const described = kit.describe('background');
  assert.match(described, /specialist（体系专家：[^）]*；可用所给体系的排盘与计算）/);
  assert.match(described, /researcher（研究员：[^）]*；可用联网、知识库、技能）/);
  assert.match(described, /verifier（复核员：[^）]*；可用排盘与计算、用户资料、联网、知识库、技能）/);
  assert.match(described, /archivist（档案员：整理资料；可用用户资料）/);
  const silent = createMemberKit({ roles: [custom()], tools: registrations(OFFERED) });
  assert.match(silent.describe('parallel'), /archivist（档案员：整理资料；不调用工具，只做推理）/);
});

test('a member is set up with the tools, instructions and model its role gives it', async (t: TestContext) => {
  const store = require('../lib/agent/skills/store.server') as typeof import('../lib/agent/skills/store.server');
  const read = t.mock.method(store, 'readSkillContent', async (id: string) => id === 'skill-big' ? `---\nname: big\ndescription: 大\n---\n${'长'.repeat(30_000)}` : `---\nname: x\ndescription: x\n---\n按清单复盘。`);
  const skill = (overrides: Partial<SkillEntry>): SkillEntry => ({
    id: 'skill-1', owner_id: null, name: 'case-review', description: '复盘', version: 1, required_tier: 'free', is_enabled: true,
    disable_model_invocation: false, sort_order: 0, created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z',
    bytes: 40, files: [{ path: 'refs/terms.md', bytes: 9 }], source: 'platform', ...overrides,
  });
  const archivist = custom({ tools: { inherit: false, allow: ['web', 'mcp:notes', 'core:bazi'], deny: ['bazi_relations'] }, skills: ['case-review', 'own-skill', 'big', 'missing'] });
  const model = { config: { id: 'model-b' } as never, thinkingLevel: 'high' as const };
  const kit = createMemberKit({
    roles: [...BUILTIN_AGENT_PROFILES, archivist], tools: registrations(OFFERED), mcpServers: MCP_SERVERS, models: new Map([['archivist', model]]),
    skills: [skill({}), skill({ id: 'skill-own', owner_id: 'user-1', name: 'own-skill' }), skill({ id: 'skill-big', name: 'big', files: [] })],
  });

  await assert.rejects(kit.setup({ profile: role('specialist'), identity: '你是成员。' }), /需要填写它专攻的方法 system/);
  const specialist = await kit.setup({ profile: role('specialist'), system: 'ziwei', identity: '你是紫微专项分析助手。' });
  assert.deepEqual(specialist.tools.map(tool => tool.name), ['ziwei', 'ziwei_palace', 'load_skill'], 'Core tools bring the methods along');
  assert.equal(specialist.system, 'ziwei');
  assert.equal(specialist.model, undefined);
  await assert.rejects(kit.setup({ profile: role('specialist'), system: 'tarot', identity: '你是成员。' }), /该体系当前不可用/);

  const researcher = await kit.setup({ profile: role('researcher'), identity: '你是研究员。' });
  assert.deepEqual(researcher.tools.map(tool => tool.name), ['search_knowledge', 'web_search', 'web_fetch', 'load_skill', 'read_skill_file']);

  const member = await kit.setup({ profile: archivist, identity: '你是档案员。' });
  assert.deepEqual(member.tools.map(tool => tool.name), ['bazi', 'bazi_dayun', 'web_search', 'web_fetch', 'load_skill', 'mcp__notes__find']);
  assert.equal(member.model, model);
  assert.match(member.instructions, /这个角色预先载入了以下技能/);
  assert.match(member.instructions, /<skill name="case-review">\n按清单复盘。\n<\/skill>/, 'without read_skill_file the block names no files');
  assert.doesNotMatch(member.instructions, /own-skill|name="big"/, 'only platform skills are preloaded, within the budget');
  assert.deepEqual(read.mock.calls.map(call => call.arguments[0]), ['skill-1', 'skill-big']);

  const denied = custom({ tools: { inherit: false, allow: ['core:bazi'], deny: ['load_skill'] } });
  assert.deepEqual((await createMemberKit({ roles: [denied], tools: registrations(OFFERED) }).setup({ profile: denied, identity: '你是成员。' })).tools.map(tool => tool.name),
    ['bazi', 'bazi_dayun', 'bazi_relations'], 'a role may deny the methods its Core tools would bring');
});
