const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PID_FILE = path.join(REPO_ROOT, '.runtime-test.pid');

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
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped process ${String(pid)}.`);
  } catch (error) {
    console.warn(
      `Failed to stop process ${String(pid)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    fs.rmSync(PID_FILE, { force: true });
  }
}

main();
