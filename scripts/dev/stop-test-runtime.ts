import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(thisDir, '..', '..');
const PID_FILE = path.join(REPO_ROOT, '.runtime-test.pid');
const IS_WINDOWS = process.platform === 'win32';

function main() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('Lucent test runtime is not running.');
    return;
  }

  const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    fs.rmSync(PID_FILE, { force: true });
    console.log('Removed invalid runtime pid file.');
    return;
  }

  try {
    stopProcessTree(pid);
    console.log(`Stopped process tree rooted at ${String(pid)}.`);
  } catch (error) {
    console.warn(
      `Failed to stop process ${String(pid)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    fs.rmSync(PID_FILE, { force: true });
  }
}

function stopProcessTree(pid) {
  if (IS_WINDOWS) {
    const result = spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error(
        `taskkill exited with code ${String(result.status ?? 1)}`,
      );
    }

    return;
  }

  process.kill(-pid, 'SIGTERM');
}

main();
