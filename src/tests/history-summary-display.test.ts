import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHistoryDate, getDefaultHistoryDetail } from '../lib/history/summary-display';

test('formatHistoryDate shows date and minute, and hides invalid timestamps', () => {
  const expected = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date('2026-10-12T13:04:00Z'));

  assert.equal(formatHistoryDate('2026-10-12T13:04:00Z'), expected);
  assert.equal(formatHistoryDate(''), '');
  assert.equal(formatHistoryDate('not-a-date'), '');
});

test('getDefaultHistoryDetail joins badges and metric without repeating the title', () => {
  assert.equal(getDefaultHistoryDetail({ title: '大安', badges: ['3月', '12日', '子时'] }), '3月 · 12日 · 子时');
  assert.equal(getDefaultHistoryDetail({ title: '地山谦', metric: '变爻：第2爻、第5爻' }), '变爻：第2爻、第5爻');
  // 手相标题由手别和分析类型拼成，徽标不再重复。
  assert.equal(getDefaultHistoryDetail({ title: '右手事业线', badges: ['右手', '事业线'] }), '');
  assert.equal(getDefaultHistoryDetail({ title: '综合分析', badges: ['综合分析', ' '] }), '');
  assert.equal(getDefaultHistoryDetail({ title: '梅花', badges: ['时间起卦'], metric: '' }), '时间起卦');
});
