import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/components/layout/SidebarAnnouncementCenter.tsx'),
  'utf8',
);

test('announcement center clears announcement pagination after append failures', () => {
  assert.match(
    SOURCE,
    /if \(result\.error\) \{[\s\S]*setAnnouncementHasMore\(false\);[\s\S]*setAnnouncementNextOffset\(null\);[\s\S]*if \(!append\)/u,
  );
});

test('announcement center clears notification pagination after append failures without dropping loaded items', () => {
  assert.match(
    SOURCE,
    /catch \(error\) \{[\s\S]*setNotificationHasMore\(false\);[\s\S]*setNotificationNextOffset\(null\);[\s\S]*if \(!append\) \{[\s\S]*setNotifications\(\[\]\);[\s\S]*setNotificationError\(message\);/u,
  );
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
