import test from 'node:test';
import assert from 'node:assert/strict';

import { DATA_SOURCE_TYPES } from '../lib/data-sources/manifest';
import {
  ARCHIVED_SOURCE_TYPES,
  CONVERSATION_SOURCE_TYPES,
  getSourceDataModelId,
  getSourceDataReasoning,
  normalizeAnalysisSourceData,
  normalizeAnalysisSourceType,
  normalizeConversationSourceType,
  toFeatureUsageBucket,
} from '../lib/source-contracts';

test('conversation source registry should preserve qimen and daliuren across read/write contracts', () => {
  assert.equal(CONVERSATION_SOURCE_TYPES.includes('qimen'), true);
  assert.equal(CONVERSATION_SOURCE_TYPES.includes('daliuren'), true);
  assert.equal(normalizeConversationSourceType('qimen'), 'qimen');
  assert.equal(normalizeConversationSourceType('daliuren'), 'daliuren');
  assert.equal(toFeatureUsageBucket('qimen'), 'qimen');
  assert.equal(toFeatureUsageBucket('daliuren'), 'daliuren');
});

test('retired dream conversations read back as chat', () => {
  assert.equal((CONVERSATION_SOURCE_TYPES as readonly string[]).includes('dream'), false);
  assert.equal(normalizeConversationSourceType('dream'), 'chat');
  assert.equal(toFeatureUsageBucket('dream'), 'chat');
  assert.equal(normalizeAnalysisSourceType('dream'), 'chat');
});

test('archived source registry should stay aligned with current data-source manifest additions', () => {
  for (const sourceType of ['qimen_chart', 'daliuren_divination'] as const) {
    assert.equal(DATA_SOURCE_TYPES.includes(sourceType), true, `${sourceType} should be a supported data source`);
    assert.equal(ARCHIVED_SOURCE_TYPES.includes(sourceType), true, `${sourceType} should be storable in archived_sources`);
  }
});

test('analysis source contract should preserve qimen and daliuren and stamp source_data schema version', () => {
  assert.equal(normalizeAnalysisSourceType('qimen'), 'qimen');
  assert.equal(normalizeAnalysisSourceType('daliuren'), 'daliuren');

  const normalized = normalizeAnalysisSourceData('qimen', {
    model_id: 'deepseek-v3.2',
    reasoning_text: 'reasoning',
    ju_number: 9,
  });

  assert.equal(normalized.schema_version, 1);
  assert.equal(getSourceDataModelId(normalized), 'deepseek-v3.2');
  assert.equal(getSourceDataReasoning(normalized), 'reasoning');
});
