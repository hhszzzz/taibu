import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalVisualizationSettings,
  normalizeVisualizationSettings,
  readLocalVisualizationSettings,
} from '../lib/visualization/settings';

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

test('no saved visualization settings means none, not the old six-dimension default', () => {
  assert.equal(normalizeVisualizationSettings(undefined), undefined);
  assert.equal(normalizeVisualizationSettings(null), undefined);
  assert.equal(normalizeVisualizationSettings({}), undefined);
  assert.equal(readLocalVisualizationSettings(storage()), undefined);
});

test('explicit settings still normalize and clear back to none', () => {
  const raw = { selectedDimensions: ['career', 'wealth', 'love', 'career'], dayunDisplayCount: 6, chartStyle: 'dark' };
  assert.deepEqual(normalizeVisualizationSettings(raw), {
    selectedDimensions: ['career', 'wealth', 'love'],
    dayunDisplayCount: 6,
    chartStyle: 'dark',
  });

  const local = storage({ fortuneDimensions: '["career"]', dayunPeriods: '5', chartStyle: 'modern' });
  assert.ok(readLocalVisualizationSettings(local));
  clearLocalVisualizationSettings(local);
  assert.equal(readLocalVisualizationSettings(local), undefined);
  assert.deepEqual([...local.values.keys()], []);
});
