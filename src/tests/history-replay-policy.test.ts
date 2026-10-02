import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryRestorePayload, getHistoryReplayMode, HISTORY_CONFIG, HISTORY_TYPES } from '../lib/history/registry';

const createdAt = '2026-03-18T04:05:00.000Z';
const savedResult = Object.freeze({ legacyMarker: 'preserved-without-version', result: { value: 7 } });

test('all history entries explicitly declare replay and legacy policy', () => {
    for (const type of HISTORY_TYPES) {
        assert.ok(HISTORY_CONFIG[type].replay.mode);
        assert.ok(HISTORY_CONFIG[type].replay.legacyFallback);
    }
    assert.equal(HISTORY_CONFIG.meihua.replay.legacyFallback, 'input-recompute');
    assert.equal(HISTORY_CONFIG.xiaoliuren.replay.legacyFallback, 'unavailable');
});

test('Qimen history preserves date/settings and recomputes rather than replaying result_data', async () => {
    const row = Object.freeze({
        id: 'qimen-1', year: 2026, month: 3, day: 18, hour: 12, minute: 5,
        timezone: 'Asia/Shanghai', pan_type: 'zhuan', ju_method: 'chaibu',
        question: 'fixed question', created_at: createdAt, conversation_id: 'conv-1', result_data: savedResult,
    });
    const payload = await buildHistoryRestorePayload('qimen', row, 'UTC');
    assert.equal(getHistoryReplayMode('qimen', row), 'input-recompute');
    assert.equal(payload.sessionData.timezone, 'Asia/Shanghai');
    assert.deepEqual([payload.sessionData.year, payload.sessionData.month, payload.sessionData.day,
        payload.sessionData.hour, payload.sessionData.minute], [2026, 3, 18, 12, 5]);
    assert.equal(payload.sessionData.createdAt, createdAt);
    assert.equal(payload.sessionData.chartId, 'qimen-1');
    assert.equal(payload.sessionData.conversationId, 'conv-1');
    assert.equal('output' in payload.sessionData, false);
    assert.equal('resultData' in payload.sessionData, false);
    const legacy = await buildHistoryRestorePayload('qimen', { ...row, timezone: null }, 'Asia/Tokyo');
    assert.equal(legacy.sessionData.timezone, 'Asia/Tokyo');
});

test('Liuyao history reconstructs fixed yaos and targets without using saved raw result', async () => {
    const row = Object.freeze({ id: 'liuyao-1', hexagram_code: '111111', changed_hexagram_code: '011111',
        changed_lines: [1], yongshen_targets: ['官鬼', 'unsupported'], created_at: createdAt, result_data: savedResult });
    const payload = await buildHistoryRestorePayload('liuyao', row, 'UTC');
    assert.equal(getHistoryReplayMode('liuyao', row), 'input-recompute');
    assert.deepEqual(payload.sessionData.yaos, Array.from({ length: 6 }, (_, i) => ({
        type: 1, change: i === 0 ? 'changing' : 'stable', position: i + 1,
    })));
    assert.deepEqual(payload.sessionData.yongShenTargets, ['官鬼']);
    assert.equal(payload.sessionData.createdAt, createdAt);
    assert.equal('resultData' in payload.sessionData, false);
});

test('Meihua and Xiaoliuren replay saved bundles unchanged, without fake version backfill', async () => {
    for (const type of ['meihua', 'xiaoliuren'] as const) {
        const row = Object.freeze({ id: 'reading-1', input_data: { date: createdAt }, result_data: savedResult });
        const payload = await buildHistoryRestorePayload(type, row, 'UTC');
        assert.equal(getHistoryReplayMode(type, row), 'saved-result');
        assert.strictEqual(payload.sessionData.resultData, savedResult);
        assert.equal('version' in payload.sessionData, false);
        assert.equal('version' in savedResult, false);
    }
});

test('legacy Meihua input fallback is not incorrectly assigned to Xiaoliuren', async () => {
    const input = Object.freeze({ method: 'time', date: createdAt });
    const row = Object.freeze({ id: 'legacy-1', input_data: input, result_data: null });
    const meihua = await buildHistoryRestorePayload('meihua', row, 'UTC');
    const xiaoliuren = await buildHistoryRestorePayload('xiaoliuren', row, 'UTC');
    assert.equal(getHistoryReplayMode('meihua', row), 'legacy-input-recompute');
    assert.strictEqual(meihua.sessionData.input, input);
    assert.equal(meihua.sessionData.resultData, undefined);
    assert.equal(getHistoryReplayMode('xiaoliuren', row), 'unavailable');
    assert.equal(xiaoliuren.sessionData.resultData, undefined);
    assert.equal('input' in xiaoliuren.sessionData, false);
    assert.equal(getHistoryReplayMode('meihua', { result_data: 'invalid' }), 'unavailable');
    // Existing object checks accept arrays; this extraction intentionally does not tighten validation.
    assert.equal(getHistoryReplayMode('meihua', { result_data: [] }), 'saved-result');
});

test('Tarot keeps saved cards and seed; Hepan keeps saved result or its legacy recompute policy', async () => {
    const cards = [{ card: { id: 'the-fool' }, orientation: 'reversed' }];
    const tarot = await buildHistoryRestorePayload('tarot', {
        id: 'tarot-1', spread_id: 'single', cards, created_at: createdAt, metadata: { seed: 'fixed-seed' },
    }, 'UTC');
    assert.strictEqual(tarot.sessionData.cards, cards);
    assert.equal(tarot.sessionData.seed, 'fixed-seed');
    assert.equal(tarot.sessionData.createdAt, createdAt);
    const hepan = await buildHistoryRestorePayload('hepan', { id: 'hepan-1', result_data: savedResult }, 'UTC');
    assert.equal(hepan.sessionData.legacyMarker, savedResult.legacyMarker);
    assert.equal(getHistoryReplayMode('hepan', {}), 'legacy-input-recompute');
});
