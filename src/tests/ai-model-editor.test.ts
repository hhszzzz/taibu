import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileModelDrafts, buildCreateModelPayload, buildEditModelPayload, buildSourcePayload,
  createEditModelDraft, createInitialNewModel, createInitialSourceDraft,
  createPrimaryGatewayUpdate, createRoutingModeUpdate, getSourceModelIdState,
  normalizeSourceModelIdInput, parseCustomParametersText, resolveDraftVendor,
  type AIModel,
} from '../lib/admin/ai-model-editor';

function model(): AIModel {
  return {
    id: 'model-1', modelKey: 'test-model', displayName: 'Test Model', vendor: 'custom vendor',
    usageType: 'chat', routingMode: 'auto', isEnabled: true, sortOrder: 5, requiredTier: 'plus',
    supportsReasoning: true, reasoningRequiredTier: 'pro', isReasoningDefault: true, supportsVision: true,
    defaultTemperature: 0, defaultTopP: 0, defaultPresencePenalty: 0, defaultFrequencyPenalty: -1,
    defaultMaxTokens: 1234, defaultReasoningEffort: 'high', reasoningEffortFormat: 'reasoning_effort',
    customParameters: { reasoning: { effort: 'high' }, custom: 2 }, description: null, sources: [],
  };
}

test('new model defaults and full creation payload preserve nulls, optional description and routing', () => {
  const draft = createInitialNewModel();
  assert.notEqual(draft, createInitialNewModel());
  assert.deepEqual(buildCreateModelPayload(draft), {
    modelKey: '', displayName: '', vendor: 'deepseek', usageType: 'chat', routingMode: 'auto',
    primaryGatewayKey: 'newapi', requiredTier: 'free', supportsReasoning: false,
    reasoningRequiredTier: 'plus', isReasoningDefault: false, supportsVision: false,
    defaultTemperature: 0.7, defaultTopP: null, defaultPresencePenalty: null,
    defaultFrequencyPenalty: null, defaultMaxTokens: null, defaultReasoningEffort: null,
    reasoningEffortFormat: null, customParameters: null, description: undefined,
  });
  assert.equal(draft.reasoningEffortFormat, 'reasoning_object');
  const custom = { ...draft, vendorPreset: '__custom__', customVendor: '  my vendor  ', modelKey: ' x ', displayName: ' Name ' };
  const payload = buildCreateModelPayload(custom);
  assert.equal(payload.vendor, 'my vendor');
  assert.equal(payload.modelKey, 'x');
  assert.equal(payload.displayName, 'Name');
  assert.equal(resolveDraftVendor(custom), 'my vendor');
});

test('edit draft roundtrip preserves all editable fields including zero, custom JSON and source-independent identity', () => {
  const original = model();
  const draft = createEditModelDraft(original);
  assert.equal(draft.vendorPreset, '__custom__');
  assert.equal(draft.customVendor, original.vendor);
  assert.equal(draft.customParametersText, JSON.stringify(original.customParameters, null, 2));
  const editable = Object.fromEntries(Object.entries(original).filter(([key]) => !['id', 'isEnabled', 'sources'].includes(key)));
  assert.deepEqual(buildEditModelPayload(draft), editable);
  assert.equal(createEditModelDraft({ ...original, vendor: 'deepseek' }).vendorPreset, 'deepseek');
  const disabled = buildEditModelPayload({ ...draft, supportsReasoning: false, description: '  ' });
  assert.equal(disabled.isReasoningDefault, false);
  assert.equal(disabled.defaultReasoningEffort, null);
  assert.equal(disabled.reasoningEffortFormat, null);
  assert.equal(disabled.description, null);
  assert.equal(draft.isReasoningDefault, true);
});

test('custom parameter parser accepts only JSON objects and keeps nested vendor parameters intact', () => {
  assert.equal(parseCustomParametersText('  '), null);
  assert.deepEqual(parseCustomParametersText('{"reasoning":{"effort":"high"},"temperature":0}'), {
    reasoning: { effort: 'high' }, temperature: 0,
  });
  for (const text of ['null', '[]', '1', 'true', '"value"', '{broken']) {
    assert.throws(() => parseCustomParametersText(text));
  }
});

test('source overrides inherit only when empty or identical, with nullable trimmed payload fields', () => {
  assert.equal(normalizeSourceModelIdInput(' test-model ', 'test-model'), null);
  assert.equal(normalizeSourceModelIdInput('  ', 'test-model'), null);
  assert.equal(normalizeSourceModelIdInput('other', 'test-model'), 'other');
  assert.deepEqual(getSourceModelIdState(' test-model ', null), { value: 'test-model', inherited: true });
  assert.deepEqual(getSourceModelIdState('test-model', ' other '), { value: 'other', inherited: false });
  assert.deepEqual(buildSourcePayload(createInitialSourceDraft(), 'test-model'), {
    modelIdOverride: null, reasoningModelId: null, priority: 0, isEnabled: true, notes: null,
  });
  assert.deepEqual(buildSourcePayload({ modelIdOverride: ' upstream ', reasoningModelId: ' reason ', priority: 3, isEnabled: false, notes: ' note ' }, 'test-model'), {
    modelIdOverride: 'upstream', reasoningModelId: 'reason', priority: 3, isEnabled: false, notes: 'note',
  });
});

test('routing and primary gateway remain coupled only for fixed routing modes', () => {
  const draft = createInitialNewModel();
  assert.deepEqual(createRoutingModeUpdate(draft, 'octopus'), { routingMode: 'octopus', primaryGatewayKey: 'octopus' });
  assert.deepEqual(createRoutingModeUpdate({ ...draft, primaryGatewayKey: 'octopus' }, 'auto'), { routingMode: 'auto', primaryGatewayKey: 'octopus' });
  assert.deepEqual(createPrimaryGatewayUpdate(draft, 'octopus'), { routingMode: 'auto', primaryGatewayKey: 'octopus' });
  assert.deepEqual(createPrimaryGatewayUpdate({ ...draft, routingMode: 'newapi' }, 'octopus'), { routingMode: 'octopus', primaryGatewayKey: 'octopus' });
});

test('model reload preserves dirty fields and merges clean server fields without resurrecting deleted drafts', () => {
  const baseline = createEditModelDraft(model());
  const another = { ...baseline, displayName: 'Other model' };
  const previous = { one: baseline, two: another, deleted: baseline };
  const current = { ...previous, two: { ...another, description: 'Unsaved notes' } };
  const incoming = { one: { ...baseline, displayName: 'Saved model' }, two: { ...another, sortOrder: 99 }, new: baseline };
  const result = reconcileModelDrafts(current, previous, incoming);
  assert.equal(result.one.displayName, 'Saved model');
  assert.equal(result.two.description, 'Unsaved notes');
  assert.equal(result.two.sortOrder, 99);
  assert.equal(result.deleted, undefined);
  assert.deepEqual(result.new, baseline);
  assert.equal(current.two.sortOrder, another.sortOrder);
});

test('vendor labels are pure browser data with backward-compatible names and presets', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const labels = await import('../lib/ai/vendor-labels');
  assert.equal(labels.getVendorName('deepseek'), 'DeepSeek');
  assert.equal(labels.getVendorName('private-vendor'), 'private-vendor');
  assert.deepEqual(labels.VENDOR_PRESETS, Object.keys(labels.VENDOR_NAMES));
  const source = readFileSync(resolve(process.cwd(), 'src/lib/ai/vendor-labels.ts'), 'utf8');
  assert.doesNotMatch(source, /process\.env|^import\s|server-only/m);
});
