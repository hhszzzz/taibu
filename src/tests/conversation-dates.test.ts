import test from 'node:test';
import assert from 'node:assert/strict';
import { getConversationDateGroup, groupConversationsByDate } from '../lib/chat/conversation-dates';

// Local wall-clock times, so the boundaries hold in any test time zone.
const local = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
const now = new Date(2026, 9, 12, 0, 10);

test('date groups follow local calendar days', () => {
    assert.equal(getConversationDateGroup(local(2026, 10, 12, 0, 1), now), 'today');
    assert.equal(getConversationDateGroup(local(2026, 10, 11, 23, 59), now), 'yesterday', 'eleven minutes ago is still yesterday');
    assert.equal(getConversationDateGroup(local(2026, 10, 10, 0, 0), now), 'week');
    assert.equal(getConversationDateGroup(local(2026, 10, 6), now), 'week');
    assert.equal(getConversationDateGroup(local(2026, 10, 5), now), 'month', 'seven days ago leaves 7 天内');
    assert.equal(getConversationDateGroup(local(2026, 9, 13), now), 'month');
    assert.equal(getConversationDateGroup(local(2026, 9, 12), now), 'earlier');
    assert.equal(getConversationDateGroup(local(2026, 10, 13, 9), now), 'today', 'a clock ahead of this device counts as today');
    assert.equal(getConversationDateGroup('not a date', now), 'earlier');
    assert.equal(getConversationDateGroup(undefined, now), 'earlier');
});

test('groups keep the list order and omit empty groups', () => {
    const items = [
        { id: 'a', updatedAt: local(2026, 10, 12, 0, 5) },
        { id: 'b', updatedAt: local(2026, 10, 1) },
        { id: 'c', updatedAt: local(2026, 10, 12, 0, 1) },
        { id: 'd', updatedAt: 'invalid' },
        { id: 'e', updatedAt: local(2026, 10, 11, 8) },
    ];
    assert.deepEqual(groupConversationsByDate(items, now).map(group => [group.label, group.items.map(item => item.id)]), [
        ['今天', ['a', 'c']], ['昨天', ['e']], ['30 天内', ['b']], ['更早', ['d']],
    ]);
    assert.deepEqual(groupConversationsByDate([], now), []);
});
