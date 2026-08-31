/**
 * Lucent Single-Slot Deploy Script
 *
 * Usage:
 *   LUCENT_IMAGE=<image-ref> node deploy.ts          # deploy (15–45s downtime)
 *   node deploy.ts --rollback                        # rollback to previous image
 *
 * Prerequisites on the server:
 *   /opt/lucent/
 *   ├── compose.yml
 *   ├── nginx/nginx.conf
 *   ├── .env            (contains COMPOSE_PROJECT_NAME, POSTGRES_PASSWORD, REDIS_PASSWORD, etc.)
 *   ├── .env.previous   (auto-managed by this script, for rollback)
 *   ├── certs/
 *   ├── data/           (incl. data/backups — pre-deploy pg_dump snapshots + daily backups)
 *   └── logs/
 *
 * Strategy: single app slot with planned downtime (~15–45s per release).
 * The app container is stopped, the DB schema is migrated, then the new
 * container is started and health-gated. .env is snapshotted to
 * .env.previous BEFORE any modification so rollback always finds the
 * previous image. After the app container is recreated, nginx is reloaded
 * to re-resolve the cached upstream container IP (otherwise 502s).
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  chmodSync,
  statSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

// ── Helpers ────────────────────────────────────────────────────

const DEPLOY_DIR = process.cwd(); // /opt/lucent/
const NGINX_CONF_PATH = path.join(DEPLOY_DIR, 'nginx', 'nginx.conf');
const DB_BACKUP_KEEP = 10;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function ensureFile(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`${filePath} is missing.`);
  }
}

function ensureDirectories(): void {
  const dirs = [
    'certs',
    'data/postgresql',
    'data/redis',
    'data/victoriametrics',
    'data/victorialogs',
    'data/grafana',
    'data/backups',
    'data/alertmanager',
    'data/node-exporter-textfile',
    'logs/app',
    'logs/nginx',
    'nginx',
    'victoriametrics/rules',
    'alertmanager',
  ];
  for (const dir of dirs) {
    mkdirSync(path.join(DEPLOY_DIR, dir), { recursive: true });
  }
}

/**
 * Render VictoriaMetrics/alertmanager configs from .env via render-configs.sh.
 * Best-effort: monitoring is not on the deploy critical path, so a render
 * failure only warns (VM keeps running with its previous config).
 */
function runRenderConfigs(): void {
  const scriptPath = path.join(DEPLOY_DIR, 'render-configs.sh');
  if (!existsSync(scriptPath)) {
    console.log('  render-configs.sh not found, skipping config render.');
    return;
  }
  const result = spawnSync('sh', [scriptPath], {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    console.warn(
      '  WARNING: render-configs.sh failed — VictoriaMetrics/alertmanager configs may be stale. Continuing deploy.',
    );
  }
}

/**
 * JPush credential precheck (0.1.0 release gate, best-effort).
 * Reads JPUSH_APP_KEY / JPUSH_MASTER_SECRET from .env. Missing credentials
 * only warn loudly — push stays silently disabled and the deploy proceeds;
 * the release gate itself is enforced via docs/howto/deploy.md.
 */
function checkJpushConfig(): void {
  const envPath = path.join(DEPLOY_DIR, '.env');
  const appKey = getEnvValue(envPath, 'JPUSH_APP_KEY');
  const masterSecret = getEnvValue(envPath, 'JPUSH_MASTER_SECRET');
  if (!appKey || !masterSecret) {
    console.warn(
      '  WARNING: JPush 未配置，推送静默禁用；只配其中一项会导致应用启动失败。0.1.0 发布门槛要求 `JPUSH_APP_KEY`/`JPUSH_MASTER_SECRET` 已配齐并经真机验证。',
    );
    return;
  }
  console.log(
    '  JPush configured: JPUSH_APP_KEY / JPUSH_MASTER_SECRET present in .env.',
  );
}

// ── .env management ────────────────────────────────────────────

function readEnvFile(envPath: string): Record<string, string> {
  const content = readFileSync(envPath, 'utf8');
  const map: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding matching quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

/**
 * Write .env lines verbatim, then tighten permissions to 600
 * (best-effort — chmod is unsupported on Windows and ignored there).
 */
function writeEnvFile(envPath: string, lines: string[]): void {
  writeFileSync(envPath, lines.join('\n'), 'utf8');
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Ignore — e.g. on Windows hosts where chmod is not supported.
  }
}

function getEnvValue(envPath: string, key: string): string {
  return readEnvFile(envPath)[key] ?? '';
}

/**
 * Line-level in-place update: rewrite the line starting with `KEY=` to
 * `KEY=value` and keep every other line (comments, blank lines, unrelated
 * keys) exactly as-is. If the key is absent, append it at the end.
 */
function setEnvValue(envPath: string, key: string, value: string): void {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const prefix = `${key}=`;
  let replaced = false;
  const updated = lines.map((line) => {
    if (!replaced && line.startsWith(prefix)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    // Insert before the trailing empty line so EOF keeps a single newline.
    if (updated.length > 0 && updated[updated.length - 1] === '') {
      updated.splice(updated.length - 1, 0, `${key}=${value}`);
    } else {
      updated.push(`${key}=${value}`);
    }
  }
  writeEnvFile(envPath, updated);
}

// ── Deploy event notification (WeCom group-bot webhook) ───────

/**
 * Best-effort notification via a WeCom group-bot webhook
 * (WECOM_WEBHOOK_URL in .env; unset = notifications disabled).
 * Never throws and never blocks the deploy outcome.
 */
function notifyDeploy(message: string): void {
  const webhookUrl = getEnvValue(
    path.join(DEPLOY_DIR, '.env'),
    'WECOM_WEBHOOK_URL',
  );
  if (!webhookUrl) return;
  try {
    const payload = JSON.stringify({
      msgtype: 'text',
      text: { content: `[Lucent] ${message}` },
    });
    spawnSync(
      'curl',
      [
        '-sS',
        '--max-time',
        '10',
        '-X',
        'POST',
        '-H',
        'Content-Type: application/json',
        '-d',
        payload,
        webhookUrl,
      ],
      { cwd: DEPLOY_DIR, stdio: ['ignore', 'ignore', 'ignore'] },
    );
  } catch {
    // Best-effort: notification failure must not affect the deploy.
  }
}

// ── Docker Compose helpers ─────────────────────────────────────

function compose(args: string[], { silent = false } = {}): string {
  try {
    const result = spawnSync('docker', ['compose', ...args], {
      cwd: DEPLOY_DIR,
      encoding: 'utf8',
      stdio: silent
        ? ['ignore', 'pipe', 'pipe']
        : ['inherit', 'inherit', 'inherit'],
    });
    if (result.status !== 0) {
      if (silent && result.stderr) {
        console.error(result.stderr);
      }
      throw new Error(
        `docker compose ${args.join(' ')} exited with code ${result.status}`,
      );
    }
    return result.stdout?.trim() ?? '';
  } catch (err) {
    if (silent) {
      console.error(
        (err as { stderr?: string; message: string }).stderr ||
          (err as Error).message,
      );
    }
    throw err;
  }
}

function getContainerId(serviceName: string): string {
  try {
    return compose(['ps', '-q', serviceName], { silent: true });
  } catch {
    return '';
  }
}

function inspectHealthStatus(containerId: string): string {
  try {
    return execSync(
      `docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' ${containerId}`,
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return 'unknown';
  }
}

function sleep(seconds: number): void {
  execSync(`sleep ${seconds}`);
}

function waitForService(
  serviceName: string,
  { maxAttempts = 30, sleepSeconds = 5 } = {},
): void {
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

// ── Nginx reload ───────────────────────────────────────────────
// The nginx upstream resolves `app` to a container IP at config-load time
// and caches it. After the app container is recreated (new IP), nginx MUST
// be reloaded or every proxied request 502s.

function reloadNginx(): void {
  console.log('  Reloading nginx...');
  execSync('docker exec lucent-nginx nginx -s reload', {
    cwd: DEPLOY_DIR,
    encoding: 'utf8',
    stdio: ['inherit', 'inherit', 'inherit'],
  });
}

// ── Prisma migrate ─────────────────────────────────────────────

function runMigrate(imageRef: string, postgresPassword: string): void {
  console.log('  Running prisma migrate deploy...');

  const envFile = path.join(DEPLOY_DIR, '.env');
  const projectName =
    getEnvValue(envFile, 'COMPOSE_PROJECT_NAME') || 'lucent-production';
  const networkName = `${projectName}_backend`;

  const databaseUrl = `postgresql://lucent:${encodeURIComponent(postgresPassword)}@postgres:5432/lucent?schema=public`;

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

// ── Pre-deploy DB snapshot ─────────────────────────────────────

/**
 * Dump the database to data/backups/pre-deploy-<UTC timestamp>.sql.gz and
 * keep only the newest DB_BACKUP_KEEP snapshots. Runs BEFORE the app is
 * stopped — if the dump fails the deploy aborts with zero downtime.
 */
function snapshotDatabase(): void {
  const backupDir = path.join(DEPLOY_DIR, 'data', 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `pre-deploy-${timestamp}.sql.gz`;
  const filePath = path.join(backupDir, fileName);

  try {
    execSync(
      `set -o pipefail && docker exec lucent-postgres pg_dump -U lucent -d lucent | gzip > "${filePath}"`,
      { cwd: DEPLOY_DIR, shell: '/bin/bash' },
    );
    if (statSync(filePath).size === 0) {
      throw new Error('snapshot file is empty');
    }
  } catch (err) {
    rmSync(filePath, { force: true });
    throw new Error(
      `Pre-deploy DB snapshot failed — aborting deploy (app is still running, no impact): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  console.log(`  DB snapshot written: data/backups/${fileName}`);

  // Retain only the newest DB_BACKUP_KEEP snapshots (ISO timestamps sort by time)
  const backups = readdirSync(backupDir)
    .filter((name) => /^pre-deploy-.*\.sql\.gz$/.test(name))
    .sort();
  const excess = backups.length - DB_BACKUP_KEEP;
  for (const name of backups.slice(0, Math.max(excess, 0))) {
    rmSync(path.join(backupDir, name));
    console.log(`  Pruned old snapshot: ${name}`);
  }
}

// ── Restore previous image ─────────────────────────────────────

/**
 * Best-effort restore after a failed health gate / smoke test: print the
 * failed container's logs (before it is recreated), point .env back at the
 * previous image and bring it up. Note: prisma migrate may already have
 * advanced the DB schema — the previous image must tolerate that.
 */
function restorePreviousImage(envPath: string, previousImage: string): void {
  if (!previousImage) {
    console.error(
      '  No previous image recorded — cannot restore automatically.',
    );
    return;
  }
  console.error('  Recent logs from the failed container:');
  try {
    compose(['logs', '--tail=200', 'app']);
  } catch {
    console.error('  (could not read app logs)');
  }
  console.error(`  Restoring previous image: ${previousImage}`);
  console.error('  Note: DB schema may already have been migrated forward.');
  setEnvValue(envPath, 'LUCENT_IMAGE', previousImage);
  try {
    compose(['up', '-d', 'app']);
    waitForService('app');
    console.error('  Previous image restored and healthy.');
  } catch (restoreErr) {
    console.error(
      '  Restore FAILED — manual intervention required:',
      restoreErr,
    );
  }
}

// ── Deploy ─────────────────────────────────────────────────────

function deploy(): void {
  const imageRef = requiredEnv('LUCENT_IMAGE');

  console.log('\n=== Lucent Single-Slot Deploy ===');
  console.log(`  Image: ${imageRef}`);
  console.log('  Note: single-slot deploy — expect ~15–45s downtime.');

  // 1. Pre-flight checks
  console.log('\n[1/12] Pre-flight checks...');
  ensureFile(path.join(DEPLOY_DIR, 'compose.yml'));
  ensureFile(NGINX_CONF_PATH);
  ensureFile(path.join(DEPLOY_DIR, '.env'));
  ensureDirectories();
  runRenderConfigs();
  checkJpushConfig();

  // 2. Read current LUCENT_IMAGE as rollback target
  console.log('[2/12] Reading current image (rollback target)...');
  const envPath = path.join(DEPLOY_DIR, '.env');
  const previousImage = getEnvValue(envPath, 'LUCENT_IMAGE');
  if (!previousImage) {
    console.log('  No previous LUCENT_IMAGE recorded — first deployment.');
  } else if (previousImage === imageRef) {
    console.log('  New image matches current image — redeploying.');
  } else {
    console.log(`  Previous image: ${previousImage}`);
  }

  const postgresPassword = getEnvValue(envPath, 'POSTGRES_PASSWORD');
  if (!postgresPassword) {
    throw new Error('POSTGRES_PASSWORD not set in .env');
  }

  // 3. Snapshot .env BEFORE any modification (source for rollback)
  console.log('[3/12] Snapshotting .env → .env.previous...');
  copyFileSync(envPath, path.join(DEPLOY_DIR, '.env.previous'));

  // 4. Pull + start infrastructure
  console.log('[4/12] Pulling infra images, starting postgres + redis...');
  compose(['pull', 'postgres', 'redis', 'nginx']);
  compose(['up', '-d', 'postgres', 'redis']);
  waitForService('postgres');
  waitForService('redis');

  // 5. Pre-deploy DB snapshot (abort on failure — app still running)
  console.log('[5/12] Taking pre-deploy DB snapshot...');
  snapshotDatabase();

  // 6. Stop app — downtime window starts
  console.log('[6/12] Stopping app (downtime starts)...');
  try {
    compose(['stop', 'app']);
  } catch {
    console.log('  app was not running — continuing.');
  }

  // 7. Run migrate with the new image (app stopped, .env still on old image)
  console.log('[7/12] Running prisma migrate deploy...');
  try {
    runMigrate(imageRef, postgresPassword);
  } catch (err) {
    console.error('  Migrate failed — restarting previous app version...');
    try {
      compose(['up', '-d', 'app']);
      waitForService('app');
      console.error('  Previous app version restored.');
    } catch (restoreErr) {
      console.error('  Failed to restart previous app:', restoreErr);
    }
    throw err;
  }

  // 8. Point .env at the new image
  console.log('[8/12] Updating LUCENT_IMAGE in .env...');
  setEnvValue(envPath, 'LUCENT_IMAGE', imageRef);

  // 9. Start app + health gate
  console.log('[9/12] Starting app, waiting for health...');
  try {
    compose(['up', '-d', 'app']);
    waitForService('app');
  } catch (err) {
    console.error('  New app failed to become healthy.');
    restorePreviousImage(envPath, previousImage);
    throw err;
  }

  // 10. nginx: reload to re-resolve the upstream IP (or start if not running)
  const nginxRunning = getContainerId('nginx');
  if (!nginxRunning) {
    console.log('[10/12] Starting nginx (first time)...');
    compose(['up', '-d', 'nginx']);
    waitForService('nginx');
  } else {
    console.log('[10/12] Reloading nginx (re-resolve app upstream IP)...');
    reloadNginx();
  }

  // 11. Smoke test
  console.log('[11/12] Running smoke test...');
  try {
    runSmokeTest();
  } catch (err) {
    console.error('  Smoke test FAILED!');
    restorePreviousImage(envPath, previousImage);
    throw err;
  }

  // 12. Done
  console.log('[12/12] Deploy complete!');
  compose(['ps']);
  console.log(`\n  Image: ${imageRef}`);
}

// ── Rollback ───────────────────────────────────────────────────

function rollback(): void {
  console.log('\n=== Lucent Rollback (single slot) ===');

  const envPath = path.join(DEPLOY_DIR, '.env');
  const prevEnvPath = path.join(DEPLOY_DIR, '.env.previous');

  if (!existsSync(prevEnvPath)) {
    throw new Error('No .env.previous found — cannot rollback.');
  }

  const prevImage = getEnvValue(prevEnvPath, 'LUCENT_IMAGE');
  if (!prevImage) {
    throw new Error('.env.previous does not contain LUCENT_IMAGE.');
  }
  console.log(`  Rolling back to image: ${prevImage}`);

  // 1. Point .env back at the previous image
  console.log('[1/5] Restoring LUCENT_IMAGE in .env...');
  setEnvValue(envPath, 'LUCENT_IMAGE', prevImage);

  // 2. Stop current app
  console.log('[2/5] Stopping app...');
  try {
    compose(['stop', 'app']);
  } catch {
    console.log('  app was not running — continuing.');
  }

  // 3. Start app with the previous image + health gate
  console.log('[3/5] Starting app with previous image...');
  compose(['up', '-d', 'app']);
  waitForService('app');

  // 4. nginx: reload to re-resolve the upstream IP (or start if not running)
  const nginxRunning = getContainerId('nginx');
  if (!nginxRunning) {
    console.log('[4/5] Starting nginx...');
    compose(['up', '-d', 'nginx']);
    waitForService('nginx');
  } else {
    console.log('[4/5] Reloading nginx...');
    reloadNginx();
  }

  // 5. Smoke test
  console.log('[5/5] Running smoke test...');
  runSmokeTest();

  console.log('  Rollback complete.');
  console.log(
    '  注意：数据库 schema 未回退（prisma migrate 只前进，不后退）。',
  );
  notifyDeploy(`已回滚至镜像 ${prevImage}（schema 未回退）。`);
  compose(['ps']);
}

// ── Smoke test ─────────────────────────────────────────────────

function runSmokeTest(): void {
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
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  notifyDeploy(
    `${process.argv.includes('--rollback') ? '回滚' : '发布'}失败：${message}`,
  );
  process.exit(1);
}
