const { existsSync } = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

const requiredPaths = [
  'deploy/docker-compose.yml',
  'deploy/deploy-server.ts',
  'deploy/nginx/nginx.conf',
];

for (const relativePath of requiredPaths) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    console.error(`Missing deploy asset: ${relativePath}`);
    process.exit(1);
  }
}

console.log('Deploy assets look complete.');
