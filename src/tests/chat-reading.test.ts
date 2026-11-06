import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { MarkdownBlocks, markdownPlugins, normalizeMarkdownMarkers, splitMarkdown, tableCsv } from '@/lib/chat/markdown-blocks';
import { normalizeChatPreferences } from '@/lib/chat/preferences';

type MarkdownNode = { type?: string; value?: string; children?: MarkdownNode[] };

function parseWithRendererPlugins(source: string): MarkdownNode {
    const processor = unified().use(remarkParse).use(markdownPlugins);
    const tree = processor.parse(source);
    processor.runSync(tree);
    return tree as unknown as MarkdownNode;
}

function countNodes(node: MarkdownNode, type: string): number {
    return (node.type === type ? 1 : 0) + (node.children ?? []).reduce((total, child) => total + countNodes(child, type), 0);
}

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
test('markers glued to Chinese text are spaced for GFM while code fences stay intact', () => {
    const source = '##标题\n\n1.第一点\n2、第二点\n-列表项\n• 圆点\n\n```\n##代码里不补\n1.保留\n```\n\n1.5 倍与 -1 不变';
    const normalized = normalizeMarkdownMarkers(source);
    assert.match(normalized, /^## 标题$/mu);
    assert.match(normalized, /^1\. 第一点$/mu);
    assert.match(normalized, /^2\. 第二点$/mu);
    assert.match(normalized, /^- 列表项$/mu);
    assert.match(normalized, /^- 圆点$/mu);
    assert.match(normalized, /```\n##代码里不补\n1\.保留\n```/u);
    assert.match(normalized, /1\.5 倍与 -1 不变$/u);
    const cache = new MarkdownBlocks();
    assert.equal(cache.advance(source).join(''), normalized, 'the blocks render the normalized text');
});
test('CJK-adjacent emphasis and <br> render as markdown, while code fences stay literal', () => {
    const tree = parseWithRendererPlugins([
        '排出了**紫微斗数（星曜与飞星四化）与西方占星（本命与外行星流运）**三张盘[1]。',
        '',
        '流年辛干**「文昌化忌」直击父母宫（丁巳，主考学功名与录取榜单）**[3]！',
        '',
        '这是~~删除（说明）~~文字。',
        '',
        '| 年 | 事 |',
        '| --- | --- |',
        '| **2018** | 顺遂<br>获重用 |',
        '',
        '```',
        '**代码里保持原样**<br>原样',
        '```',
    ].join('\n'));
    assert.equal(countNodes(tree, 'strong'), 3);
    assert.equal(countNodes(tree, 'delete'), 1, 'CJK-adjacent strikethrough stays a delete node');
    assert.equal(countNodes(tree, 'break'), 1, '<br> in a table cell becomes a break node');
    assert.equal(countNodes(tree, 'html'), 0, 'no raw HTML nodes reach the renderer');
    const code = JSON.stringify(tree);
    assert.match(code, /\*\*代码里保持原样\*\*<br>原样/u, 'fenced code keeps its bytes');
});
test('reading preferences clamp width and reject unknown scaling or notification consent', () => {
    assert.deepEqual(normalizeChatPreferences({ width: 99999, fontScale: 125, desktopNotifications: true }), { width: 1200, fontScale: 125, desktopNotifications: true, runningSendMode: 'supplement' });
    // 缺省/非法宽度回落到 claude 实测的阅读列 768（448–1200，步长 16）。
    assert.deepEqual(normalizeChatPreferences({ width: NaN, fontScale: 200, desktopNotifications: 'true' }), { width: 768, fontScale: 100, desktopNotifications: false, runningSendMode: 'supplement' });
    assert.equal(normalizeChatPreferences({ runningSendMode: 'follow_up' }).runningSendMode, 'follow_up');
    assert.equal(normalizeChatPreferences({ runningSendMode: 'nope' as never }).runningSendMode, 'supplement');
    assert.equal(normalizeChatPreferences({ width: 10 }).width, 448);
    assert.equal(normalizeChatPreferences({ width: 500.4 }).width, 500);
});
