const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PID_FILE = path.join(REPO_ROOT, '.runtime-test.pid');
const LOG_FILE = path.join(REPO_ROOT, '.runtime-test.log');
const HEALTH_URL = 'http://127.0.0.1:3000/api/v1/health';
const TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 500;

function stopExistingProcess() {
  if (!fs.existsSync(PID_FILE)) {
    return;
  }

  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 'SIGTERM');
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

  const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
  const child = spawn('pnpm', ['start:test:dev'], {
    cwd: REPO_ROOT,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.unref();

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

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
