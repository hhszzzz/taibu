import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSection, insertSection, main, nextVersion, parseCommit, renderNotes } from '../release.mjs';

const REPO = 'https://github.com/hhszzzz/taibu';
const commit = (subject, body = '', hash = 'a'.repeat(40)) => parseCommit({ hash, subject, body });

test('versions bump by level, release a prerelease at its own level and refuse to go backwards', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.1.3', 'major'), '1.0.0');
  assert.equal(nextVersion('1.2.0-rc.1', 'minor'), '1.2.0');
  assert.equal(nextVersion('1.2.1-rc.1', 'patch'), '1.2.1');
  assert.equal(nextVersion('1.2.1-rc.1', 'minor'), '1.3.0');
  assert.equal(nextVersion('0.1.0', '1.0.0-rc.1'), '1.0.0-rc.1');
  assert.equal(nextVersion('1.0.0-rc.9', '1.0.0-rc.10'), '1.0.0-rc.10');
  assert.throws(() => nextVersion('0.2.0', '0.1.9'), /需要高于当前版本/);
  assert.throws(() => nextVersion('1.0.0', '1.0.0-rc.1'), /需要高于当前版本/);
  assert.throws(() => nextVersion('0.1.0', 'v0.2.0'), /版本参数/);
});

test('commits parse scope, the ! marker and the BREAKING CHANGE footer', () => {
  assert.deepEqual(
    commit('feat(ai)!: keep keys in the catalog', 'Body.\n\nBREAKING CHANGE: run the SQL\nbefore starting.'),
    { hash: 'a'.repeat(40), type: 'feat', scope: 'ai', description: 'keep keys in the catalog', breaking: true, breakingNote: 'run the SQL before starting.' },
  );
  assert.equal(commit('fix: plain fix').scope, null);
  assert.equal(commit('fix: plain fix').breaking, false);
  assert.equal(commit('Merge branch feature').type, 'other');
});

test('notes put upgrade steps first, group by type and leave out tests and release commits', () => {
  const notes = renderNotes({
    version: '0.2.0',
    date: '2026-10-27',
    repositoryUrl: REPO,
    commits: [
      commit('feat(ai)!: keep keys in the catalog', 'BREAKING CHANGE: re-enter gateway keys', '1'.repeat(40)),
      commit('fix(chat): keep one status line', '', '2'.repeat(40)),
      commit('test: cover the editor', '', '3'.repeat(40)),
      commit('chore(release): v0.1.0', '', '4'.repeat(40)),
      commit('chore: upgrade Node', '', '5'.repeat(40)),
      commit('整理文案', '', '6'.repeat(40)),
    ],
  });
  const headings = notes.split('\n').filter(line => line.startsWith('#'));
  assert.deepEqual(headings, ['## v0.2.0 · 2026-10-27', '### 升级须知', '### 新功能', '### 修复', '### 维护', '### 其他']);
  assert.match(notes, /- \*\*ai\*\*: keep keys in the catalog \(\[1111111\]\(https:\/\/github\.com\/hhszzzz\/taibu\/commit\/1{40}\)\)\n {2}re-enter gateway keys/u);
  assert.doesNotMatch(notes, /cover the editor|v0\.1\.0/u);
  assert.match(notes, /### 其他\n\n- 整理文案/u);
  assert.match(renderNotes({ version: '0.2.1', date: '2026-10-28', repositoryUrl: REPO, commits: [commit('test: only tests')] }), /没有面向用户的变更/u);
});

test('the changelog keeps the newest release on top and each section can be read back alone', () => {
  const first = insertSection('', '## v0.2.0 · 2026-10-27\n\n### 修复\n\n- one\n');
  assert.match(first, /^# 更新日志\n/u);
  const second = insertSection(first, '## v0.2.1 · 2026-10-28\n\n### 修复\n\n- two\n');
  assert.ok(second.indexOf('## v0.2.1') < second.indexOf('## v0.2.0'));
  assert.equal(second.match(/^# 更新日志/gmu).length, 1);
  assert.equal(extractSection(second, '0.2.0'), '### 修复\n\n- one');
  assert.equal(extractSection(second, '0.2.1'), '### 修复\n\n- two');
  assert.equal(extractSection(second, '0.2'), null);
  assert.equal(extractSection(second, '0.3.0'), null);
});

test('unknown commands and options fail before touching git or files', async () => {
  await assert.rejects(main(['publish']), /用法/u);
  await assert.rejects(main(['prepare', 'minor', '--push']), /未知参数/u);
  await assert.rejects(main(['prepare', 'minor', '--from']), /--from 需要/u);
  await assert.rejects(main(['notes', 'latest']), /用法/u);
});
