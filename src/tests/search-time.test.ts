import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchTime } from '../lib/chat/search-time';

const now = new Date(2026, 10, 8, 12, 0, 0); // 2026-11-08, a Sunday
const parseSearchText = (value: string) => parseSearchTime(value, now);

test('time words become an inclusive local date range and leave the keyword', () => {
    assert.deepEqual(parseSearchTime('10月', now), { keyword: '', time: { since: '2026-10-01', until: '2026-10-31', label: '2026-10' } });
    assert.deepEqual(parseSearchTime('事业 10月', now), { keyword: '事业', time: { since: '2026-10-01', until: '2026-10-31', label: '2026-10' } });
    assert.deepEqual(parseSearchTime('2026-10-20', now), { keyword: '', time: { since: '2026-10-20', until: '2026-10-20', label: '2026-10-20' } });
    assert.deepEqual(parseSearchText('10月20日 考试'), { keyword: '考试', time: { since: '2026-10-20', until: '2026-10-20', label: '2026-10-20' } });
    assert.deepEqual(parseSearchTime('昨天', now).time, { since: '2026-11-07', until: '2026-11-07', label: '2026-11-07' });
    assert.deepEqual(parseSearchTime('本周', now).time?.since, '2026-11-02');
    assert.deepEqual(parseSearchTime('本周', now).time?.until, '2026-11-08');
    assert.deepEqual(parseSearchTime('2025年', now).time?.label, '2025年');
});

test('a malformed date stays a keyword instead of being partly parsed', () => {
    assert.deepEqual(parseSearchTime('10月32日', now), { keyword: '10月32日', time: null });
    assert.deepEqual(parseSearchTime('2026-13-01', now), { keyword: '2026-13-01', time: null });
    assert.deepEqual(parseSearchTime('13月', now), { keyword: '13月', time: null });
    assert.deepEqual(parseSearchTime('没有时间词', now), { keyword: '没有时间词', time: null });
});
