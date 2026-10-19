import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_METHODS } from '../lib/agent/analysis-methods.generated';
import { renderMethodDirectory } from '../lib/agent/method-section.server';
import { backgroundCompactionTokens } from '../lib/agent/compaction';

test('method directory advertises only offered tools and keeps a compact eleven-guide catalog', () => {
    const full = renderMethodDirectory(ANALYSIS_METHODS.map(item => item.tool))!;
    assert.equal(full.split('\n').filter(line => /^- \w+（/.test(line)).length, 11);
    // 24 个工具（含 8 个详查）只多出工具名，目录仍是每个指引一行。
    assert.ok(full.length < 1800, `directory length ${full.length}`);
    for (const label of ['历法', '时间', '占当下', '日期核实', '随机性', '六爻用神', 'detailLevel']) {
        assert.ok(full.includes(`**${label}**`), `missing shared convention: ${label}`);
    }
    const subset = renderMethodDirectory(['bazi_dayun', 'tarot'])!;
    assert.match(subset, /工具：bazi_dayun/);
    assert.doesNotMatch(subset, /工具：ziwei|工具：bazi,/);
    assert.equal(renderMethodDirectory([]), undefined);
    assert.equal(renderMethodDirectory(['ask_user']), undefined);
});

test('background reserve adapts to known capacities while unknown windows stay disabled', () => {
    assert.equal(backgroundCompactionTokens(128000, 8000), 32768);
    assert.equal(backgroundCompactionTokens(16000, 8000), 4000);
    assert.equal(backgroundCompactionTokens(null, 8000), 0);
    assert.equal(backgroundCompactionTokens(8000, 8000), 0);
});
