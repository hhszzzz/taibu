import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METHOD_CONVENTIONS,
  METHOD_PRINCIPLES,
  findAnalysisMethod,
  getToolSystem,
  listAnalysisMethods,
  listMethodPrompts,
  listToolDefinitions,
  renderMethodGuide,
  renderMethodPersona,
  renderMethodPrompt,
} from '../dist/mcp/index.js';

const methods = listAnalysisMethods();

test('every Core tool belongs to exactly one system and every system has its default card', () => {
  const systems = [...new Set(methods.map(method => method.system))];
  const tools = systems.flatMap(system => methods.find(method => method.id === system)?.tools ?? assert.fail(`${system} has no default card`));
  assert.deepEqual([...tools].sort(), listToolDefinitions().map(tool => tool.name).sort());
  assert.equal(new Set(tools).size, tools.length, 'a tool is listed under two systems');
  for (const tool of listToolDefinitions()) assert.ok(methods.find(method => method.id === getToolSystem(tool.name))?.tools.includes(tool.name), tool.name);
  assert.equal(getToolSystem('bazi_relations'), 'bazi');
  assert.equal(getToolSystem('dream'), undefined);
});

test('cards come in system order, each default card first, with its system tools chart first', () => {
  assert.equal(new Set(methods.map(method => method.id)).size, methods.length);
  assert.deepEqual(methods.slice(0, 3).map(method => method.id), ['bazi', 'bazi-mangpai', 'ziwei']);
  assert.deepEqual(methods.find(method => method.id === 'bazi-mangpai')?.tools, methods.find(method => method.id === 'bazi')?.tools);
  assert.equal(methods.find(method => method.id === 'bazi')?.tools[0], 'bazi');
  assert.deepEqual(methods.find(method => method.id === 'dream')?.tools, []);
  for (const method of methods) {
    assert.match(method.version, /^\d+\.\d+\.\d+$/);
    assert.ok(method.title && method.description, method.id);
  }
});

test('a method is found by its id or by any of its system tools, nothing else', () => {
  assert.equal(findAnalysisMethod('bazi_pillars_resolve')?.id, 'bazi');
  assert.equal(findAnalysisMethod('ziwei_palace')?.id, 'ziwei');
  assert.equal(findAnalysisMethod('bazi-mangpai')?.system, 'bazi');
  for (const id of ['__proto__', 'constructor', 'toString', 'unknown', '']) assert.equal(findAnalysisMethod(id), undefined, id);
  assert.throws(() => renderMethodGuide('__proto__'), /未知的分析方法/);
  assert.throws(() => renderMethodPersona('unknown'), /未知的分析方法/);
});

test('the guide is the whole card; the persona leaves out the tool workflow', () => {
  for (const method of methods) {
    const guide = renderMethodGuide(method.id);
    assert.ok(guide.startsWith(`# ${method.title}\n\n## 角色\n\n`), method.id);
    assert.deepEqual([...guide.matchAll(/^## (.+)$/gm)].map(match => match[1]), ['角色', '断法', '工具流程', '输出要求'], method.id);
    const persona = renderMethodPersona(method.id);
    assert.ok(!persona.includes('## 工具流程') && persona.startsWith('你是'), method.id);
    // The persona reads a given chart: it names no tool to call.
    for (const tool of listToolDefinitions()) assert.ok(!persona.includes(`\`${tool.name}\``), `${method.id} persona names ${tool.name}`);
    assert.ok(guide.includes(persona.split('\n\n## 断法\n\n')[1].split('\n\n## 输出要求\n\n')[0]), method.id);
    // The brief persona is the same role and output rules without the method.
    assert.equal(renderMethodPersona(method.id, true), persona.replace(/\n\n## 断法\n\n[\s\S]*?(?=\n\n## 输出要求\n\n)/, ''), method.id);
  }
  assert.equal(renderMethodGuide('bazi_dayun'), renderMethodGuide('bazi'));
});

test('MCP prompts: one per card, an optional question, the card with the shared principles and conventions', () => {
  const prompts = listMethodPrompts();
  assert.deepEqual(prompts.map(prompt => prompt.name), methods.map(method => method.id));
  for (const prompt of prompts) {
    assert.deepEqual(prompt.arguments.map(({ name, required }) => ({ name, required })), [{ name: 'question', required: false }]);
    assert.ok(prompt.title && prompt.description);
  }
  const asked = renderMethodPrompt('bazi-mangpai', '  1990年5月20日8点男，看看事业  ');
  assert.equal(asked.description, methods.find(method => method.id === 'bazi-mangpai')?.description);
  assert.equal(asked.messages.length, 1);
  assert.equal(asked.messages[0].role, 'user');
  const text = asked.messages[0].content.text;
  for (const part of [renderMethodGuide('bazi-mangpai').trimEnd(), METHOD_PRINCIPLES, METHOD_CONVENTIONS, '我的问题：\n\n1990年5月20日8点男，看看事业']) assert.ok(text.includes(part));
  assert.ok(text.endsWith('看看事业'));
  for (const question of [undefined, '', '   ']) assert.match(renderMethodPrompt('dream', question).messages[0].content.text, /请先问我要问的事/);
  // Prompt names are card ids; a tool name or an inherited key is not a prompt.
  for (const name of ['bazi_dayun', '__proto__']) assert.throws(() => renderMethodPrompt(name), /未知的方法卡/);
});
