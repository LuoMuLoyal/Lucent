import { existsSync } from 'node:fs';

const requiredPaths = [
  'docker-compose.yml',
  'monitoring/prometheus/prometheus.yml',
  'monitoring/grafana/provisioning',
  'monitoring/grafana/dashboards',
  'monitoring/synthetic-checker/synthetic-checker.mjs',
  'scripts/deploy/deploy-server.sh',
  'scripts/deploy/sync-deploy-assets.sh',
  'deploy/nginx/nginx.conf',
];

for (const path of requiredPaths) {
  if (!existsSync(path)) {
    console.error(`Missing deploy asset: ${path}`);
    process.exit(1);
  }
}

console.log('Deploy assets look complete.');
