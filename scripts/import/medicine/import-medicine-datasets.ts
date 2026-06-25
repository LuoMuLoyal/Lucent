const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const IMPORT_SCRIPT = path.join(
  REPO_ROOT,
  'scripts',
  'import',
  'medicine',
  'import-medicine-knowledge.ts',
);

const VALID_COMMANDS = new Set([
  'all',
  'cn-products',
  'cn-leaflets',
  'cn-product-leaflet-links',
  'drugbank-drugs',
  'drugbank-links',
  'drugbank-targets-all',
  'drugbank-targets-active',
]);

const VALID_NODE_ENVS = new Set(['development', 'test', 'production']);

function main() {
  const rawArgs = process.argv.slice(2);
  let command = 'all';
  let nodeEnv = 'development';
  const passthroughArgs = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const part = rawArgs[index];
    if (part === '--command') {
      command = rawArgs[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (part === '--node-env') {
      nodeEnv = rawArgs[index + 1] ?? '';
      index += 1;
      continue;
    }

    passthroughArgs.push(part);
  }

  if (!VALID_COMMANDS.has(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    throw new Error(`Unsupported NODE_ENV: ${nodeEnv}`);
  }

  const importOrder =
    command === 'all'
      ? [
          'drugbank-drugs',
          'drugbank-links',
          'drugbank-targets-all',
          'drugbank-targets-active',
          'cn-leaflets',
          'cn-products',
          'cn-product-leaflet-links',
        ]
      : [command];

  for (const importCommand of importOrder) {
    console.log(`Importing ${importCommand} with NODE_ENV=${nodeEnv}...`);
    const result = spawnSync(
      'node',
      [IMPORT_SCRIPT, importCommand, ...passthroughArgs],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NODE_ENV: nodeEnv,
        },
        stdio: 'inherit',
      },
    );

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
