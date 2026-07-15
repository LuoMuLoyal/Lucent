#!/usr/bin/env node

const path = require('node:path');
const { Client } = require('pg');

const { loadEnvironment, REPO_ROOT } = require('../../shared/env');
const { stableUuid } = require('../../shared/stable-id');
const {
  executeUpsert,
  startImportRun,
  finishImportRun,
  parsePositiveIntegerOption,
  parseArgs,
  streamParseAndUpsert,
} = require('../../shared/db-upsert');

// Re-export for backwards compatibility (rebuild scripts + tests depend on these)
module.exports = {
  invalidateMedicineCache,
  listMedicineCacheKeys,
  redisStoreFromUrl,
  stableUuid,
  stripNamespacePrefix,
};

const DATA_ROOT = path.resolve(REPO_ROOT, '..', 'DrugDataBase');
const MEDICINES_CACHE_KEY_PREFIX = 'medicines';
const IMPORT_RUNS_TABLE = 'drug_source_imports';

const COMMANDS = {
  'cn-products': {
    parser: path.join(__dirname, 'parsers', 'cn_products.py'),
    defaultSourcePath: path.join(
      DATA_ROOT,
      'ChineseDrugData_Master_V2',
      'ChineseDrugData_Master_V2.xlsx',
    ),
    sourceKey: 'cn_products',
    sourceName: 'chinese_drug_data_master_v2',
    tableName: 'cn_medicine_products',
    columns: [
      'id',
      'import_run_id',
      'source_name',
      'source_row_number',
      'name',
      'image_url',
      'price_text',
      'package_spec',
      'approval_number',
      'manufacturer',
      'drug_type',
      'main_category',
      'subcategory',
      'source_url',
      'brand_name',
      'ingredients',
      'properties',
      'indications',
      'dosage',
      'adverse_reactions',
      'contraindications',
      'precautions',
      'pediatric_use',
      'geriatric_use',
      'pregnancy_lactation',
      'pharmacology_toxicology',
      'drug_interactions',
      'pharmacokinetics',
      'overdose',
      'storage',
      'validity_period',
      'barcode',
      'national_drug_code',
      'image_url_cleaned',
      'manufacturer_normalized',
      'approval_codes',
      'best_match_type',
      'best_match_score',
      'top_candidate_ids',
      'top_candidate_scores',
      'candidate_count',
      'match_quality_overall',
      'match_quality_approval',
      'match_quality_name',
      'match_quality_maker',
      'match_quality_leaflet',
      'match_quality_penalty',
      'match_quality_notes',
      'search_text',
      'extras',
    ],
    conflictColumns: ['id'],
    updateColumns: [
      'import_run_id',
      'source_name',
      'source_row_number',
      'name',
      'image_url',
      'price_text',
      'package_spec',
      'approval_number',
      'manufacturer',
      'drug_type',
      'main_category',
      'subcategory',
      'source_url',
      'brand_name',
      'ingredients',
      'properties',
      'indications',
      'dosage',
      'adverse_reactions',
      'contraindications',
      'precautions',
      'pediatric_use',
      'geriatric_use',
      'pregnancy_lactation',
      'pharmacology_toxicology',
      'drug_interactions',
      'pharmacokinetics',
      'overdose',
      'storage',
      'validity_period',
      'barcode',
      'national_drug_code',
      'image_url_cleaned',
      'manufacturer_normalized',
      'approval_codes',
      'best_match_type',
      'best_match_score',
      'top_candidate_ids',
      'top_candidate_scores',
      'candidate_count',
      'match_quality_overall',
      'match_quality_approval',
      'match_quality_name',
      'match_quality_maker',
      'match_quality_leaflet',
      'match_quality_penalty',
      'match_quality_notes',
      'search_text',
      'extras',
    ],
  },
  'cn-leaflets': {
    parser: path.join(__dirname, 'parsers', 'cn_leaflets.py'),
    defaultSourcePath: path.join(
      DATA_ROOT,
      'ChineseDrugData_Master_V2',
      'ChineseDrugData_Master_V2.xlsx',
    ),
    sourceKey: 'cn_leaflets',
    sourceName: 'chinese_drug_data_master_v2_leaflets',
    tableName: 'cn_medicine_leaflets',
    columns: [
      'id',
      'import_run_id',
      'instruction_id',
      'source_file',
      'source_row',
      'title',
      'title_url',
      'number_raw',
      'summary',
      'generic_name',
      'brand_name',
      'pinyin',
      'approval_raw',
      'approval_codes',
      'approval_conflict',
      'drug_category',
      'manufacturer',
      'manufacturer_normalized',
      'drug_nature',
      'related_diseases',
      'properties',
      'ingredients',
      'indications',
      'package_spec',
      'adverse_reactions',
      'dosage',
      'contraindications',
      'precautions',
      'pregnancy_lactation',
      'pediatric_use',
      'geriatric_use',
      'drug_interactions',
      'pharmacology_toxicology',
      'pharmacokinetics',
      'storage',
      'validity_period',
      'merge_notes',
      'dropped_reason',
    ],
    conflictColumns: ['id'],
    updateColumns: [
      'import_run_id',
      'instruction_id',
      'source_file',
      'source_row',
      'title',
      'title_url',
      'number_raw',
      'summary',
      'generic_name',
      'brand_name',
      'pinyin',
      'approval_raw',
      'approval_codes',
      'approval_conflict',
      'drug_category',
      'manufacturer',
      'manufacturer_normalized',
      'drug_nature',
      'related_diseases',
      'properties',
      'ingredients',
      'indications',
      'package_spec',
      'adverse_reactions',
      'dosage',
      'contraindications',
      'precautions',
      'pregnancy_lactation',
      'pediatric_use',
      'geriatric_use',
      'drug_interactions',
      'pharmacology_toxicology',
      'pharmacokinetics',
      'storage',
      'validity_period',
      'merge_notes',
      'dropped_reason',
    ],
  },
  'cn-product-leaflet-links': {
    parser: path.join(__dirname, 'parsers', 'cn_product_leaflet_links.py'),
    defaultSourcePath: path.join(
      DATA_ROOT,
      'ChineseDrugData_Master_V2',
      'ChineseDrugData_Master_V2.xlsx',
    ),
    sourceKey: 'cn_product_leaflet_links',
    sourceName: 'chinese_drug_data_master_v2_product_leaflet_links',
    tableName: 'cn_medicine_product_leaflet_links',
    columns: [
      'id',
      'import_run_id',
      'product_id',
      'leaflet_id',
      'approval_code',
      'match_type',
      'match_score',
      'is_best_match',
    ],
    conflictColumns: ['id'],
    updateColumns: [
      'import_run_id',
      'product_id',
      'leaflet_id',
      'approval_code',
      'match_type',
      'match_score',
      'is_best_match',
    ],
  },
  'drugbank-drugs': {
    parser: path.join(__dirname, 'parsers', 'drugbank_drugs.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'full database.xml'),
    sourceKey: 'drugbank_drugs',
    sourceName: 'drugbank_full_database_xml',
    tableName: 'drugbank_drugs',
    columns: [
      'drugbank_id',
      'import_run_id',
      'secondary_drugbank_ids',
      'drug_type',
      'source_created_at',
      'source_updated_at',
      'name',
      'description',
      'cas_number',
      'unii',
      'state',
      'groups',
      'indication',
      'pharmacodynamics',
      'mechanism_of_action',
      'toxicity',
      'metabolism',
      'absorption',
      'half_life',
      'protein_binding',
      'route_of_elimination',
      'volume_of_distribution',
      'clearance',
      'classification',
      'synonyms',
      'products',
      'international_brands',
      'categories',
      'atc_codes',
      'food_interactions',
      'drug_interactions',
      'external_identifiers',
      'external_links',
      'search_text',
    ],
    conflictColumns: ['drugbank_id'],
    updateColumns: [
      'import_run_id',
      'secondary_drugbank_ids',
      'drug_type',
      'source_created_at',
      'source_updated_at',
      'name',
      'description',
      'cas_number',
      'unii',
      'state',
      'groups',
      'indication',
      'pharmacodynamics',
      'mechanism_of_action',
      'toxicity',
      'metabolism',
      'absorption',
      'half_life',
      'protein_binding',
      'route_of_elimination',
      'volume_of_distribution',
      'clearance',
      'classification',
      'synonyms',
      'products',
      'international_brands',
      'categories',
      'atc_codes',
      'food_interactions',
      'drug_interactions',
      'external_identifiers',
      'external_links',
      'search_text',
    ],
  },
  'drugbank-links': {
    parser: path.join(__dirname, 'parsers', 'drugbank_external_links.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'drug links.csv'),
    sourceKey: 'drugbank_external_links',
    sourceName: 'drugbank_drug_links_csv',
    tableName: 'drugbank_external_links',
    columns: [
      'id',
      'import_run_id',
      'drugbank_id',
      'drug_name',
      'cas_number',
      'drug_type',
      'kegg_compound_id',
      'kegg_drug_id',
      'pubchem_compound_id',
      'pubchem_substance_id',
      'chebi_id',
      'pharmgkb_id',
      'het_id',
      'uniprot_id',
      'uniprot_title',
      'genbank_id',
      'dpd_id',
      'rxlist_link',
      'pdrhealth_link',
      'wikipedia_id',
      'drugs_com_link',
      'ndc_id',
    ],
    conflictColumns: ['id'],
    updateColumns: [
      'import_run_id',
      'drugbank_id',
      'drug_name',
      'cas_number',
      'drug_type',
      'kegg_compound_id',
      'kegg_drug_id',
      'pubchem_compound_id',
      'pubchem_substance_id',
      'chebi_id',
      'pharmgkb_id',
      'het_id',
      'uniprot_id',
      'uniprot_title',
      'genbank_id',
      'dpd_id',
      'rxlist_link',
      'pdrhealth_link',
      'wikipedia_id',
      'drugs_com_link',
      'ndc_id',
    ],
  },
  'drugbank-targets-all': {
    parser: path.join(__dirname, 'parsers', 'drugbank_targets.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'all.csv'),
    sourceKey: 'drugbank_targets_all',
    sourceName: 'drugbank_all_targets_csv',
    sourceDataset: 'all',
    mode: 'targets',
    tableName: 'drugbank_targets',
    columns: [
      'id',
      'import_run_id',
      'source_dataset',
      'source_target_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
    conflictColumns: ['source_dataset', 'source_target_id'],
    updateColumns: [
      'import_run_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
  },
  'drugbank-targets-active': {
    parser: path.join(__dirname, 'parsers', 'drugbank_targets.py'),
    defaultSourcePath: path.join(
      DATA_ROOT,
      'unziped',
      'pharmacologically_active.csv',
    ),
    sourceKey: 'drugbank_targets_pharmacologically_active',
    sourceName: 'drugbank_pharmacologically_active_targets_csv',
    sourceDataset: 'pharmacologically_active',
    mode: 'targets',
    tableName: 'drugbank_targets',
    columns: [
      'id',
      'import_run_id',
      'source_dataset',
      'source_target_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
    conflictColumns: ['source_dataset', 'source_target_id'],
    updateColumns: [
      'import_run_id',
      'name',
      'gene_name',
      'genbank_protein_id',
      'genbank_gene_id',
      'uniprot_id',
      'uniprot_title',
      'pdb_ids',
      'gene_card_id',
      'gen_atlas_id',
      'hgnc_id',
      'species',
    ],
  },
};

function printUsage() {
  console.log(`Usage:
  node scripts/import/medicine/import-medicine-knowledge.ts <command> [options]

Commands:
  cn-products
  cn-leaflets
  cn-product-leaflet-links
  drugbank-drugs
  drugbank-links
  drugbank-targets-all
  drugbank-targets-active

Options:
  --source <path>       Override the default source file path.
  --batch-size <n>      Number of records per upsert batch. Default: 100
  --limit <n>           Parse only the first N records (useful for smoke tests).
  --source-version <v>  Store the export/version string in drug_source_imports.
  --with-hash           Compute SHA-256 for the source file and store it in drug_source_imports.
`);
}

// ─── Redis cache invalidation (medicine-specific) ─────────────

async function redisStoreFromUrl(redisUrl) {
  const { redisStore } = require('cache-manager-ioredis-yet');
  const url = new URL(redisUrl);

  return redisStore({
    host: url.hostname,
    port: Number(url.port) || 6379,
    password: url.password || undefined,
    db: url.pathname ? Number(url.pathname.slice(1)) || 0 : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  });
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function stripNamespacePrefix(key, namespacePrefix) {
  if (!namespacePrefix || !key.startsWith(namespacePrefix)) {
    return key;
  }
  return key.slice(namespacePrefix.length);
}

async function listMedicineCacheKeys(store, namespace = 'keyv') {
  const namespacePrefix = namespace ? `${namespace}:` : null;
  const patterns = namespacePrefix
    ? [
        `${namespacePrefix}${MEDICINES_CACHE_KEY_PREFIX}:*`,
        `${MEDICINES_CACHE_KEY_PREFIX}:*`,
      ]
    : [`${MEDICINES_CACHE_KEY_PREFIX}:*`];
  const matchedKeys = [];

  for (const pattern of patterns) {
    const keys = await store.keys(pattern);
    for (const key of keys) {
      const normalizedKey = stripNamespacePrefix(key, namespacePrefix);
      if (normalizedKey.startsWith(`${MEDICINES_CACHE_KEY_PREFIX}:`)) {
        matchedKeys.push(normalizedKey);
      }
    }
  }

  return uniqueStrings(matchedKeys);
}

async function invalidateMedicineCache() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return { invalidated: 0, skipped: 'REDIS_URL is not configured' };
  }

  const store = await redisStoreFromUrl(redisUrl);

  try {
    const keys = await listMedicineCacheKeys(store);
    if (keys.length === 0) {
      return { invalidated: 0 };
    }

    await Promise.all(keys.map((key) => store.del(key)));
    return { invalidated: keys.length };
  } finally {
    store.client.disconnect();
  }
}

// ─── Target-specific batch execution ──────────────────────────

async function queryTargetIdMap(client, sourceDataset, sourceTargetIds) {
  if (sourceTargetIds.length === 0) {
    return new Map();
  }

  const result = await client.query(
    `
      SELECT "id", "source_target_id"
      FROM "drugbank_targets"
      WHERE "source_dataset" = $1
        AND "source_target_id" = ANY($2::text[])
    `,
    [sourceDataset, sourceTargetIds],
  );

  return new Map(result.rows.map((row) => [row.source_target_id, row.id]));
}

async function executeTargetBatch(client, spec, importRunId, records) {
  if (records.length === 0) {
    return 0;
  }

  const normalizedTargets = records.map((record) => ({
    id: stableUuid(
      'drugbank_target',
      spec.sourceDataset,
      record.source_target_id,
    ),
    import_run_id: importRunId,
    source_dataset: spec.sourceDataset,
    source_target_id: record.source_target_id,
    name: record.name,
    gene_name: record.gene_name,
    genbank_protein_id: record.genbank_protein_id,
    genbank_gene_id: record.genbank_gene_id,
    uniprot_id: record.uniprot_id,
    uniprot_title: record.uniprot_title,
    pdb_ids: record.pdb_ids,
    gene_card_id: record.gene_card_id,
    gen_atlas_id: record.gen_atlas_id,
    hgnc_id: record.hgnc_id,
    species: record.species,
  }));

  await client.query('BEGIN');

  try {
    const upsertedTargetCount = await executeUpsert(
      client,
      spec,
      normalizedTargets,
    );

    const sourceTargetIds = normalizedTargets.map(
      (target) => target.source_target_id,
    );
    const targetIdMap = await queryTargetIdMap(
      client,
      spec.sourceDataset,
      sourceTargetIds,
    );

    const relationRecords = [];
    for (const record of records) {
      const targetId = targetIdMap.get(record.source_target_id);
      if (!targetId) {
        continue;
      }

      for (const drugbankId of record.drugbank_ids ?? []) {
        relationRecords.push({
          id: stableUuid(
            'drugbank_drug_target',
            spec.sourceDataset,
            record.source_target_id,
            drugbankId,
          ),
          drugbank_id: drugbankId,
          target_id: targetId,
          relation_kind: spec.sourceDataset,
          actions: record.actions ?? null,
          known_action: record.known_action ?? null,
        });
      }
    }

    await executeUpsert(
      client,
      {
        tableName: 'drugbank_drug_targets',
        columns: [
          'id',
          'drugbank_id',
          'target_id',
          'relation_kind',
          'actions',
          'known_action',
        ],
        conflictColumns: ['drugbank_id', 'target_id', 'relation_kind'],
        updateColumns: ['actions', 'known_action'],
      },
      relationRecords,
    );

    await client.query('COMMIT');
    return upsertedTargetCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

// ─── Main import flow ─────────────────────────────────────────

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

  const fs = require('node:fs');
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

      if (config.mode === 'targets') {
        const upsertedTargetCount = await executeTargetBatch(
          client,
          config,
          importRunId,
          batch,
        );
        summary.importedRowCount += upsertedTargetCount;
      } else {
        const normalizedBatch = batch.map((record) => ({
          ...record,
          import_run_id: importRunId,
        }));
        summary.importedRowCount += await executeUpsert(
          client,
          config,
          normalizedBatch,
        );
      }
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
        cacheInvalidation: await invalidateMedicineCache(),
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
