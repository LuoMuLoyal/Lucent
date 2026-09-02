import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(thisDir, '..', '..');
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.dev.yml');

function main() {
  const args = process.argv.slice(2);
  const shouldBuild = args.includes('--build');
  const services = args.filter((arg) => arg !== '--build');
  const targetServices =
    services.length > 0
      ? services
      : ['postgres-dev', 'postgres-test', 'redis', 'seaweedfs'];

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
