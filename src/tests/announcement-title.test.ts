import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => require('../lib/announcement') as typeof import('../lib/announcement');

test('公告标题取首个标题行，正文是它后面的内容', () => {
  const { getAnnouncementTitle, getAnnouncementBody } = load();
  const content = '# 太卜 v1.2 发布\n\n本次更新了记录页与通知面板。\n\n- 第一条';
  assert.equal(getAnnouncementTitle(content), '太卜 v1.2 发布');
  assert.equal(getAnnouncementBody(content), '本次更新了记录页与通知面板。\n\n- 第一条');
});

test('没有标题时首行不长于 30 字就整行作标题', () => {
  const { getAnnouncementTitle, getAnnouncementBody } = load();
  const content = '社区与命盘记录已放入示例数据，可随时删除。\n下一段不该当标题。';
  assert.equal(getAnnouncementTitle(content), '社区与命盘记录已放入示例数据，可随时删除。');
  assert.equal(getAnnouncementBody(content), '下一段不该当标题。');
});

test('首行太长时在第一个标点处断开，正文从断开处起', () => {
  const { getAnnouncementTitle, getAnnouncementBody } = load();
  const content = '本地演示环境已就绪：admin@taibu.local / demo@taibu.local / newbie@taibu.local 均可登录。';
  assert.equal(getAnnouncementTitle(content), '本地演示环境已就绪');
  assert.equal(getAnnouncementBody(content), 'admin@taibu.local / demo@taibu.local / newbie@taibu.local 均可登录。');
});

test('首行没有标点可断时截断标题，正文保留全文', () => {
  const { getAnnouncementTitle, getAnnouncementBody } = load();
  const content = '这是一段没有任何标点而且明显超过三十个字的公告开头用来测试截断逻辑是否正确';
  assert.equal(getAnnouncementTitle(content), '这是一段没有任何标点而且明显超过三十个字的公告开…');
  assert.equal(getAnnouncementBody(content), content);
});

test('空公告没有标题也没有正文', () => {
  const { getAnnouncementTitle, getAnnouncementBody } = load();
  assert.equal(getAnnouncementTitle('  \n\n '), '');
  assert.equal(getAnnouncementBody('  \n\n '), '');
});
