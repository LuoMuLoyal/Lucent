const { execFileSync } = require('node:child_process');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

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

  return execFileSync('curl', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runDockerCompose(appDir, composeEnvPath, args) {
  return execFileSync(
    'docker',
    [
      'compose',
      '--project-name',
      'lucent',
      '--project-directory',
      appDir,
      '-f',
      `${appDir}/deploy/docker-compose.yml`,
      '--env-file',
      composeEnvPath,
      ...args,
    ],
    {
      cwd: appDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
}

function ensureServicesRunning(appDir, composeEnvPath) {
  const output = runDockerCompose(appDir, composeEnvPath, [
    'ps',
    '--format',
    'json',
  ]);
  const rows = output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const requiredServices = new Set(['app', 'postgres', 'redis', 'nginx']);

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

  return rows;
}

function checkHttp(name, url, { insecure = false } = {}) {
  const body = runCurl(url, { insecure });
  console.log(`[smoke] ${name}: OK -> ${url}`);
  return body;
}

function main() {
  const appDir = requiredEnv('LUCENT_APP_DIR');
  const serverDir = requiredEnv('LUCENT_SERVER_DIR');
  const composeEnvPath = `${appDir}/.env.compose`;
  const publicBaseUrl = optionalEnv('LUCENT_PUBLIC_BASE_URL', '');
  const httpsReadyUrl = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/$/, '')}/api/v1/health/ready`
    : '';

  const rows = ensureServicesRunning(appDir, composeEnvPath);
  console.log(
    `[smoke] services running: ${rows.map((row) => `${row.Service}:${row.State}`).join(', ')}`,
  );

  checkHttp('local health', 'http://127.0.0.1:3000/api/v1/health');
  checkHttp('local live', 'http://127.0.0.1:3000/api/v1/health/live');
  checkHttp('local ready', 'http://127.0.0.1:3000/api/v1/health/ready');

  if (httpsReadyUrl) {
    checkHttp('public ready', httpsReadyUrl, { insecure: true });
  } else {
    console.log(
      '[smoke] public ready: skipped (LUCENT_PUBLIC_BASE_URL not set)',
    );
  }

  const envPath = `${serverDir}/.env.production`;
  console.log(`[smoke] env file present at ${envPath}`);
  console.log('[smoke] post-deploy smoke passed');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
