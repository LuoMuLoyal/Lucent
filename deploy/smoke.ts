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

function runCurl(url, { insecure = false, headers = [] } = {}) {
  const args = ['-fsS'];
  if (insecure) {
    args.push('-k');
  }
  for (const header of headers) {
    args.push('-H', header);
  }
  args.push(url);

  return execSync(`curl ${args.map((a) => `'${a}'`).join(' ')}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runCurlStatus(url, { insecure = false, headers = [] } = {}) {
  const args = ['-so', '/dev/null', '-w', '%{http_code}'];
  if (insecure) {
    args.push('-k');
  }
  for (const header of headers) {
    args.push('-H', header);
  }
  args.push(url);

  return parseInt(
    execSync(`curl ${args.map((a) => `'${a}'`).join(' ')}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
    10,
  );
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

function checkHttp(name, url, { insecure = false, headers = [] } = {}) {
  const body = runCurl(url, { insecure, headers });
  console.log(`[smoke] ${name}: OK -> ${url}`);
  return body;
}

function main() {
  const publicBaseUrl = optionalEnv('LUCENT_PUBLIC_BASE_URL', '');
  const httpsReadyUrl = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/$/, '')}/api/v1/health/ready`
    : '';
  const metricsUser = optionalEnv('METRICS_USER', '');
  const metricsPassword = optionalEnv('METRICS_PASSWORD', '');

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

  // 3. /metrics security checks (through Nginx — should be blocked)
  const metricsStatus = runCurlStatus('http://127.0.0.1/metrics');
  if (metricsStatus === 403) {
    console.log(`[smoke] /metrics blocked by Nginx: OK (${metricsStatus})`);
  } else {
    console.warn(
      `[smoke] /metrics through Nginx returned ${metricsStatus} (expected 403)`,
    );
  }

  // 4. /metrics auth check (direct to app container, bypassing Nginx)
  //    Only run if METRICS_USER/METRICS_PASSWORD are configured
  if (metricsUser && metricsPassword) {
    const metricsUrl = 'http://127.0.0.1:3000/metrics';
    const noAuthStatus = runCurlStatus(metricsUrl);
    if (noAuthStatus === 401) {
      console.log(
        `[smoke] /metrics without auth rejected: OK (${noAuthStatus})`,
      );
    } else {
      throw new Error(
        `/metrics without auth returned ${noAuthStatus} (expected 401)`,
      );
    }

    const authHeader = `Authorization: Basic ${Buffer.from(`${metricsUser}:${metricsPassword}`).toString('base64')}`;
    const authedBody = runCurl(metricsUrl, { headers: [authHeader] });
    if (authedBody.includes('lucent_')) {
      console.log('[smoke] /metrics with auth: OK (metrics returned)');
    } else {
      throw new Error('/metrics with auth did not return expected metrics');
    }
  } else {
    console.log(
      '[smoke] /metrics auth check: skipped (METRICS_USER/METRICS_PASSWORD not set)',
    );
  }

  // 5. Public HTTPS check (if configured)
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
