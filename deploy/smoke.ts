/**
 * Lucent Post-Deploy Smoke Test
 *
 * Checks:
 *   1. All compose services are running (postgres, redis, nginx, app)
 *   2. Local health endpoints through Nginx (port 80)
 *   3. /metrics blocked by Nginx (403)
 *   4. /metrics Basic Auth via docker exec inside the app container
 *   5. If LUCENT_PUBLIC_BASE_URL is set, public HTTPS health/ready
 *
 * Single-slot deploy: the app container is always `lucent-app`. Its port
 * (3000) is NOT exposed to the host, so direct /metrics auth checks use
 * `docker exec` to run curl inside the container.
 */

import { execSync, spawnSync } from 'node:child_process';

const DEPLOY_DIR = process.cwd();

interface ComposeServiceRow {
  Service: string;
  State: string;
}

interface CurlOptions {
  insecure?: boolean;
  headers?: string[];
}

function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function runCurl(url: string, opts: CurlOptions = {}): string {
  const args = ['-fsS'];
  if (opts.insecure) {
    args.push('-k');
  }
  for (const header of opts.headers ?? []) {
    args.push('-H', header);
  }
  args.push(url);

  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`curl failed with code ${result.status}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function runCurlStatus(url: string, opts: CurlOptions = {}): number {
  const args = ['-so', '/dev/null', '-w', '%{http_code}'];
  if (opts.insecure) {
    args.push('-k');
  }
  for (const header of opts.headers ?? []) {
    args.push('-H', header);
  }
  args.push(url);

  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`curl failed with code ${result.status}: ${result.stderr}`);
  }
  return parseInt(result.stdout.trim(), 10);
}

/**
 * Run curl inside an app container via `docker exec` to check endpoints
 * that are not exposed to the host (port 3000 is internal-only).
 */
function runCurlInContainer(
  containerName: string,
  url: string,
  opts: CurlOptions = {},
): string {
  const args = ['-fsS'];
  if (opts.insecure) {
    args.push('-k');
  }
  for (const header of opts.headers ?? []) {
    args.push('-H', header);
  }
  args.push(url);

  const result = spawnSync('docker', ['exec', containerName, 'curl', ...args], {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `docker exec curl failed with code ${result.status}: ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function runCurlStatusInContainer(
  containerName: string,
  url: string,
  opts: CurlOptions = {},
): number {
  const args = ['-so', '/dev/null', '-w', '%{http_code}'];
  if (opts.insecure) {
    args.push('-k');
  }
  for (const header of opts.headers ?? []) {
    args.push('-H', header);
  }
  args.push(url);

  const result = spawnSync('docker', ['exec', containerName, 'curl', ...args], {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `docker exec curl failed with code ${result.status}: ${result.stderr}`,
    );
  }
  return parseInt(result.stdout.trim(), 10);
}

function ensureServicesRunning(): {
  rows: ComposeServiceRow[];
  appContainer: string;
} {
  const output = execSync('docker compose ps --format json', {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  const rows = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ComposeServiceRow);

  const requiredServices = ['postgres', 'redis', 'nginx', 'app'];

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

  // Single-slot deploy: the app container name is fixed
  return { rows, appContainer: 'lucent-app' };
}

function checkHttp(name: string, url: string, opts: CurlOptions = {}): string {
  const body = runCurl(url, opts);
  console.log(`[smoke] ${name}: OK -> ${url}`);
  return body;
}

function main(): void {
  const publicBaseUrl = optionalEnv('LUCENT_PUBLIC_BASE_URL', '');
  const httpsReadyUrl = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/$/, '')}/api/v1/health/ready`
    : '';
  const metricsUser = optionalEnv('METRICS_USER', '');
  const metricsPassword = optionalEnv('METRICS_PASSWORD', '');

  // 1. Check services
  const { rows, appContainer } = ensureServicesRunning();
  console.log(
    `[smoke] services running: ${rows.map((row) => `${row.Service}:${row.State}`).join(', ')}`,
  );
  console.log(`[smoke] active app container: ${appContainer}`);

  // 2. Local health checks through Nginx (port 80)
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

  // 4. /metrics auth check via docker exec inside the app container
  //    The app container port (3000) is not exposed to the host,
  //    so we use `docker exec` to run curl inside the container.
  if (metricsUser && metricsPassword) {
    const metricsUrl = 'http://127.0.0.1:3000/metrics';
    const noAuthStatus = runCurlStatusInContainer(appContainer, metricsUrl);
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
    const authedBody = runCurlInContainer(appContainer, metricsUrl, {
      headers: [authHeader],
    });
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
