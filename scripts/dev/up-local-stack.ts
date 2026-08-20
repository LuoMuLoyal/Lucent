const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
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
