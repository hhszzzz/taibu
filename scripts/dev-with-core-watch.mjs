import { spawn } from 'node:child_process';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const nextArgs = process.argv.slice(2);

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
}

function terminate(child, signal = 'SIGTERM') {
  if (child && !child.killed) {
    child.kill(signal);
  }
}

async function waitForExit(child, label) {
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${label} exited with signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function main() {
  const initialBuild = run(PNPM_BIN, ['-C', 'packages/core', 'build']);
  const buildCode = await waitForExit(initialBuild, 'taibu-core build');
  if (buildCode !== 0) {
    process.exit(buildCode);
  }

  const coreWatch = run(PNPM_BIN, ['-C', 'packages/core', 'exec', 'tsc', '--watch', '--preserveWatchOutput']);
  // PDF and Office uploads are parsed in worker threads running this bundle.
  const documentWorkerWatch = run(process.execPath, ['scripts/build-document-worker.mjs', '--watch']);
  const webDev = run(PNPM_BIN, ['exec', 'next', 'dev', ...nextArgs]);

  let shuttingDown = false;
  const shutdown = (signal = 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminate(coreWatch, signal);
    terminate(documentWorkerWatch, signal);
    terminate(webDev, signal);
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });

  for (const child of [coreWatch, documentWorkerWatch, webDev]) {
    child.once('exit', (code, signal) => {
      if (!shuttingDown) {
        shutdown();
        process.exitCode = code ?? (signal ? 1 : 0);
      }
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
