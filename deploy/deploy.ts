/**
 * Lucent Blue-Green Deploy Script
 *
 * Usage:
 *   LUCENT_IMAGE=<image-ref> node deploy.ts          # deploy
 *   node deploy.ts --rollback                         # rollback to previous
 *
 * Prerequisites on the server:
 *   /opt/lucent/
 *   ├── compose.yml
 *   ├── nginx/nginx.conf
 *   ├── .env            (contains COMPOSE_PROJECT_NAME, POSTGRES_PASSWORD, REDIS_PASSWORD, etc.)
 *   ├── .env.previous   (auto-managed by this script, for rollback)
 *   ├── certs/
 *   ├── data/
 *   └── logs/
 *
 * The script reads ACTIVE_SLOT and LUCENT_IMAGE from .env, performs blue-green
 * switching via nginx upstream rewrite + `nginx -s reload`, and runs a smoke
 * test at the end.
 */

const {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
} = require('node:fs');
const path = require('node:path');
const { execSync, spawnSync } = require('node:child_process');

// ── Helpers ────────────────────────────────────────────────────

const DEPLOY_DIR = process.cwd(); // /opt/lucent/

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function ensureFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`${filePath} is missing.`);
  }
}

function ensureDirectories() {
  const dirs = [
    'certs',
    'data/postgresql',
    'data/redis',
    'data/prometheus',
    'data/grafana',
    'logs/app',
    'logs/nginx',
    'nginx',
    'prometheus',
  ];
  for (const dir of dirs) {
    mkdirSync(path.join(DEPLOY_DIR, dir), { recursive: true });
  }
}

// ── .env management ────────────────────────────────────────────

function readEnvFile(envPath) {
  const content = readFileSync(envPath, 'utf8');
  const map = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    map[key] = value;
  }
  return map;
}

function writeEnvFile(envPath, map) {
  const lines = Object.entries(map).map(([key, value]) => `${key}=${value}`);
  writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
}

function getEnvValue(envPath, key) {
  return readEnvFile(envPath)[key] ?? '';
}

function setEnvValue(envPath, key, value) {
  const map = readEnvFile(envPath);
  map[key] = value;
  writeEnvFile(envPath, map);
}

// ── Docker Compose helpers ─────────────────────────────────────

function compose(args, { silent = false } = {}) {
  const cmd = `docker compose ${args.map((a) => `'${a}'`).join(' ')}`;
  try {
    const output = execSync(cmd, {
      cwd: DEPLOY_DIR,
      encoding: 'utf8',
      stdio: silent
        ? ['ignore', 'pipe', 'pipe']
        : ['inherit', 'inherit', 'inherit'],
    });
    return output?.trim() ?? '';
  } catch (err) {
    if (silent) {
      console.error(err.stderr || err.message);
    }
    throw err;
  }
}

function getContainerId(serviceName) {
  try {
    return compose(['ps', '-q', serviceName], { silent: true });
  } catch {
    return '';
  }
}

function inspectHealthStatus(containerId) {
  try {
    return execSync(
      `docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ${containerId}`,
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return 'unknown';
  }
}

function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function waitForService(
  serviceName,
  { maxAttempts = 30, sleepSeconds = 5 } = {},
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const containerId = getContainerId(serviceName);
    if (containerId) {
      const status = inspectHealthStatus(containerId);
      if (status === 'healthy' || status === 'running') {
        console.log(`  ${serviceName} is ${status}.`);
        return;
      }
      if (status === 'unhealthy' || status === 'dead' || status === 'exited') {
        console.error(`  ${serviceName} entered status: ${status}`);
        compose(['logs', '--tail=200', serviceName]);
        throw new Error(`${serviceName} failed to become healthy.`);
      }
    }
    console.log(`  Waiting for ${serviceName} (${attempt}/${maxAttempts})...`);
    sleep(sleepSeconds);
  }
  compose(['logs', '--tail=200', serviceName]);
  throw new Error(`Timed out waiting for ${serviceName}.`);
}

// ── Nginx upstream rewrite ─────────────────────────────────────

const NGINX_CONF_PATH = path.join(DEPLOY_DIR, 'nginx', 'nginx.conf');

function rewriteNginxUpstream(activeSlot) {
  const inactiveSlot = activeSlot === 'blue' ? 'green' : 'blue';
  const conf = readFileSync(NGINX_CONF_PATH, 'utf8');

  // Replace the upstream block — active slot without `down`, inactive with `down`
  const newUpstream = `upstream lucent_app {
    server app-${activeSlot}:3000 max_fails=3 fail_timeout=10s;
    server app-${inactiveSlot}:3000 max_fails=3 fail_timeout=10s down;
    keepalive 32;
  }`;

  const updated = conf.replace(
    /upstream lucent_app \{[\s\S]*?keepalive 32;\s*\}/,
    newUpstream,
  );

  if (updated === conf) {
    throw new Error(
      'Failed to rewrite nginx upstream block — pattern not matched.',
    );
  }

  writeFileSync(NGINX_CONF_PATH, updated, 'utf8');
  console.log(
    `  nginx upstream rewritten: active=${activeSlot}, inactive=${inactiveSlot} (down)`,
  );
}

function reloadNginx() {
  console.log('  Reloading nginx...');
  execSync('docker exec lucent-nginx nginx -s reload', {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['inherit', 'inherit', 'inherit'],
  });
}

// ── Prisma migrate ─────────────────────────────────────────────

function runMigrate(imageRef, postgresPassword) {
  console.log('  Running prisma migrate deploy...');

  const envFile = path.join(DEPLOY_DIR, '.env');
  const projectName =
    getEnvValue(envFile, 'COMPOSE_PROJECT_NAME') || 'lucent-production';
  const networkName = `${projectName}_backend`;

  const databaseUrl = `postgresql://lucent:${postgresPassword}@postgres:5432/lucent?schema=public`;

  execSync(
    [
      'docker run --rm',
      `--network ${networkName}`,
      `--env-file ${envFile}`,
      `-e DATABASE_URL='${databaseUrl}'`,
      '-w /app',
      imageRef,
      './node_modules/.bin/prisma migrate deploy',
    ].join(' '),
    {
      cwd: DEPLOY_DIR,
      encoding: 'utf8',
      stdio: ['inherit', 'inherit', 'inherit'],
    },
  );

  console.log('  Migrate completed.');
}

// ── Deploy ─────────────────────────────────────────────────────

function deploy() {
  const imageRef = requiredEnv('LUCENT_IMAGE');

  console.log('\n=== Lucent Blue-Green Deploy ===');
  console.log(`  Image: ${imageRef}`);

  // 1. Pre-flight checks
  console.log('\n[1/16] Pre-flight checks...');
  ensureFile(path.join(DEPLOY_DIR, 'compose.yml'));
  ensureFile(path.join(NGINX_CONF_PATH));
  ensureFile(path.join(DEPLOY_DIR, '.env'));
  ensureDirectories();

  // 2. Read ACTIVE_SLOT from .env
  console.log('[2/16] Reading ACTIVE_SLOT...');
  const envPath = path.join(DEPLOY_DIR, '.env');
  let activeSlot = getEnvValue(envPath, 'ACTIVE_SLOT') || 'blue';
  const inactiveSlot = activeSlot === 'blue' ? 'green' : 'blue';
  console.log(
    `  Current active: ${activeSlot}, will deploy to: ${inactiveSlot}`,
  );

  const postgresPassword = getEnvValue(envPath, 'POSTGRES_PASSWORD');
  if (!postgresPassword) {
    throw new Error('POSTGRES_PASSWORD not set in .env');
  }

  // 3. Update LUCENT_IMAGE in .env
  console.log('[3/16] Updating LUCENT_IMAGE in .env...');
  setEnvValue(envPath, 'LUCENT_IMAGE', imageRef);

  // 4. Pull infrastructure images
  console.log('[4/16] Pulling infrastructure images...');
  compose(['pull', 'postgres', 'redis', 'nginx']);

  // 5. Start infrastructure
  console.log('[5/16] Starting postgres + redis...');
  compose(['up', '-d', 'postgres', 'redis']);

  // 6. Wait for infrastructure health
  console.log('[6/16] Waiting for postgres + redis...');
  waitForService('postgres');
  waitForService('redis');

  // 7. Run migrate
  console.log('[7/16] Running prisma migrate deploy...');
  runMigrate(imageRef, postgresPassword);

  // 8. Start inactive app slot
  console.log(`[8/16] Starting app-${inactiveSlot}...`);
  compose(['up', '-d', `app-${inactiveSlot}`]);

  // 9. Wait for app health
  console.log(`[9/16] Waiting for app-${inactiveSlot} health...`);
  try {
    waitForService(`app-${inactiveSlot}`);
  } catch (err) {
    console.error(`  app-${inactiveSlot} failed to start. Stopping it.`);
    compose(['stop', `app-${inactiveSlot}`]);
    throw err;
  }

  // 10. Rewrite nginx upstream
  console.log(`[10/16] Rewriting nginx upstream (active=${inactiveSlot})...`);
  rewriteNginxUpstream(inactiveSlot);

  // 11. Start/reload nginx
  const nginxRunning = getContainerId('nginx');
  if (!nginxRunning) {
    console.log('[11/16] Starting nginx (first time)...');
    compose(['up', '-d', 'nginx']);
    waitForService('nginx');
  } else {
    console.log('[11/16] Reloading nginx...');
    reloadNginx();
  }

  // 12. Stop old active slot
  if (activeSlot !== inactiveSlot) {
    const oldSlotRunning = getContainerId(`app-${activeSlot}`);
    if (oldSlotRunning) {
      console.log(`[12/16] Stopping app-${activeSlot} (old active)...`);
      compose(['stop', `app-${activeSlot}`]);
    } else {
      console.log(`[12/16] app-${activeSlot} not running, skipping stop.`);
    }
  } else {
    console.log('[12/16] First deployment, no old slot to stop.');
  }

  // 13. Update ACTIVE_SLOT in .env
  console.log('[13/16] Updating ACTIVE_SLOT...');
  setEnvValue(envPath, 'ACTIVE_SLOT', inactiveSlot);

  // 14. Snapshot .env → .env.previous
  console.log('[14/16] Snapshotting .env → .env.previous...');
  copyFileSync(envPath, path.join(DEPLOY_DIR, '.env.previous'));

  // 15. Run smoke test
  console.log('[15/16] Running smoke test...');
  try {
    runSmokeTest();
  } catch (err) {
    console.error('\n  Smoke test FAILED! Initiating rollback...');
    rollback();
    throw err;
  }

  // 16. Done
  console.log('[16/16] Deploy complete!');
  compose(['ps']);
  console.log(`\n  Active slot: ${inactiveSlot}`);
  console.log(`  Image: ${imageRef}`);
}

// ── Rollback ───────────────────────────────────────────────────

function rollback() {
  console.log('\n=== Rolling back ===');

  const envPath = path.join(DEPLOY_DIR, '.env');
  const prevEnvPath = path.join(DEPLOY_DIR, '.env.previous');

  if (!existsSync(prevEnvPath)) {
    throw new Error('No .env.previous found — cannot rollback.');
  }

  // 1. Read previous state
  const prevEnv = readEnvFile(prevEnvPath);
  const prevImage = prevEnv['LUCENT_IMAGE'];
  const prevActiveSlot = prevEnv['ACTIVE_SLOT'] || 'blue';

  if (!prevImage) {
    throw new Error('.env.previous does not contain LUCENT_IMAGE.');
  }

  console.log(`  Rolling back to image: ${prevImage}`);
  console.log(`  Previous active slot: ${prevActiveSlot}`);

  // 2. Set LUCENT_IMAGE to previous value
  setEnvValue(envPath, 'LUCENT_IMAGE', prevImage);

  // 3. Determine current active slot (to stop later)
  const currentActiveSlot = getEnvValue(envPath, 'ACTIVE_SLOT') || 'blue';
  const rollbackTargetSlot = prevActiveSlot;

  // 4. Start the rollback target slot
  console.log(`  Starting app-${rollbackTargetSlot} with old image...`);
  compose(['up', '-d', `app-${rollbackTargetSlot}`]);

  // 5. Wait for health
  try {
    waitForService(`app-${rollbackTargetSlot}`);
  } catch (err) {
    console.error(
      `  app-${rollbackTargetSlot} failed to start during rollback!`,
    );
    throw err;
  }

  // 6. Rewrite nginx upstream
  rewriteNginxUpstream(rollbackTargetSlot);

  // 7. Reload nginx
  const nginxRunning = getContainerId('nginx');
  if (!nginxRunning) {
    compose(['up', '-d', 'nginx']);
    waitForService('nginx');
  } else {
    reloadNginx();
  }

  // 8. Stop current active slot
  if (currentActiveSlot !== rollbackTargetSlot) {
    const currentRunning = getContainerId(`app-${currentActiveSlot}`);
    if (currentRunning) {
      console.log(`  Stopping app-${currentActiveSlot}...`);
      compose(['stop', `app-${currentActiveSlot}`]);
    }
  }

  // 9. Update ACTIVE_SLOT
  setEnvValue(envPath, 'ACTIVE_SLOT', rollbackTargetSlot);

  console.log('  Rollback complete.');
  compose(['ps']);
}

// ── Smoke test ─────────────────────────────────────────────────

function runSmokeTest() {
  const smokeScriptPath = path.join(DEPLOY_DIR, 'smoke.ts');
  if (!existsSync(smokeScriptPath)) {
    console.log('  smoke.ts not found, skipping smoke test.');
    return;
  }

  const result = spawnSync('node', [smokeScriptPath], {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env },
  });

  if (result.status !== 0) {
    throw new Error('Smoke test failed.');
  }

  console.log('  Smoke test passed.');
}

// ── Main ───────────────────────────────────────────────────────

try {
  const isRollback = process.argv.includes('--rollback');
  if (isRollback) {
    rollback();
  } else {
    deploy();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
