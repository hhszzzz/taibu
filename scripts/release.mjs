#!/usr/bin/env node
// Cuts an application release locally: bumps package.json, writes the CHANGELOG
// section from the Conventional Commits since the last v* tag, then commits and
// tags. Nothing is pushed; pushing the tag is what publishes the image and the
// GitHub Release (.github/workflows/release.yml reads the same CHANGELOG section).
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const IMAGE = 'ghcr.io/hhszzzz/taibu';
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;
const CHANGELOG_HEADER = `# 更新日志

版本号为 \`x.y.z\`：x 是重大架构变更，y 是功能新增，z 是问题修复。每个版本的镜像发布在 \`${IMAGE}\`，部署方法见 [自托管手册](docs/manual/Self-Hosting.md)。
`;
// Commit types in the order their sections appear; test and style changes stay out of the notes.
const SECTIONS = [
  ['feat', '新功能'],
  ['fix', '修复'],
  ['perf', '性能'],
  ['refactor', '重构'],
  ['docs', '文档'],
  ['maintenance', '维护'],
  ['other', '其他'],
];
const MAINTENANCE_TYPES = new Set(['chore', 'build', 'ci', 'deps', 'revert']);
const HIDDEN_TYPES = new Set(['test', 'style', 'merge']);

const run = promisify(execFile);
const git = async (...args) => (await run('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })).stdout;

export function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  // A prerelease sorts before its release; numeric collation keeps rc.10 after rc.9.
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, 'en', { numeric: true });
}

/**
 * major / minor / patch from the current version, or an explicit x.y.z[-pre] that must be newer. Like
 * `npm version`, bumping a prerelease to the level it already previews releases it (1.2.0-rc.1 → minor → 1.2.0).
 */
export function nextVersion(current, bump) {
  const version = parseVersion(current);
  if (!version) throw new Error(`package.json 的版本号无效：${current}`);
  const { major, minor, patch, prerelease } = version;
  if (bump === 'major') return prerelease && !minor && !patch ? `${major}.0.0` : `${major + 1}.0.0`;
  if (bump === 'minor') return prerelease && !patch ? `${major}.${minor}.0` : `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${prerelease ? patch : patch + 1}`;
  const explicit = parseVersion(bump ?? '');
  if (!explicit) throw new Error('版本参数需要是 major、minor、patch 或 x.y.z（可带 -rc.1 之类的预发布后缀）');
  if (compareVersions(explicit, version) <= 0) throw new Error(`新版本 ${bump} 需要高于当前版本 ${current}`);
  return bump;
}

/** One Conventional Commit: type, optional scope, breaking marker and the BREAKING CHANGE footer text. */
export function parseCommit({ hash, subject, body }) {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/u.exec(subject);
  const footer = /^BREAKING[ -]CHANGE:\s*([\s\S]+)$/mu.exec(body ?? '');
  const breakingNote = footer ? footer[1].trim().replace(/\s*\n\s*/gu, ' ') : null;
  if (!match) return { hash, type: 'other', scope: null, description: subject, breaking: Boolean(breakingNote), breakingNote };
  return {
    hash,
    type: match[1],
    scope: match[2] ?? null,
    description: match[4],
    breaking: Boolean(match[3] || breakingNote),
    breakingNote,
  };
}

function sectionOf(commit) {
  if (HIDDEN_TYPES.has(commit.type)) return null;
  if (commit.type === 'chore' && commit.scope === 'release') return null;
  if (MAINTENANCE_TYPES.has(commit.type)) return 'maintenance';
  return SECTIONS.some(([key]) => key === commit.type) ? commit.type : 'other';
}

/** The CHANGELOG section for one version, newest commits first within each heading. */
export function renderNotes({ version, date, commits, repositoryUrl }) {
  const link = commit => `[${commit.hash.slice(0, 7)}](${repositoryUrl}/commit/${commit.hash})`;
  const line = commit => `- ${commit.scope ? `**${commit.scope}**: ` : ''}${commit.description} (${link(commit)})`;
  const lines = [`## v${version} · ${date}`, ''];
  const breaking = commits.filter(commit => commit.breaking);
  if (breaking.length) {
    lines.push('### 升级须知', '', '以下变更需要在升级时处理，完整步骤见对应提交说明。', '');
    for (const commit of breaking) {
      lines.push(line(commit));
      if (commit.breakingNote) lines.push(`  ${commit.breakingNote}`);
    }
    lines.push('');
  }
  for (const [key, title] of SECTIONS) {
    const entries = commits.filter(commit => sectionOf(commit) === key);
    if (!entries.length) continue;
    lines.push(`### ${title}`, '', ...entries.map(line), '');
  }
  if (lines.length === 2) lines.push('没有面向用户的变更。', '');
  return `${lines.join('\n').trimEnd()}\n`;
}

/** Puts the new section above the previous releases, creating the file's header the first time. */
export function insertSection(changelog, section) {
  if (!changelog?.trim()) return `${CHANGELOG_HEADER}\n${section}`;
  const first = changelog.search(/^## v/mu);
  if (first < 0) return `${changelog.trimEnd()}\n\n${section}`;
  return `${changelog.slice(0, first)}${section}\n${changelog.slice(first)}`;
}

/** The section of one version, without its heading line; null when the version has none. */
export function extractSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => line.startsWith(`## v${version} `) || line === `## v${version}`);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## v'));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

async function repositoryUrl() {
  const remote = (await git('remote', 'get-url', 'origin')).trim();
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(remote);
  if (!match) throw new Error('无法从 origin 识别 GitHub 仓库地址');
  return `https://github.com/${match[1]}`;
}

async function previousTag() {
  try {
    return (await git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD')).trim();
  } catch {
    return null;
  }
}

async function commitsSince(from) {
  const output = await git('log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', `${from}..HEAD`);
  return output.split('\x1e').map(entry => entry.trim()).filter(Boolean).map((entry) => {
    const [hash, subject, body] = entry.split('\x1f');
    return parseCommit({ hash, subject, body });
  });
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function parseOptions(args) {
  const options = { dryRun: false, from: null, positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--from') options.from = args[++index] ?? null;
    else if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
    else options.positional.push(arg);
  }
  if (options.from === null && args.includes('--from')) throw new Error('--from 需要一个提交或标签');
  return options;
}

async function prepare(options) {
  const [bump] = options.positional;
  if (!bump) throw new Error('用法：pnpm release prepare <major|minor|patch|x.y.z> [--from <提交或标签>] [--dry-run]');
  if (!options.dryRun && (await git('status', '--porcelain', '--untracked-files=no')).trim()) {
    throw new Error('工作区有未提交的改动，请先提交或暂存后再发布');
  }
  const packageText = await readFile(PACKAGE_JSON, 'utf8');
  const current = JSON.parse(packageText).version;
  const version = nextVersion(current, bump);
  const tag = `v${version}`;
  if ((await git('tag', '--list', tag)).trim()) throw new Error(`标签 ${tag} 已存在`);
  const from = options.from ?? await previousTag();
  if (!from) throw new Error('还没有 v* 标签，首个版本请用 --from 指定变更说明的起点（提交或标签）');
  const commits = await commitsSince(from);
  if (!commits.length) throw new Error(`${from} 之后没有新的提交`);
  const section = renderNotes({ version, date: localDate(), commits, repositoryUrl: await repositoryUrl() });

  console.log(`${current} → ${version}，变更说明取 ${from}..HEAD 的 ${commits.length} 个提交\n`);
  console.log(section);
  if (options.dryRun) {
    console.log('（试运行，未写入任何文件）');
    return;
  }
  const changelog = await readFile(CHANGELOG, 'utf8').catch(error => (error.code === 'ENOENT' ? '' : Promise.reject(error)));
  await writeFile(CHANGELOG, insertSection(changelog, section));
  await writeFile(PACKAGE_JSON, packageText.replace(/("version":\s*")[^"]+(")/u, `$1${version}$2`));
  await git('add', 'package.json', 'CHANGELOG.md');
  await git('commit', '-m', `chore(release): ${tag}`);
  // verbatim: the default cleanup would strip the notes' ### headings as comments.
  await git('tag', '-a', tag, '--cleanup=verbatim', '-m', `太卜 ${tag}\n\n${extractSection(section, version)}`);
  const branch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  console.log(`已在本地提交并打上标签 ${tag}，没有推送。核对 CHANGELOG.md 后执行：`);
  console.log(`  git push origin ${branch} ${tag}`);
  console.log(`推送标签后 CI 会发布镜像 ${IMAGE}:${tag} 和 GitHub Release。`);
}

async function notes(options) {
  const [version] = options.positional;
  if (!version || !parseVersion(version)) throw new Error('用法：pnpm release notes <x.y.z>');
  const section = extractSection(await readFile(CHANGELOG, 'utf8'), version);
  if (section === null) throw new Error(`CHANGELOG.md 里没有 v${version}`);
  process.stdout.write(`${section}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (command === 'prepare') return prepare(options);
  if (command === 'notes') return notes(options);
  throw new Error('用法：pnpm release prepare <major|minor|patch|x.y.z> [--from <提交或标签>] [--dry-run] | pnpm release notes <x.y.z>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : '发布失败');
    process.exitCode = 1;
  });
}
