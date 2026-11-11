import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listToolDefinitions } from 'taibu-core/mcp';
import { ANALYSIS_METHODS, loadAnalysisMethod } from '../lib/agent/methods.server';
import { PARALLEL_SYSTEMS } from '../lib/agent/parallel.server';
import { memberInstructions, systemTitle } from '../lib/agent/profiles/members.server';

const LIMIT = '\n解读通则见系统提示的方法目录，对每个方法都适用。计算必须调用 Core 工具；方法包不授予工具或联网权限。';

test('every card loads its own text by id, and every Core tool loads its system default card', () => {
    assert.equal(ANALYSIS_METHODS.length, 15);
    for (const method of ANALYSIS_METHODS) {
        const loaded = loadAnalysisMethod(method.id);
        const source = readFileSync(`skills/taibu-divination/methods/${method.id}.md`, 'utf8');
        // The card body, then the package's limit; the shared reading principles are in the directory, once.
        const body = source.slice(source.indexOf('---\n\n') + 5);
        assert.equal(loaded.instructions, body + LIMIT, method.id);
        assert.deepEqual({ id: loaded.id, version: loaded.version, whenToUse: loaded.whenToUse }, { id: method.id, version: method.version, whenToUse: method.description });
    }
    for (const tool of listToolDefinitions()) {
        const loaded = loadAnalysisMethod(tool.name);
        assert.ok(loaded.tools.includes(tool.name) && loaded.id === loaded.system, tool.name);
    }
    assert.equal(loadAnalysisMethod('bazi-mangpai').title, '盲派八字');
    assert.deepEqual(loadAnalysisMethod('bazi-mangpai').tools, loadAnalysisMethod('bazi').tools);
    assert.deepEqual(loadAnalysisMethod('dream').tools, []);
    assert.equal(loadAnalysisMethod('bazi', '2.4.0').version, '2.4.0');
    assert.throws(() => loadAnalysisMethod('__proto__'), /分析方法或版本不存在/);
    assert.throws(() => loadAnalysisMethod('bazi', '1.0.0'), /分析方法或版本不存在/);
});

test('collaboration members work with a chart-reading card, a school as well as a system', () => {
    assert.ok(PARALLEL_SYSTEMS.includes('bazi') && PARALLEL_SYSTEMS.includes('bazi-mangpai'));
    assert.ok(!PARALLEL_SYSTEMS.includes('dream'), 'a card that reads no chart has no member tools');
    for (const technique of ['birth-hour', 'past-events']) assert.ok(!PARALLEL_SYSTEMS.includes(technique), `${technique} goes with a system card, not on its own`);
    assert.equal(systemTitle('bazi-mangpai'), '盲派八字');
    assert.equal(systemTitle('unknown'), 'unknown');
    // A school member loads its own card, not the system default.
    assert.match(memberInstructions({ identity: '你是盲派专项分析助手。', profile: { instructions: '' }, system: 'bazi-mangpai', tools: ['bazi', 'load_skill'] }), /加载 bazi-mangpai（盲派八字）方法/);
});

test('loadSkill inlines reading principles when the caller has no method directory', async () => {
    const { loadSkill } = await import('../lib/agent/skills/catalog.server');
    const withDir = await loadSkill('00000000-0000-4000-8000-000000000001', 'dream', { hasMethodDirectory: true });
    assert.match(withDir.text, /解读通则见系统提示的方法目录/u);
    const withoutDir = await loadSkill('00000000-0000-4000-8000-000000000001', 'dream', { hasMethodDirectory: false });
    assert.doesNotMatch(withoutDir.text, /解读通则见系统提示的方法目录/u);
    assert.match(withoutDir.text, /## 解读通则\n\n- 断语必须引用盘面证据/u);
});
