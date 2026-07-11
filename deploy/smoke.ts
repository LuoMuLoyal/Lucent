/**
 * Lucent Post-Deploy Smoke Test
 *
 * Checks:
 *   1. All compose services are running (via docker compose ps)
 *   2. Local health endpoints through Nginx (port 80/443)
 *   3. If LUCENT_PUBLIC_BASE_URL is set, public HTTPS health/ready
 *
 * The app container port (3000) is NOT exposed to the host, so all
 * health checks go through Nginx on port 80 or 443.
 */

const { execSync } = require('node:child_process');

const DEPLOY_DIR = process.cwd();

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function runCurl(url, { insecure = false } = {}) {
  const args = ['-fsS'];
  if (insecure) {
    args.push('-k');
  }
  args.push(url);

  return execSync(`curl ${args.map((a) => `'${a}'`).join(' ')}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function ensureServicesRunning() {
  const output = execSync('docker compose ps --format json', {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  const rows = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  // Only check services that should be running.
  // app-blue or app-green — at least one must be running.
  const requiredServices = ['postgres', 'redis', 'nginx'];

  for (const service of requiredServices) {
    const row = rows.find((item) => item.Service === service);
    if (!row) {
      throw new Error(`Missing running compose service: ${service}`);
    }

    const state = String(row.State || '').toLowerCase();
    if (!state.includes('running')) {
      throw new Error(`Service ${service} is not running: ${row.State}`);
    }
  }

  // At least one app slot must be running
  const appBlue = rows.find((item) => item.Service === 'app-blue');
  const appGreen = rows.find((item) => item.Service === 'app-green');
  if (
    (!appBlue ||
      !String(appBlue.State || '')
        .toLowerCase()
        .includes('running')) &&
    (!appGreen ||
      !String(appGreen.State || '')
        .toLowerCase()
        .includes('running'))
  ) {
    throw new Error('Neither app-blue nor app-green is running.');
  }

  return rows;
}

function checkHttp(name, url, { insecure = false } = {}) {
  const body = runCurl(url, { insecure });
  console.log(`[smoke] ${name}: OK -> ${url}`);
  return body;
}

function main() {
  const publicBaseUrl = optionalEnv('LUCENT_PUBLIC_BASE_URL', '');
  const httpsReadyUrl = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/$/, '')}/api/v1/health/ready`
    : '';

  // 1. Check services
  const rows = ensureServicesRunning();
  console.log(
    `[smoke] services running: ${rows.map((row) => `${row.Service}:${row.State}`).join(', ')}`,
  );

  // 2. Local health checks through Nginx (HTTP → 301 redirect to HTTPS is expected for /,
  //    but /api/v1/health should be proxied directly on port 80 or 443)
  //    Use HTTP port 80 for local checks (nginx proxies to app regardless of TLS)
  checkHttp('local health', 'http://127.0.0.1/api/v1/health');
  checkHttp('local live', 'http://127.0.0.1/api/v1/health/live');
  checkHttp('local ready', 'http://127.0.0.1/api/v1/health/ready');

  // 3. Public HTTPS check (if configured)
  if (httpsReadyUrl) {
    checkHttp('public ready', httpsReadyUrl, { insecure: true });
  } else {
    console.log(
      '[smoke] public ready: skipped (LUCENT_PUBLIC_BASE_URL not set)',
    );
  }

  console.log('[smoke] post-deploy smoke passed');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
