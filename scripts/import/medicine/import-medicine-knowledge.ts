#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

import { loadEnvironment, REPO_ROOT } from '../../shared/env.ts';
import { stableUuid } from '../../shared/stable-id.ts';
import {
  executeUpsert,
  startImportRun,
  finishImportRun,
  parsePositiveIntegerOption,
  parseArgs,
  streamParseAndUpsert,
} from '../../shared/db-upsert.ts';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));

// Re-export for backwards compatibility (rebuild scripts + tests depend on these)
export {
  invalidateMedicineCache,
  listMedicineCacheKeys,
  redisAdapterFromUrl,
  stableUuid,
};

const DATA_ROOT = path.resolve(REPO_ROOT, '..', 'DrugDataBase');
const MEDICINES_CACHE_KEY_PREFIX = 'medicines';
const IMPORT_RUNS_TABLE = 'drug_source_imports';

const COMMANDS = {
  'cn-products': {
    parser: path.join(thisDir, 'parsers', 'cn_products.py'),
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
    parser: path.join(thisDir, 'parsers', 'cn_leaflets.py'),
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
    parser: path.join(thisDir, 'parsers', 'cn_product_leaflet_links.py'),
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
    parser: path.join(thisDir, 'parsers', 'drugbank_drugs.py'),
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
    parser: path.join(thisDir, 'parsers', 'drugbank_external_links.py'),
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
    parser: path.join(thisDir, 'parsers', 'drugbank_targets.py'),
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
    parser: path.join(thisDir, 'parsers', 'drugbank_targets.py'),
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
  // Target protein / gene sequences. Both files share one header format, so
  // the dataset name is what separates amino-acid from nucleotide content
  // under the table's (source_dataset, uniprot_id) key.
  'drugbank-target-proteins': {
    parser: path.join(thisDir, 'parsers', 'drugbank_target_sequences.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'protein.fasta'),
    sourceKey: 'drugbank_target_sequences_protein_fasta',
    sourceName: 'drugbank_target_protein_fasta',
    sourceDataset: 'protein_fasta',
    tableName: 'drugbank_target_sequences',
    columns: [
      'id',
      'import_run_id',
      'source_dataset',
      'uniprot_id',
      'target_name',
      'drugbank_ids',
      'sequence',
      'length',
    ],
    conflictColumns: ['source_dataset', 'uniprot_id'],
    updateColumns: [
      'import_run_id',
      'target_name',
      'drugbank_ids',
      'sequence',
      'length',
    ],
  },
  'drugbank-target-genes': {
    parser: path.join(thisDir, 'parsers', 'drugbank_target_sequences.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'gene.fasta'),
    sourceKey: 'drugbank_target_sequences_gene_fasta',
    sourceName: 'drugbank_target_gene_fasta',
    sourceDataset: 'gene_fasta',
    tableName: 'drugbank_target_sequences',
    columns: [
      'id',
      'import_run_id',
      'source_dataset',
      'uniprot_id',
      'target_name',
      'drugbank_ids',
      'sequence',
      'length',
    ],
    conflictColumns: ['source_dataset', 'uniprot_id'],
    updateColumns: [
      'import_run_id',
      'target_name',
      'drugbank_ids',
      'sequence',
      'length',
    ],
  },
  // Biotech drug sequences. No `sourceDataset`: the file is the only source and
  // one drug legitimately owns several rows, distinguished by `description`.
  'drugbank-drug-sequences': {
    parser: path.join(thisDir, 'parsers', 'drugbank_drug_sequences.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'drug sequences.fasta'),
    sourceKey: 'drugbank_drug_sequences_fasta',
    sourceName: 'drugbank_drug_sequences_fasta',
    tableName: 'drugbank_drug_sequences',
    columns: [
      'id',
      'import_run_id',
      'drugbank_id',
      'description',
      'sequence',
      'length',
    ],
    conflictColumns: ['drugbank_id', 'description'],
    updateColumns: ['import_run_id', 'sequence', 'length'],
  },
  // Computed structure descriptors. One row per drug: the SDF has a unique
  // `DRUGBANK_ID` per record, so the drug id is the natural conflict key.
  'drugbank-structures': {
    parser: path.join(thisDir, 'parsers', 'drugbank_structures.py'),
    defaultSourcePath: path.join(DATA_ROOT, 'unziped', 'structures.sdf'),
    sourceKey: 'drugbank_structures_sdf',
    sourceName: 'drugbank_structures_sdf',
    tableName: 'drugbank_structures',
    columns: [
      'drugbank_id',
      'import_run_id',
      'smiles',
      'inchi_identifier',
      'inchi_key',
      'formula',
      'molecular_weight',
      'exact_mass',
      'jchem_iupac',
      'alogps_solubility',
      'salts',
      'jchem_atom_count',
      'jchem_formal_charge',
      'jchem_ghose_filter',
      'jchem_rule_of_five',
      'jchem_acceptor_count',
      'jchem_donor_count',
      'jchem_bioavailability',
      'jchem_mddr_like_rule',
      'jchem_number_of_rings',
      'jchem_rotatable_bond_count',
      'jchem_veber_rule',
      'jchem_physiological_charge',
      'jchem_neutral_charge',
      'jchem_average_polarizability',
      'jchem_polar_surface_area',
      'jchem_refractivity',
      'jchem_logp',
      'jchem_pka',
      'jchem_pka_strongest_acidic',
      'jchem_pka_strongest_basic',
      'jchem_average_neutral_microspecies_charge',
      'alogps_logp',
      'alogps_logs',
    ],
    conflictColumns: ['drugbank_id'],
    updateColumns: [
      'import_run_id',
      'smiles',
      'inchi_identifier',
      'inchi_key',
      'formula',
      'molecular_weight',
      'exact_mass',
      'jchem_iupac',
      'alogps_solubility',
      'salts',
      'jchem_atom_count',
      'jchem_formal_charge',
      'jchem_ghose_filter',
      'jchem_rule_of_five',
      'jchem_acceptor_count',
      'jchem_donor_count',
      'jchem_bioavailability',
      'jchem_mddr_like_rule',
      'jchem_number_of_rings',
      'jchem_rotatable_bond_count',
      'jchem_veber_rule',
      'jchem_physiological_charge',
      'jchem_neutral_charge',
      'jchem_average_polarizability',
      'jchem_polar_surface_area',
      'jchem_refractivity',
      'jchem_logp',
      'jchem_pka',
      'jchem_pka_strongest_acidic',
      'jchem_pka_strongest_basic',
      'jchem_average_neutral_microspecies_charge',
      'alogps_logp',
      'alogps_logs',
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
  drugbank-target-proteins
  drugbank-target-genes
  drugbank-drug-sequences
  drugbank-structures

Options:
  --source <path>       Override the default source file path.
  --batch-size <n>      Number of records per upsert batch. Default: 100
  --limit <n>           Parse only the first N records (useful for smoke tests).
  --source-version <v>  Store the export/version string in drug_source_imports.
  --with-hash           Compute SHA-256 for the source file and store it in drug_source_imports.
`);
}

// ─── Redis cache invalidation (medicine-specific) ─────────────

/**
 * The subset of the node-redis client surface this script relies on.
 * `@keyv/redis`'s `KeyvRedis` exposes the underlying client through `.client`,
 * typed as a standalone/cluster/sentinel union; the pattern scan only needs
 * `keys`, so it is narrowed to that surface in `invalidateMedicineCache`.
 */
interface RedisKeyScanner {
  keys: (pattern: string) => Promise<string[]>;
}

/**
 * Builds the `KeyvRedis` adapter used for cache invalidation.
 *
 * Keys are written by the app through `createKeyv()` (`useKeyPrefix: false`,
 * no namespace), so Redis holds the bare cache-manager key names
 * (`medicines:...`). The previous `cache-manager-ioredis-yet` store added a
 * `keyv:` namespace that no longer exists.
 */
async function redisAdapterFromUrl(redisUrl: string) {
  // Dynamic import keeps the Redis dependency off the hot path: it is loaded
  // only when cache invalidation runs.
  const { default: KeyvRedis } = await import('@keyv/redis');

  if (!URL.canParse(redisUrl)) {
    // Operator error — surface it with context instead of leaking node-redis's
    // own parse failure. The URL is not echoed back: it can carry a password.
    throw new Error(
      'Invalid REDIS_URL for medicine cache invalidation (expected redis:// or rediss://).',
    );
  }

  return new KeyvRedis(redisUrl);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function listMedicineCacheKeys(
  client: RedisKeyScanner,
): Promise<string[]> {
  const pattern = `${MEDICINES_CACHE_KEY_PREFIX}:*`;
  const keys = await client.keys(pattern);

  // Defensive filter: a pattern scan is a prefix match, not an exact one.
  return uniqueStrings(
    keys.filter((key) => key.startsWith(`${MEDICINES_CACHE_KEY_PREFIX}:`)),
  );
}

async function invalidateMedicineCache() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    return { invalidated: 0, skipped: 'REDIS_URL is not configured' };
  }

  const adapter = await redisAdapterFromUrl(redisUrl);

  try {
    // `getClient()` connects (and fails loudly) before the scan runs.
    const client = (await adapter.getClient()) as unknown as RedisKeyScanner;
    const keys = await listMedicineCacheKeys(client);
    if (keys.length === 0) {
      return { invalidated: 0 };
    }

    await adapter.deleteMany(keys);
    console.info(
      `[cache] invalidated ${String(keys.length)} medicine cache key(s)`,
    );
    return { invalidated: keys.length };
  } finally {
    await adapter.disconnect();
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

// ─── XML target/action enrichment ─────────────────────────────

/**
 * Applies `<targets>`/`<enzymes>`/`<carriers>`/`<transporters>` data from the
 * DrugBank XML onto `drugbank_drug_targets`.
 *
 * The CSV exports carry no `Actions` column at all, so every relation row
 * imported from `all.csv` has empty `actions` / `known_action` and a
 * placeholder `relation_kind`. The XML has the real values, but identifies
 * targets with a disjoint `BE...` id space, so matching is by target **name**
 * (case-insensitive, trimmed) against `drugbank_targets`.
 *
 * Relations with no CSV counterpart are inserted, which is what makes
 * enzyme/carrier/transporter relations appear for the first time.
 */
async function applyXmlTargetActions(client, pending) {
  // Resolve every plain-string name once.
  const nameResult = await client.query(
    `SELECT "id", lower(btrim("name")) AS name FROM "drugbank_targets" WHERE "source_dataset" = 'all'`,
  );
  const targetIdByName = new Map(
    nameResult.rows.map((row) => [row.name, row.id]),
  );

  let applied = 0;
  let unresolved = 0;
  const rows = [];

  for (const entry of pending) {
    for (const target of entry.targets) {
      const name = typeof target['name'] === 'string' ? target['name'] : null;
      if (name === null) {
        continue;
      }

      const targetId = targetIdByName.get(name.toLowerCase().trim());
      if (!targetId) {
        unresolved += 1;
        continue;
      }

      const relationKind =
        typeof target['relation_kind'] === 'string'
          ? target['relation_kind']
          : 'target';

      rows.push({
        id: stableUuid(
          'drugbank_drug_target_xml',
          entry.drugbankId,
          targetId,
          relationKind,
        ),
        drugbank_id: entry.drugbankId,
        target_id: targetId,
        relation_kind: relationKind,
        actions:
          Array.isArray(target['actions']) && target['actions'].length > 0
            ? target['actions']
            : null,
        known_action:
          typeof target['known_action'] === 'string'
            ? target['known_action']
            : null,
      });
    }
  }

  if (rows.length === 0) {
    return { applied, unresolved };
  }

  const chunkSize = 1000;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
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
      chunk,
    );
    applied += chunk.length;
  }

  console.info(
    `[xml-targets] applied ${String(applied)} relation(s), ${String(unresolved)} unresolved name(s)`,
  );

  return { applied, unresolved };
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
    xmlTargetRelations: null,
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

    // Collected during the stream and applied after the drug upsert, because
    // the XML target entries can only be matched once `drugbank_targets` rows
    // exist. Buffered in memory: bounded by the number of drugs that declare
    // targets (~1/4 of the corpus, a few hundred KB of strings).
    const pendingXmlTargets: {
      drugbankId: string;
      targets: Record<string, unknown>[];
    }[] = [];

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
        // `xml_targets` is a side-channel produced by the XML parser, not a
        // column on `drugbank_drugs`. Strip it before the upsert and apply it
        // afterwards to enrich `drugbank_drug_targets`.
        const normalizedBatch = batch.map((record) => {
          const { xml_targets: xmlTargets, ...rest } = record;
          if (Array.isArray(xmlTargets) && xmlTargets.length > 0) {
            pendingXmlTargets.push({
              drugbankId: record.drugbank_id,
              targets: xmlTargets,
            });
          }
          return { ...rest, import_run_id: importRunId };
        });
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

    if (pendingXmlTargets.length > 0) {
      summary.xmlTargetRelations = await applyXmlTargetActions(
        client,
        pendingXmlTargets,
      );
    }
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

// CLI entry guard (ESM): run main() only when this file is the executed
// script, replacing the CommonJS require.main === module check. Basename
// comparison works under Node's TS type stripping and when the module is
// imported for its exported helpers (rebuild scripts + tests).
const entry = process.argv[1];
if (entry && path.basename(entry) === 'import-medicine-knowledge.ts') {
  void main();
}
