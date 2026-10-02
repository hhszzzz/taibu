import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIRECTORIES = ['src/tests', 'packages/core/tests', 'packages/mcp/tests', 'packages/mcp-server/tests'];
const SCRIPT_TESTS = ['scripts/tests/architecture-guards.test.mjs', 'scripts/tests/test-runner.test.mjs'];
const ARTIFACT_TESTS = [
  'scripts/tests/npm-package-artifacts.test.mjs',
  'scripts/tests/skill-bundle.test.mjs',
  'scripts/tests/prepare-github-package.test.mjs',
];
const PACKAGE_ORDER = ['core', 'mcp', 'mcp-server'];
const isTest = name => /\.test\.(?:ts|mjs)$/.test(name);

function testsIn(directory) {
  return readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true })
    .filter(entry => entry.isFile() && isTest(entry.name))
    .map(entry => `${directory}/${entry.name}`);
}

/** Explicit files or test directories; never guess affected tests from Git state. */
export function selectTests(targets = []) {
  if (!targets.length) return [...TEST_DIRECTORIES.flatMap(testsIn), ...SCRIPT_TESTS].sort();
  const files = targets.flatMap(target => {
    const relative = path.relative(REPO_ROOT, path.resolve(REPO_ROOT, target)).split(path.sep).join('/');
    const allowed = [...TEST_DIRECTORIES, 'scripts/tests'].some(directory => relative === directory || relative.startsWith(`${directory}/`));
    if (!allowed || !existsSync(path.join(REPO_ROOT, relative))) {
      throw new Error(`Unknown test target: ${target}. Pass existing test files or test directories.`);
    }
    if (statSync(path.join(REPO_ROOT, relative)).isDirectory()) return testsIn(relative);
    if (!isTest(relative)) throw new Error(`Not a test file: ${target}`);
    return [relative];
  });
  if (!files.length) throw new Error('No tests selected; refusing an empty successful run.');
  return [...new Set(files)].sort();
}

/** Current workspace dependency graph; focused Web tests need Core, not MCP builds. */
export function requiredPackages(files) {
  const required = new Set();
  for (const file of files) {
    if (file.startsWith('src/tests/') || file.startsWith('packages/') || file.endsWith('/skill-bundle.test.mjs')) required.add('core');
    if (file.startsWith('packages/mcp/tests/')) required.add('mcp');
    if (file.startsWith('packages/mcp-server/tests/')) required.add('mcp-server');
    if (file.endsWith('/npm-package-artifacts.test.mjs') || file.endsWith('/prepare-github-package.test.mjs')) {
      PACKAGE_ORDER.forEach(name => required.add(name));
    }
  }
  return PACKAGE_ORDER.filter(name => required.has(name));
}

const nodeStep = (label, args) => ({ label, command: process.execPath, args });
const pnpmStep = (label, args) => ({ label, command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args });
const unitStep = files => nodeStep('Unit, route and protocol tests', ['--require', './scripts/ts-register.cjs', '--test', ...files]);

/** One explicit sequence: no prepared/stale-dist bypass flag on public test commands. */
export function verificationSteps(files, complete = false, useInstalledChrome = false) {
  const packages = complete ? PACKAGE_ORDER : requiredPackages(files);
  const builds = packages.map(name => pnpmStep(`Build ${name}`, ['-C', `packages/${name}`, 'build']));
  if (!complete) return [...builds, unitStep(files)];
  return [
    ...builds,
    pnpmStep('Lint and architecture', ['lint']),
    pnpmStep('Strict application types', ['exec', 'tsc', '--noEmit', '--incremental', 'false']),
    unitStep(files),
    pnpmStep('Next production build', ['exec', 'next', 'build']),
    nodeStep('Package, license and Skill artifacts', ['--test', ...ARTIFACT_TESTS]),
    nodeStep('Isolated PostgreSQL contracts', ['--test', 'scripts/tests/postgres-contracts.test.mjs']),
    nodeStep('Offline browser component contracts', ['scripts/tests/p5-browser-fixture.mjs', ...(useInstalledChrome ? ['--chrome'] : [])]),
  ];
}

export function executeSteps(steps) {
  for (const { label, command, args } of steps) {
    console.log(`\n[verify] ${label}`);
    const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${label} failed (${result.signal ?? `exit ${result.status}`}); remaining steps were not run.`);
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2).filter(arg => arg !== '--');
    const complete = args[0] === '--verify';
    const useInstalledChrome = complete && args[1] === '--chrome';
    if (complete && args.length !== (useInstalledChrome ? 2 : 1)) throw new Error('--verify runs every validation layer and does not accept selected files (only --chrome is supported).');
    const files = selectTests(complete ? [] : args);
    executeSteps(verificationSteps(files, complete, useInstalledChrome));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
