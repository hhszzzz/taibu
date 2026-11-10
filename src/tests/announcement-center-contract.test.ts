import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('notification feeds stop appending after a failed page without dropping loaded items', () => {
  const source = read('src/components/notifications/feeds.ts');
  // 追加失败：只关掉续页 run，再提示；已加载的条目原样保留。
  assert.match(
    source,
    /fetchPage\(offset\)\.then\([\s\S]*nextOffset: null, loadingMore: false[\s\S]*showToast\('error'/u,
  );
  assert.match(source, /const seen = new Set\(current\.items\.map\(item => item\.id\)\)/u);
});

test('the bell panel and the notifications page share the same feeds', () => {
  const panel = read('src/components/notifications/NotificationPanel.tsx');
  const page = read('src/app/user/notifications/page.tsx');
  assert.match(panel, /useNotificationFeed\(/u);
  assert.match(panel, /useAnnouncementFeed\(/u);
  assert.match(panel, /useLoadMoreSentinel\(/u);
  // 通知页的通知栏沿用整页分页，公告栏与铃铛面板共用同一个分页 hook。
  assert.match(page, /useAnnouncementFeed\(/u);
  assert.match(page, /NotificationRow/u);
});

test('announcement excerpts strip basic Markdown into one plain-text line', async () => {
  const { getAnnouncementExcerpt } = await import('../lib/announcement');

  assert.equal(
    getAnnouncementExcerpt('## 国庆假期服务说明\n\n10 月 1 日至 7 日 **签到积分翻倍**，详见[公告页](https://example.com/a)。'),
    '国庆假期服务说明 10 月 1 日至 7 日 签到积分翻倍，详见公告页。',
  );
  assert.equal(
    getAnnouncementExcerpt('> - 第一条 *强调*\n1. 第二条 `代码`\n\n---\n![示意图](a.png) ~~旧价~~'),
    '第一条 强调 第二条 代码 示意图 旧价',
  );
  assert.equal(getAnnouncementExcerpt('```ts\nconst a = 1;\n```'), 'const a = 1;');
  // 没有 Markdown 语义的星号和下划线原样保留。
  assert.equal(getAnnouncementExcerpt('5 * 3 = 15，变量 NEWAPI_API_KEY'), '5 * 3 = 15，变量 NEWAPI_API_KEY');
  assert.equal(getAnnouncementExcerpt('  \n\n  '), '');
});
