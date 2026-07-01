#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const dotenv = require('dotenv');
const { Client } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_ROOT = path.resolve(REPO_ROOT, '..', 'DrugDataBase');

const COMMANDS = {
  categories: {
    parser: path.join(__dirname, 'parsers', 'food_categories.py'),
    defaultSourcePath: path.join(
      DATA_ROOT,
      '中国食物成分表',
      '中国食物成分表.xlsx',
    ),
    sourceKey: 'food_composition_categories',
    sourceName: 'china_food_composition_categories',
    tableName: 'food_composition_categories',
    columns: [
      'code',
      'import_run_id',
      'source_row_number',
      'parent_code',
      'name',
      'level',
      'search_text',
    ],
    conflictColumns: ['code'],
    updateColumns: [
      'import_run_id',
      'source_row_number',
      'parent_code',
      'name',
      'level',
      'search_text',
    ],
  },
  items: {
    parser: path.join(__dirname, 'parsers', 'food_items.py'),
    defaultSourcePath: path.join(
      DATA_ROOT,
      '中国食物成分表',
      '中国食物成分表.xlsx',
    ),
    sourceKey: 'food_composition_items',
    sourceName: 'china_food_composition_items',
    tableName: 'food_composition_items',
    columns: [
      'id',
      'import_run_id',
      'source_row_number',
      'source_serial_number',
      'name',
      'normalized_name',
      'search_text',
      'aliases',
      'primary_category_code',
      'secondary_category_code',
      'edible_portion_percent',
      'water_g',
      'energy_kcal',
      'energy_kj',
      'protein_g',
      'fat_g',
      'carbohydrate_g',
      'fiber_g',
      'cholesterol_mg',
      'calcium_mg',
      'phosphorus_mg',
      'potassium_mg',
      'sodium_mg',
      'magnesium_mg',
      'iron_mg',
      'zinc_mg',
      'selenium_mg',
      'copper_mg',
      'manganese_mg',
      'iodine_mg',
      'vitamin_a_mcg_re',
      'thiamin_mg',
      'riboflavin_mg',
      'vitamin_b6_mg',
      'vitamin_b12_mg',
      'folate_ug',
      'niacin_mg',
      'vitamin_c_mg',
      'vitamin_e_mg',
      'carotene_mcg',
      'retinol_mcg',
      'alpha_vitamin_e_mg',
      'extras',
    ],
    conflictColumns: ['id'],
    updateColumns: [
      'import_run_id',
      'source_row_number',
      'source_serial_number',
      'name',
      'normalized_name',
      'search_text',
      'aliases',
      'primary_category_code',
      'secondary_category_code',
      'edible_portion_percent',
      'water_g',
      'energy_kcal',
      'energy_kj',
      'protein_g',
      'fat_g',
      'carbohydrate_g',
      'fiber_g',
      'cholesterol_mg',
      'calcium_mg',
      'phosphorus_mg',
      'potassium_mg',
      'sodium_mg',
      'magnesium_mg',
      'iron_mg',
      'zinc_mg',
      'selenium_mg',
      'copper_mg',
      'manganese_mg',
      'iodine_mg',
      'vitamin_a_mcg_re',
      'thiamin_mg',
      'riboflavin_mg',
      'vitamin_b6_mg',
      'vitamin_b12_mg',
      'folate_ug',
      'niacin_mg',
      'vitamin_c_mg',
      'vitamin_e_mg',
      'carotene_mcg',
      'retinol_mcg',
      'alpha_vitamin_e_mg',
      'extras',
    ],
  },
};

function loadEnvironment() {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  dotenv.config({
    path: path.join(REPO_ROOT, `.env.${nodeEnv}.local`),
    override: true,
  });
  dotenv.config({
    path: path.join(REPO_ROOT, `.env.${nodeEnv}`),
    override: true,
  });

  return nodeEnv;
}

function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith('--')) {
      args._.push(part);
      continue;
    }

    const key = part.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/import/food/import-food-composition.ts <command> [options]

Commands:
  categories
  items

Options:
  --source <path>       Override the default source file path.
  --batch-size <n>      Number of records per upsert batch. Default: 100
  --limit <n>           Parse only the first N records (useful for smoke tests).
  --source-version <v>  Store the export/version string in food_composition_imports.
  --with-hash           Compute SHA-256 for the source file and store it.
`);
}

function parsePositiveIntegerOption(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

function normalizeValue(value) {
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function sqlIdentifier(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildUpsertStatement(spec, rowCount) {
  const placeholders = [];
  const valuesPerRow = spec.columns.length;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowPlaceholders = spec.columns.map((_, columnIndex) => {
      const parameterIndex = rowIndex * valuesPerRow + columnIndex + 1;
      return `$${String(parameterIndex)}`;
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const updateAssignments = spec.updateColumns.map(
    (column) => `${sqlIdentifier(column)} = EXCLUDED.${sqlIdentifier(column)}`,
  );

  return `
    INSERT INTO ${sqlIdentifier(spec.tableName)} (${spec.columns
      .map(sqlIdentifier)
      .join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (${spec.conflictColumns.map(sqlIdentifier).join(', ')})
    DO UPDATE SET
      ${updateAssignments.join(', ')},
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

async function executeUpsert(client, spec, records) {
  if (records.length === 0) {
    return 0;
  }

  const sql = buildUpsertStatement(spec, records.length);
  const params = records.flatMap((record) =>
    spec.columns.map((column) => normalizeValue(record[column])),
  );

  await client.query(sql, params);
  return records.length;
}

async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function startImportRun(client, config, filePath, options) {
  const sourceStats = await fs.promises.stat(filePath);
  const importRunId = crypto.randomUUID();

  await client.query(
    `
      INSERT INTO "food_composition_imports" (
        "id",
        "source_key",
        "source_name",
        "source_version",
        "source_file_name",
        "source_file_hash",
        "source_exported_at",
        "status"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
    `,
    [
      importRunId,
      config.sourceKey,
      config.sourceName,
      options.sourceVersion ?? null,
      path.basename(filePath),
      options.withHash ? await computeFileHash(filePath) : null,
      sourceStats.mtime.toISOString(),
    ],
  );

  return importRunId;
}

async function finishImportRun(client, importRunId, summary) {
  await client.query(
    `
      UPDATE "food_composition_imports"
      SET
        "status" = $2,
        "raw_row_count" = $3,
        "imported_row_count" = $4,
        "rejected_row_count" = $5,
        "rejection_summary" = $6,
        "note" = $7,
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = $1
    `,
    [
      importRunId,
      summary.status,
      summary.rawRowCount,
      summary.importedRowCount,
      summary.rejectedRowCount,
      summary.rejectionSummary,
      summary.note ?? null,
    ],
  );
}

function createParserArgs(config, sourcePath, options) {
  const parserArgs = [config.parser, '--source-path', sourcePath];
  if (options.limit !== undefined) {
    parserArgs.push('--limit', String(options.limit));
  }
  return parserArgs;
}

function collectRejectionSample(samples, rejection) {
  if (samples.length >= 10) {
    return;
  }

  samples.push({
    rowNumber: rejection.rowNumber ?? null,
    message: rejection.message,
  });
}

async function runImport(command, cliOptions) {
  const config = COMMANDS[command];
  if (!config) {
    printUsage();
    throw new Error(`Unknown command: ${command}`);
  }

  const nodeEnv = loadEnvironment();
  const sourcePath = path.resolve(
    cliOptions.source ? String(cliOptions.source) : config.defaultSourcePath,
  );

  await fs.promises.access(sourcePath, fs.constants.R_OK);

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured for the current NODE_ENV');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const importRunId = await startImportRun(client, config, sourcePath, {
    sourceVersion:
      cliOptions['source-version'] !== undefined
        ? String(cliOptions['source-version'])
        : null,
    withHash: cliOptions['with-hash'] === true,
  });

  const summary = {
    status: 'completed',
    rawRowCount: 0,
    importedRowCount: 0,
    rejectedRowCount: 0,
    rejectionSummary: null,
    note: `Imported with NODE_ENV=${nodeEnv}`,
  };
  const rejectionSamples = [];
  const batchSize = parsePositiveIntegerOption(
    cliOptions['batch-size'] ?? 100,
    '--batch-size',
  );
  let currentBatch = [];

  try {
    const parserArgs = createParserArgs(config, sourcePath, {
      limit:
        cliOptions.limit !== undefined
          ? parsePositiveIntegerOption(cliOptions.limit, '--limit')
          : undefined,
    });

    const child = spawn('python', parserArgs, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const childExit = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    const stdout = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const flushBatch = async () => {
      if (currentBatch.length === 0) {
        return;
      }

      const normalizedBatch = currentBatch.map((record) => ({
        ...record,
        import_run_id: importRunId,
      }));
      summary.importedRowCount += await executeUpsert(
        client,
        config,
        normalizedBatch,
      );
      currentBatch = [];
    };

    for await (const line of stdout) {
      if (!line.trim()) {
        continue;
      }

      const payload = JSON.parse(line);
      summary.rawRowCount += 1;

      if (payload.kind === 'error') {
        summary.rejectedRowCount += 1;
        collectRejectionSample(rejectionSamples, payload);
        continue;
      }

      if (payload.kind !== 'record') {
        summary.rejectedRowCount += 1;
        collectRejectionSample(rejectionSamples, {
          rowNumber: null,
          message: `Unsupported payload kind: ${String(payload.kind)}`,
        });
        continue;
      }

      currentBatch.push(payload.data);
      if (currentBatch.length >= batchSize) {
        await flushBatch();
      }
    }

    await flushBatch();

    const exitCode = await childExit;
    if (exitCode !== 0) {
      throw new Error(`Parser exited with code ${String(exitCode)}`);
    }

    summary.rejectionSummary =
      rejectionSamples.length > 0 ? { sample: rejectionSamples } : null;
  } catch (error) {
    summary.status = 'failed';
    summary.rejectionSummary = { sample: rejectionSamples };
    summary.note =
      error instanceof Error ? error.message : 'Unknown import failure';
    throw error;
  } finally {
    await finishImportRun(client, importRunId, summary);
    await client.end();
  }

  console.log(
    JSON.stringify(
      {
        command,
        sourcePath,
        importRunId,
        rawRowCount: summary.rawRowCount,
        importedRowCount: summary.importedRowCount,
        rejectedRowCount: summary.rejectedRowCount,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const command = argv._[0];
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    await runImport(command, argv);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Import script failed',
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
