import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(thisDir, '..', '..');
const COMPOSE_FILE = path.join(REPO_ROOT, 'compose.dev.yaml');

const DEFAULT_SERVICES = [
  'postgres-dev',
  'postgres-test',
  'redis',
  'seaweedfs',
];
const RNACOS_SERVICE = 'rnacos';
const RNACOS_PASSWORD_ENV = 'RNACOS_CONSOLE_PASSWORD';

/**
 * `rnacos` is profile-gated and never part of the default stack. Compose cannot
 * require the console password without breaking every other command (variables
 * are interpolated whether or not the service's profile is active), so the
 * requirement is enforced here, on the path that actually starts it.
 */
function assertRnacosCredentials(services: readonly string[]): void {
  if (!services.includes(RNACOS_SERVICE)) {
    return;
  }
  const password = process.env[RNACOS_PASSWORD_ENV];
  if (password !== undefined && password.trim().length > 0) {
    return;
  }
  console.error(
    `${RNACOS_SERVICE} needs its console password: export ${RNACOS_PASSWORD_ENV}='<password>'`,
  );
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const shouldBuild = args.includes('--build');
  const services = args.filter((arg) => arg !== '--build');
  const targetServices = services.length > 0 ? services : DEFAULT_SERVICES;

  assertRnacosCredentials(targetServices);

  const dockerArgs = [
    'compose',
    '-f',
    COMPOSE_FILE,
    'up',
    '-d',
    '--remove-orphans',
  ];
  if (shouldBuild) {
    dockerArgs.push('--build');
  }
  dockerArgs.push(...targetServices);

  const result = spawnSync('docker', dockerArgs, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
