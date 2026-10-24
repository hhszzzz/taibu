import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUserTime, resolveUserTimeZone, sentAtLine } from '../lib/ai/prompt-time';

test('a request is dated in the zone the browser sent, and in China Standard Time when it sent none or nonsense', () => {
    assert.equal(resolveUserTimeZone('America/New_York'), 'America/New_York');
    assert.equal(resolveUserTimeZone('UTC'), 'UTC');
    for (const value of [undefined, null, '', 'Fake/Zone', 'Asia/Shanghai'.repeat(6), 8, { zone: 'UTC' }])
        assert.equal(resolveUserTimeZone(value), 'Asia/Shanghai');
});

test('the time reads as the local wall clock the tools take, with its weekday and offset', () => {
    // 2026-10-24 15:51:30 UTC: still Saturday afternoon in China, Saturday morning in New York (daylight time).
    const at = new Date('2026-10-24T15:51:30Z');
    assert.equal(formatUserTime(at, 'Asia/Shanghai'), '2026-10-24 23:51 星期六，Asia/Shanghai（UTC+08:00）');
    assert.equal(formatUserTime(at, 'America/New_York'), '2026-10-24 11:51 星期六，America/New_York（UTC-04:00）');
    assert.equal(formatUserTime(at, 'Asia/Kolkata'), '2026-10-24 21:21 星期六，Asia/Kolkata（UTC+05:30）');
    assert.equal(formatUserTime(at, 'America/St_Johns'), '2026-10-24 13:21 星期六，America/St_Johns（UTC-02:30）');
    // Past midnight in China the date and weekday move on, which a server clock in UTC would miss.
    assert.equal(formatUserTime(new Date('2026-10-24T16:30:00Z'), 'Asia/Shanghai'), '2026-10-25 00:30 星期日，Asia/Shanghai（UTC+08:00）');
    assert.equal(sentAtLine(at, 'UTC'), '【发送时间：2026-10-24 15:51 星期六，UTC（UTC+00:00）】');
});
