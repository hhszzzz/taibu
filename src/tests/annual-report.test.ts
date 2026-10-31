import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockScopedDb } from './helpers/db-mock';


function createAnnualReportDb(state: {
    conversations?: Array<Record<string, unknown>>;
    tables?: string[];
    cachedReport?: Record<string, unknown> | null;
    cachedRow?: Record<string, unknown> | null;
    count?: number;
}) {
    return createMockScopedDb({
        tx: async (work) => work({
            selectFrom(table: string) {
                state.tables?.push(table);
                let isCount = false;
                const query = {
                    select(selection: unknown) {
                        if (typeof selection === 'function') {
                            isCount = true;
                            const expressionBuilder = {
                                fn: { countAll: () => ({ as: () => undefined }) },
                            };
                            (selection as (eb: unknown) => unknown)(expressionBuilder);
                        }
                        return query;
                    },
                    where() { return query; },
                    orderBy() { return query; },
                    limit() { return query; },
                    offset() { return query; },
                    async executeTakeFirst() {
                        if (table === 'annual_reports') return state.cachedRow;
                        if (table === 'conversations' && isCount) return { count: state.count ?? 0 };
                        return undefined;
                    },
                    async execute() {
                        if (table === 'conversations') return state.conversations ?? [];
                        return [];
                    },
                };
                return query;
            },
            insertInto(table: string) {
                assert.equal(table, 'annual_reports');
                const query = {
                    values(payload: Record<string, unknown>) {
                        state.cachedReport = payload.report_data as Record<string, unknown>;
                        return query;
                    },
                    onConflict(callback: (conflict: { columns: () => { doUpdateSet: () => unknown } }) => unknown) {
                        callback({ columns: () => ({ doUpdateSet: () => undefined }) });
                        return query;
                    },
                    async execute() { return []; },
                };
                return query;
            },
        } as never),
    });
}

test('annual report generation uses the scoped system database for queries', async (t) => {
    const contextModule = require('../lib/db/context.server') as any;
    const state: {
        conversations?: Array<Record<string, unknown>>;
        tables: string[];
        cachedReport?: Record<string, unknown> | null;
    } = {
        conversations: [
            { id: 'conv-1', source_type: 'bazi', created_at: '2024-01-10T00:00:00Z' },
            { id: 'conv-2', source_type: 'chat', created_at: '2024-01-11T00:00:00Z' },
        ],
        tables: [],
        cachedReport: null,
    };
    t.mock.method(contextModule, 'systemDb', () => createAnnualReportDb(state));

    const { generateAnnualReport } = await import('../lib/annual-report');
    const { ANNUAL_REPORT_FEATURE_NAMES } = await import('../lib/annual-report-shared');

    const report = await generateAnnualReport('user-1', 2024);

    assert.ok(report);
    assert.equal(report?.usage.totalAnalyses, 2);
    assert.equal('checkin' in (report ?? {}), false, 'check-in was removed with credits');
    assert.equal('progress' in (report ?? {}), false);
    assert.equal(state.tables.includes('daily_checkins'), false);
    assert.equal(ANNUAL_REPORT_FEATURE_NAMES.qimen, '奇门遁甲');
    assert.equal(ANNUAL_REPORT_FEATURE_NAMES.daliuren, '大六壬');
    assert.equal(ANNUAL_REPORT_FEATURE_NAMES.dream, '解梦分析');
    assert.equal(ANNUAL_REPORT_FEATURE_NAMES.chat, 'AI 对话');
    assert.ok(state.cachedReport);
});

test('annual report summary uses the scoped system database when cache is empty', async (t) => {
    const contextModule = require('../lib/db/context.server') as any;
    t.mock.method(contextModule, 'systemDb', () => createAnnualReportDb({
        cachedRow: undefined,
        count: 4,
    }));

    const { getReportSummary } = await import('../lib/annual-report');

    const summary = await getReportSummary('user-1', 2024);

    assert.deepEqual(summary, {
        hasData: true,
        totalAnalyses: 4,
        topFeature: 'unknown',
    });
});
