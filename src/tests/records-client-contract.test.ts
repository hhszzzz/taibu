import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('record and note reads reject obsolete transport completions after cancellation', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const { getRecords, getRecord, getNotesByDate } = require('../lib/records') as typeof import('../lib/records');
  for (const read of [
    (signal: AbortSignal) => getRecords({}, 1, 10, { signal }),
    (signal: AbortSignal) => getRecord('artifact-record', { signal }),
    (signal: AbortSignal) => getNotesByDate('2026-10-04', { signal }),
  ]) {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    let receivedSignal: AbortSignal | null | undefined;
    global.fetch = async (_input, init) => {
      receivedSignal = init?.signal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    };
    const pending = read(controller.signal);
    controller.abort();
    finish(new Response(JSON.stringify({ records: [], total: 42, notes: [] })));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(receivedSignal, controller.signal);
  }
});

test('records page no longer keeps a parallel fetch client next to src/lib/records.ts', () => {
  const pageSource = readFileSync(resolve(process.cwd(), 'src/app/records/page.tsx'), 'utf8');

  assert.equal(pageSource.includes('await fetch(`/api/records?'), false);
  assert.equal(pageSource.includes("await fetch(`/api/records/${id}`"), false);
  assert.equal(pageSource.includes('await fetch(`/api/notes?date='), false);
  assert.equal(pageSource.includes('getRecords('), true);
  assert.equal(pageSource.includes('getNotesByDate('), true);
  assert.equal(pageSource.includes('deleteRecord('), true);
  assert.equal(pageSource.includes('toggleRecordPin('), true);
  assert.equal(pageSource.includes('useSessionSafe('), true);
  assert.equal(pageSource.includes('<AddToKnowledgeBaseModal'), true);
  assert.equal(pageSource.includes('ImportExportModal,\n    KnowledgeBaseModal,'), false);
  assert.equal(pageSource.includes('listKnowledgeBases('), false);
});

test('records detail components reuse src/lib/records.ts instead of maintaining raw records/nodes fetchers', () => {
  const detailSource = readFileSync(resolve(process.cwd(), 'src/components/records/RecordDetail.tsx'), 'utf8');

  assert.equal(detailSource.includes("fetch(record ? `/api/records/${record.id}` : '/api/records'"), false);
  assert.equal(detailSource.includes("fetch('/api/notes'"), false);
  assert.equal(detailSource.includes("fetch(`/api/notes?id=${id}`"), false);
  assert.equal(detailSource.includes("fetch('/api/records/import'"), false);
  assert.equal(detailSource.includes("window.open('/api/records/export'"), false);
  assert.equal(detailSource.includes('createRecord('), true);
  assert.equal(detailSource.includes('updateRecord('), true);
  assert.equal(detailSource.includes('createNote('), true);
  assert.equal(detailSource.includes('deleteNote('), true);
  assert.equal(detailSource.includes('exportData('), true);
  assert.equal(detailSource.includes('importData('), true);
});

test('records client should not keep dead allowNotFound fallback for removed single-record helpers', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/records.ts'), 'utf8');

  assert.equal(source.includes('allowNotFound: true'), false);
  assert.equal(source.includes('/不存在|404/u.test'), false);
});

test('records notes and import-export helpers should not keep fake userId passthrough signatures', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/lib/records.ts'), 'utf8');
  const pageSource = readFileSync(resolve(process.cwd(), 'src/app/records/page.tsx'), 'utf8');
  const detailSource = readFileSync(resolve(process.cwd(), 'src/components/records/RecordDetail.tsx'), 'utf8');

  assert.equal(source.includes('void userId;'), false);
  assert.equal(source.includes('getNotesByDate(userId:'), false);
  assert.equal(source.includes('createNote(userId:'), false);
  assert.equal(source.includes('exportData(userId:'), false);
  assert.equal(source.includes('importData(\n    userId,'), false);
  assert.equal(pageSource.includes('getNotesByDate(user.id,'), false);
  assert.equal(detailSource.includes('createNote(userId,'), false);
  assert.equal(detailSource.includes('exportData(userId)'), false);
  assert.equal(detailSource.includes('importData(userId,'), false);
});

test('toLocalDateKey uses the local calendar day instead of the UTC day', () => {
  const { toLocalDateKey } = require('../lib/records') as typeof import('../lib/records');
  // 本地时间 1 月 5 日 00:30：UTC 偏东的时区里 toISOString() 会给出 1 月 4 日。
  assert.equal(toLocalDateKey(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
  assert.equal(toLocalDateKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('parseImportData only accepts a records export before anything is overwritten', () => {
  const { parseImportData } = require('../lib/records') as typeof import('../lib/records');
  const valid = parseImportData(JSON.stringify({ version: '1.0', exportedAt: '2026-10-01', records: [], notes: [] }));

  assert.deepEqual(valid.records, []);
  assert.throws(() => parseImportData('{not json'), /文件解析失败/u);
  for (const invalid of [null, [], {}, { version: '1.0', records: [] }, { version: '', records: [], notes: [] }, { version: '1.0', records: {}, notes: [] }]) {
    assert.throws(() => parseImportData(JSON.stringify(invalid)), /导入数据格式无效/u, JSON.stringify(invalid));
  }
});
