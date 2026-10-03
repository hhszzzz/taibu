import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { selectTests, requiredPackages, verificationSteps, executeSteps, REPO_ROOT } from '../test-runner.mjs';

const web = 'src/tests/analysis-use-case.test.ts';
const core = 'packages/core/tests/meihua-core.test.mjs';

test('default tests retain application, Core, both MCP adapters and script guards', () => {
  const files = selectTests();
  for (const prefix of ['src/tests/', 'packages/core/tests/', 'packages/mcp/tests/', 'packages/mcp-server/tests/']) {
    assert.ok(files.some(file => file.startsWith(prefix)), prefix);
  }
  assert.ok(files.includes('scripts/tests/architecture-guards.test.mjs'));
  assert.ok(files.includes('scripts/tests/test-runner.test.mjs'));
  assert.ok(!files.some(file => /postgres-contracts|auth-postgrest-acceptance|npm-package-artifacts|skill-bundle|prepare-github-package/.test(file)));
});

test('explicit selection accepts real files and directories without duplicate executions', () => {
  assert.deepEqual(selectTests([web, web]), [web]);
  const directory = selectTests(['src/tests']);
  assert.deepEqual(selectTests(['src/tests', web]), directory);
  assert.ok(directory.includes(web));
});

test('invalid or non-test targets fail rather than silently running an empty suite', () => {
  for (const target of ['src/tests/not-found.test.ts', 'package.json', '../outside.test.ts', 'src/tests/helpers/route-mock.ts', '--unknown']) {
    assert.throws(() => selectTests([target]), /Unknown test target|Not a test file/);
  }
});

test('focused execution builds only the required workspace dependencies in order', () => {
  assert.deepEqual(requiredPackages([web, core]), ['core']);
  assert.deepEqual(requiredPackages(['packages/mcp/tests/stdio.test.mjs']), ['core', 'mcp']);
  assert.deepEqual(requiredPackages(['packages/mcp-server/tests/http.test.mjs']), ['core', 'mcp-server']);
  assert.deepEqual(requiredPackages(['scripts/tests/test-runner.test.mjs']), []);
  assert.deepEqual(requiredPackages(['scripts/tests/skill-bundle.test.mjs']), ['core']);
  assert.deepEqual(requiredPackages(['scripts/tests/auth-postgrest-acceptance.test.mjs']), ['core']);
  assert.deepEqual(requiredPackages(['scripts/tests/npm-package-artifacts.test.mjs']), ['core', 'mcp', 'mcp-server']);
});

test('full verification builds each package once and enforces database and browser gates', () => {
  const steps = verificationSteps([web], true);
  assert.deepEqual(steps.filter(step => step.args[0] === '-C').map(step => step.args[1]), ['packages/core', 'packages/mcp', 'packages/mcp-server']);
  assert.ok(steps.some(step => step.args.includes('tsc')));
  assert.ok(steps.some(step => step.args.includes('next') && step.args.includes('build')));
  for (const file of ['npm-package-artifacts.test.mjs', 'skill-bundle.test.mjs', 'prepare-github-package.test.mjs', 'postgres-contracts.test.mjs', 'auth-postgrest-acceptance.test.mjs', 'p5-browser-fixture.mjs']) {
    assert.ok(steps.some(step => step.args.some(arg => arg.endsWith(file))), file);
  }
  assert.deepEqual(steps.find(step => step.args.includes('scripts/tests/auth-postgrest-acceptance.test.mjs'))?.args,
    ['--require', './scripts/ts-register.cjs', '--test', 'scripts/tests/auth-postgrest-acceptance.test.mjs']);
  assert.ok(!steps.some(step => step.args.some(arg => ['typecheck', 'test', 'test:npm-packages', 'test:auth', 'test:browser'].includes(arg))));
});

test('explicit local Chrome selection changes only the browser executable, not the gates', () => {
  const defaults = verificationSteps([web], true);
  const local = verificationSteps([web], true, true);
  assert.deepEqual(local.slice(0, -1), defaults.slice(0, -1));
  assert.deepEqual(local.at(-1).args, [...defaults.at(-1).args, '--chrome']);
});

test('selected run prepares dependencies before testing and injects the TS loader explicitly', () => {
  const steps = verificationSteps([web]);
  assert.deepEqual(steps.map(step => step.label), ['Build core', 'Unit, route and protocol tests']);
  assert.deepEqual(steps[1].args, ['--require', './scripts/ts-register.cjs', '--test', web]);
});

test('failed steps abort the sequence and cannot report successful verification', () => {
  assert.throws(() => executeSteps([
    { label: 'fixture failure', command: process.execPath, args: ['-e', 'process.exit(7)'] },
    { label: 'must not execute', command: 'nonexistent-command-after-failure', args: [] },
  ]), /fixture failure failed \(exit 7\); remaining steps were not run/);
});

test('CLI rejects mixing full verification with selection before running builds', () => {
  const result = spawnSync(process.execPath, ['scripts/test-runner.mjs', '--verify', web], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not accept selected files/);
  assert.doesNotMatch(result.stdout, /\[verify\]/);
});
