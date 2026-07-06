#!/usr/bin/env node

const path = require('node:path');
const fs = require('node:fs');
const { Client } = require('pg');

const { loadEnvironment, REPO_ROOT } = require('../../shared/env');
const {
  executeUpsert,
  startImportRun,
  finishImportRun,
  parsePositiveIntegerOption,
  parseArgs,
  streamParseAndUpsert,
} = require('../../shared/db-upsert');

const DATA_ROOT = path.resolve(REPO_ROOT, '..', 'DrugDataBase');
const IMPORT_RUNS_TABLE = 'food_composition_imports';

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

  const importRunId = await startImportRun(
    client,
    IMPORT_RUNS_TABLE,
    config,
    sourcePath,
    {
      sourceVersion:
        cliOptions['source-version'] !== undefined
          ? String(cliOptions['source-version'])
          : null,
      withHash: cliOptions['with-hash'] === true,
    },
  );

  const summary = {
    status: 'completed',
    rawRowCount: 0,
    importedRowCount: 0,
    rejectedRowCount: 0,
    rejectionSummary: null,
    note: `Imported with NODE_ENV=${nodeEnv}`,
  };
  const batchSize = parsePositiveIntegerOption(
    cliOptions['batch-size'] ?? 100,
    '--batch-size',
  );

  try {
    const limit =
      cliOptions.limit !== undefined
        ? parsePositiveIntegerOption(cliOptions.limit, '--limit')
        : undefined;

    const flushBatch = async (batch) => {
      if (batch.length === 0) {
        return;
      }

      const normalizedBatch = batch.map((record) => ({
        ...record,
        import_run_id: importRunId,
      }));
      summary.importedRowCount += await executeUpsert(
        client,
        config,
        normalizedBatch,
      );
    };

    const stats = await streamParseAndUpsert(
      config,
      sourcePath,
      { limit, batchSize },
      flushBatch,
    );

    summary.rawRowCount = stats.rawRowCount;
    summary.rejectedRowCount = stats.rejectedRowCount;
    summary.rejectionSummary =
      stats.rejectionSamples.length > 0
        ? { sample: stats.rejectionSamples }
        : null;
  } catch (error) {
    summary.status = 'failed';
    summary.rejectionSummary = { sample: [] };
    summary.note =
      error instanceof Error ? error.message : 'Unknown import failure';
    throw error;
  } finally {
    await finishImportRun(client, IMPORT_RUNS_TABLE, importRunId, summary);
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
