import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../packages/core/dist/mcp/index.js';
import * as bundled from '../../skills/taibu-divination/scripts/vendor/taibu-core.bundle.mjs';

// Verify the shipped artifact, not a freshly rebuilt substitute. No provider calls.
test('bundled Skill tool manifest matches the public Core contract', () => {
  assert.deepEqual(bundled.listToolDefinitions(), core.listToolDefinitions());
});

for (const tool of core.listToolDefinitions()) {
  test(`bundled Skill preserves frozen ${tool.name} canonical text and JSON`, async (t) => {
    const RealDate = globalThis.Date;
    const realRandom = Math.random;
    const frozen = RealDate.parse('2026-01-01T04:00:00Z');
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [frozen])); }
      static now() { return frozen; }
    };
    Math.random = () => 0.3141592653589793;
    t.after(() => { globalThis.Date = RealDate; Math.random = realRandom; });

    assert.ok(tool.inputSchema.examples?.length, `${tool.name} requires an executable contract example`);
    const input = { ...tool.inputSchema.examples[0] };
    if ('seed' in tool.inputSchema.properties) input.seed = 'refactor-acceptance';
    const currentResult = core.renderToolResult(tool.name, await core.executeTool(tool.name, input), { detailLevel: 'full' });
    const bundledResult = bundled.renderToolResult(tool.name, await bundled.executeTool(tool.name, input), { detailLevel: 'full' });
    assert.deepEqual(bundledResult, currentResult);
  });
}
