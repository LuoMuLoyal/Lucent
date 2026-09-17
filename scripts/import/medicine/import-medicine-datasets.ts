import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(thisDir, '..', '..', '..');
const IMPORT_SCRIPT = path.join(
  REPO_ROOT,
  'scripts',
  'import',
  'medicine',
  'import-medicine-knowledge.ts',
);

const VALID_COMMANDS = new Set([
  'all',
  'cn-v3-products',
  'cn-v3-leaflets',
  'cn-v3-product-leaflet-links',
  'drugbank-drugs',
  'drugbank-links',
  'drugbank-targets-all',
  'drugbank-targets-active',
  'drugbank-target-proteins',
  'drugbank-target-genes',
  'drugbank-drug-sequences',
  'drugbank-structures',
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
          // Sequences last: drug sequences hold a foreign key onto
          // `drugbank_drugs`, so the drugs must exist first.
          'drugbank-target-proteins',
          'drugbank-target-genes',
          'drugbank-drug-sequences',
          'drugbank-structures',
          // V3 (deduplicated) is the default Chinese source. V3 cn-v3-*
          // commands are the sole CN import path; V2 commands were removed.
          'cn-v3-leaflets',
          'cn-v3-products',
          'cn-v3-product-leaflet-links',
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
