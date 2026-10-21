import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSIS_METHODS } from '../lib/agent/methods.server';
import { renderMethodDirectory } from '../lib/agent/method-section.server';
import { backgroundCompactionTokens } from '../lib/agent/compaction';

test('method directory lists each card once with only its offered tools, then the shared conventions', () => {
    const full = renderMethodDirectory(ANALYSIS_METHODS.flatMap(item => item.tools))!;
    const lines = full.split('\n').filter(line => /^- [a-z-]+（/.test(line));
    assert.deepEqual(lines.map(line => line.slice(2, line.indexOf('（'))), ANALYSIS_METHODS.map(item => item.id));
    assert.match(full, /^- bazi-mangpai（盲派八字）— .+工具：bazi, bazi_wuxing/m);
    assert.match(full, /^- dream（周公解梦）— .+无需排盘工具。$/m);
    // Thirteen cards with their routing descriptions stay a short catalogue; the cards themselves load on demand.
    assert.ok(full.length < 3200, `directory length ${full.length}`);
    for (const label of ['历法', '时间', '占当下', '日期核实', '随机性', '六爻用神', 'detailLevel']) {
        assert.ok(full.includes(`**${label}**`), `missing shared convention: ${label}`);
    }
    const subset = renderMethodDirectory(['bazi_dayun', 'tarot'])!;
    assert.match(subset, /^- bazi（子平八字）— .+工具：bazi_dayun$/m);
    assert.match(subset, /^- bazi-mangpai（盲派八字）— .+工具：bazi_dayun$/m);
    assert.doesNotMatch(subset, /^- ziwei/m);
    // Where only chart-reading cards can be loaded (the briefing), the chartless cards are left out.
    assert.doesNotMatch(renderMethodDirectory(['almanac'], false)!, /dream/);
    assert.equal(renderMethodDirectory([]), undefined);
    assert.equal(renderMethodDirectory(['ask_user', 'load_analysis_method']), undefined, 'a chartless card alone does not make a directory');
});

test('background reserve adapts to known capacities while unknown windows stay disabled', () => {
    assert.equal(backgroundCompactionTokens(128000, 8000), 32768);
    assert.equal(backgroundCompactionTokens(16000, 8000), 4000);
    assert.equal(backgroundCompactionTokens(null, 8000), 0);
    assert.equal(backgroundCompactionTokens(8000, 8000), 0);
});
