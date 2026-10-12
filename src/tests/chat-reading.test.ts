import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MarkdownBlocks, splitMarkdown, tableCsv } from '@/lib/chat/markdown-blocks';
import { normalizeChatPreferences } from '@/lib/chat/preferences';

test('incremental GFM keeps fenced lists and CRLF bytes intact', () => {
    const source = '# 标题\r\n\r\n  - 第一项\r\n  - 第二项\r\n\r\n```chart\r\n{"title":"未完成"\r\n\r\n- 仍属于围栏';
    const cache = new MarkdownBlocks();
    const before = cache.advance(source);
    const after = cache.advance(source + '\r\n}\r\n```\r\n\r\n后续正文');
    assert.equal(before.join(''), source);
    assert.equal(after.join(''), source + '\r\n}\r\n```\r\n\r\n后续正文');
    assert.equal(after[0], before[0]);
    assert.match(before.at(-1)!, /仍属于围栏/u);
});
test('document-scoped definitions collapse previous blocks and resolve cross-block context', () => {
    const cache = new MarkdownBlocks();
    cache.advance('[来源][ref]\n\n第二段\n\n');
    const full = '[来源][ref]\n\n第二段\n\n[ref]: https://example.org\n';
    assert.deepEqual(cache.advance(full), [full]);
    assert.equal(splitMarkdown('> [^a]: 注释\n\n正文[^a]').document, true);
    assert.equal(splitMarkdown('<div>\n\n正文\n\n</div>').document, true);
});
test('table CSV preserves quotes/newlines and neutralizes spreadsheet formulas', () => {
    const value = tableCsv([['="cmd"', '中,文', '两\n行'], [' @SUM(A1)', '普通', '"引号"']]);
    assert.ok(value.startsWith('\ufeff'));
    assert.ok(value.includes('"\'=""cmd"""'));
    assert.ok(value.includes('"\' @SUM(A1)"'));
    assert.ok(value.includes('\r\n'));
});
test('reading preferences clamp width and reject unknown scaling or notification consent', () => {
    assert.deepEqual(normalizeChatPreferences({ width: 99999, fontScale: 125, desktopNotifications: true }), { width: 1200, fontScale: 125, desktopNotifications: true });
    assert.deepEqual(normalizeChatPreferences({ width: NaN, fontScale: 200, desktopNotifications: 'true' }), { width: 700, fontScale: 100, desktopNotifications: false });
});
