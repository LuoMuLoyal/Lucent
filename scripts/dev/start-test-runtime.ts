const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PID_FILE = path.join(REPO_ROOT, '.runtime-test.pid');
const LOG_FILE = path.join(REPO_ROOT, '.runtime-test.log');
const HEALTH_URL = 'http://127.0.0.1:3000/api/v1/health';
const TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 500;
const IS_WINDOWS = process.platform === 'win32';
const PNPM_COMMAND = IS_WINDOWS ? 'pnpm.cmd' : 'pnpm';
const SHELL_COMMAND = process.env.ComSpec ?? 'cmd.exe';

function stopExistingProcess() {
  if (!fs.existsSync(PID_FILE)) {
    return;
  }

  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      stopProcessTree(pid);
    } catch {
      // Ignore stale pid files.
    }
  }

  fs.rmSync(PID_FILE, { force: true });
}

async function waitForHealth() {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(HEALTH_URL);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Lucent test runtime did not become healthy within ${String(TIMEOUT_MS / 1000)}s. See ${LOG_FILE}`,
  );
}

async function main() {
  stopExistingProcess();
  applyTestMigrations();

  const logFd = fs.openSync(LOG_FILE, 'w');
  const command = IS_WINDOWS
    ? (process.env.ComSpec ?? 'cmd.exe')
    : PNPM_COMMAND;
  const args = IS_WINDOWS
    ? ['/d', '/s', '/c', 'pnpm start:test:dev']
    : ['start:test:dev'];

  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  child.unref();
  fs.closeSync(logFd);

  fs.writeFileSync(PID_FILE, `${String(child.pid)}\n`, 'utf8');

  try {
    await waitForHealth();
    console.log(`Lucent test runtime is ready. pid=${String(child.pid)}`);
  } catch (error) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // Ignore if already exited.
    }
    fs.rmSync(PID_FILE, { force: true });
    throw error;
  }
}

function stopProcessTree(pid) {
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  process.kill(-pid, 'SIGTERM');
}

function applyTestMigrations() {
  const result = IS_WINDOWS
    ? spawnSync(
        SHELL_COMMAND,
        ['/d', '/s', '/c', 'pnpm exec prisma migrate deploy'],
        {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            NODE_ENV: 'test',
          },
          stdio: 'inherit',
        },
      )
    : spawnSync(PNPM_COMMAND, ['exec', 'prisma', 'migrate', 'deploy'], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NODE_ENV: 'test',
        },
        stdio: 'inherit',
      });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
