#!/usr/bin/env node

/**
 * Triage: how much of the Chinese leaflet graph can be built WITHOUT an LLM,
 * and how much LLM extraction remains after content dedup?
 *
 * Answers the "should we switch GraphRAG frameworks?" question with numbers
 * measured on this corpus rather than borrowing benchmarks from elsewhere.
 *
 * Read-only. Writes nothing. Outputs a JSON report + a human summary.
 *
 * Chunking is reproduced from scripts/shared/chunking.ts (1000/100) so the
 * chunk count here is directly comparable to medicine_leaflet_chunks.
 *
 * Usage:
 *   node scripts/import/medicine/triage-leaflet-graph-cost.ts [--json <path>]
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

import { Client } from 'pg';

import { loadEnvironment } from '../../shared/env.ts';

// Mirrors rebuild-leaflet-index.ts — keep in sync; drift here invalidates
// the LLM-side estimate.
const CHUNKABLE_FIELDS = [
  'indications',
  'dosage',
  'contraindications',
  'precautions',
  'adverse_reactions',
  'drug_interactions',
  'pharmacology_toxicology',
  'pharmacokinetics',
  'storage',
  'validity_period',
];

// Fields that are *categorical / enumerable* rather than prose. Entities named
// here can be materialised as graph nodes with zero LLM calls.
const STRUCTURED_ENTITY_FIELDS = {
  generic_name: 'Drug',
  manufacturer_clean: 'Manufacturer',
  category: 'DrugCategory',
  regulatory_class: 'RegulatoryClass',
};

// Delimited list fields → deterministic edges.
// `column` is the raw SQL expression yielding the multi-valued set.
const DELIMITED_FIELDS = {
  related_diseases: {
    target: 'Disease',
    edge: 'TREATS',
    column: `unnest(string_to_array("related_diseases", ','))`,
  },
  // approval_codes is jsonb (an array of strings), not a delimited text column.
  approval_codes: {
    target: 'ApprovalCode',
    edge: 'APPROVED_AS',
    column: `jsonb_array_elements_text("approval_codes")`,
  },
  ingredients: { target: 'Ingredient', edge: 'CONTAINS', column: null },
};

const MAX_CHUNK_LENGTH = 1000;
const CHUNK_OVERLAP = 100;

// Measured on this corpus, batch 2 (lightrag-eval/PROCESS.md §7):
// 23.9 s per 1000 Chinese characters at MAX_ASYNC_LLM=16.
const SECONDS_PER_1000_CHARS = 23.9;

// ─── chunking (reproduced from scripts/shared/chunking.ts) ────

function splitByParagraphs(text) {
  return text
    .split(/\n\s*/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function splitByLength(text, maxLength, overlap) {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxLength, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) {
      break;
    }
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function chunkText(
  text,
  maxLength = MAX_CHUNK_LENGTH,
  overlap = CHUNK_OVERLAP,
) {
  const chunks = [];
  for (const paragraph of splitByParagraphs(text)) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }
    chunks.push(...splitByLength(paragraph, maxLength, overlap));
  }
  return chunks;
}

function normalizeValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

// ─── helpers ──────────────────────────────────────────────────

function md5(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function fmt(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function hours(seconds) {
  return (seconds / 3600).toFixed(1);
}

/**
 * Ingredient prose in Chinese leaflets looks like:
 *   本品为复方制剂，每包3克含盐酸赖氨酸2700毫克、葡萄糖酸钙150毫克…辅料为
 * Splitting on the enumerated separators recovers active-ingredient names.
 * This is heuristic and its output is reported, never silently trusted.
 */
function splitIngredients(text) {
  if (!text) {
    return [];
  }
  return text
    .replace(/^本品(为复方制剂|主要成份|主要成分|含)/, '')
    .split(/[、,，；;]/)
    .map((token) =>
      token
        .replace(/[（(].*?[)）]/g, '')
        .replace(/(每|含|相当于).*$/, '')
        .replace(/[\d.]+(mg|g|ml|毫克|克|毫升|微克|μg|IU|万单位|单位).*$/i, '')
        .replace(/辅料.*$/, '')
        .replace(/[。\s]/g, '')
        .trim(),
    )
    .filter((token) => token.length >= 2 && token.length <= 30)
    .filter((token) => /[\u4e00-\u9fa5]/.test(token));
}

// ─── report shape ─────────────────────────────────────────────

/** 一行「成本投影」，`hours` / `days` 在补齐后写入。 */
interface ProjectionRow {
  chars: number;
  seconds: number;
  hours?: string;
  days?: string;
}

interface TriageReport {
  corpus: {
    leaflets: number;
    fieldChars: Record<string, number>;
    llmExtractableChars: number;
  };
  dedup: {
    totalLeaflets: number;
    uniqueLeaflets: number;
    redundantLeaflets: number;
    [key: string]: unknown;
  };
  dedupChars: {
    allChars: number;
    /** 去重后（按文档级）保留的字符数。注意与 llmSide 的 chunk 级口径不同。 */
    dedupChars: number;
    savedChars: number;
  };
  structuredEntities: Record<
    string,
    { label: string; distinct_values: number; populated: number }
  >;
  delimitedEdges: Record<
    string,
    {
      edge: string;
      edge_rows: number;
      distinct_targets: number;
      heuristic: boolean;
    }
  >;
  llmSide: {
    totalChunks: number;
    chunksAfterDedup: number;
    chunksInRedundantDocs: number;
    dedupReductionPct: number;
    fieldChunkCounts: Record<string, number>;
    fieldUniqueChunkCounts: Record<string, number>;
    fieldValues: Record<string, number>;
    fieldUniqueValues: Record<string, number>;
    uniqueChunks: number;
    chunkDedupPct: number;
    totalChunkChars: number;
    uniqueChunkChars: number;
    charDedupPct: number;
  };
  projection: {
    basis: string;
    allData: ProjectionRow;
    afterChunkDedup: ProjectionRow;
    afterChunkDedupAndGleaningOff: ProjectionRow;
    [key: string]: unknown;
  };
}

// ─── main ─────────────────────────────────────────────────────

async function main() {
  loadEnvironment();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured for the current NODE_ENV');
  }

  const argv = process.argv.slice(2);
  const jsonFlag = argv.indexOf('--json');
  const jsonPath = jsonFlag >= 0 ? argv[jsonFlag + 1] : null;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const report: TriageReport = {} as TriageReport;

  try {
    // ── 1. Corpus shape ────────────────────────────────────────
    const total = (
      await client.query('SELECT count(*)::int AS n FROM cn_medicine_leaflets')
    ).rows[0].n;

    const fieldStats = (
      await client.query(`
        SELECT
          count(*)::int AS leaflets,
          ${CHUNKABLE_FIELDS.map(
            (f) => `sum(length(coalesce("${f}", '')))::bigint AS len_${f}`,
          ).join(',\n          ')}
        FROM cn_medicine_leaflets
      `)
    ).rows[0];

    const fieldChars: Record<string, number> = Object.fromEntries(
      CHUNKABLE_FIELDS.map((f) => [f, Number(fieldStats[`len_${f}`])]),
    );
    report.corpus = {
      leaflets: total,
      fieldChars,
      llmExtractableChars: Object.values(fieldChars).reduce((a, b) => a + b, 0),
    };

    // ── 2. Dedup: how many leaflets are byte-identical prose? ──
    const dedup = (
      await client.query(`
        WITH h AS (
          SELECT md5(
            ${CHUNKABLE_FIELDS.map((f) => `coalesce("${f}", '')`).join(" || '|' || ")}
          ) AS digest
          FROM cn_medicine_leaflets
        ), g AS (SELECT digest, count(*)::int AS n FROM h GROUP BY digest)
        SELECT
          count(*)::int AS distinct_docs,
          coalesce(sum(CASE WHEN n > 1 THEN n - 1 ELSE 0 END), 0)::int AS redundant_docs,
          coalesce(sum(CASE WHEN n > 1 THEN n ELSE 0 END), 0)::int AS docs_in_dup_groups,
          coalesce(max(n), 0)::int AS largest_group
        FROM g
      `)
    ).rows[0];
    report.dedup = dedup;

    // Chars attributable to the redundant copies (sum over dup groups of the
    // extra copies' length).
    const dedupChars = (
      await client.query(`
        WITH base AS (
          SELECT
            md5(${CHUNKABLE_FIELDS.map((f) => `coalesce("${f}", '')`).join(" || '|' || ")}) AS digest,
            ${CHUNKABLE_FIELDS.map((f) => `length(coalesce("${f}", ''))`).join(' + ')} AS len
          FROM cn_medicine_leaflets
        ), g AS (
          SELECT digest, count(*)::int AS n, sum(len)::bigint AS total_len, max(len)::bigint AS one_len
          FROM base GROUP BY digest
        )
        SELECT
          coalesce(sum(total_len), 0)::bigint AS all_chars,
          coalesce(sum(total_len - (n - 1) * one_len), 0)::bigint AS dedup_chars
        FROM g
      `)
    ).rows[0];
    report.dedupChars = {
      allChars: Number(dedupChars.all_chars),
      dedupChars: Number(dedupChars.dedup_chars),
      savedChars: Number(dedupChars.all_chars) - Number(dedupChars.dedup_chars),
    };

    // ── 3. Deterministic entity/edge inventory ────────────────
    const structured = {};
    for (const [field, label] of Object.entries(STRUCTURED_ENTITY_FIELDS)) {
      const r = (
        await client.query(`
          SELECT
            count(*)::int AS populated,
            count(DISTINCT v)::int AS distinct_values
          FROM (
            SELECT "${field}" AS v FROM cn_medicine_leaflets
            WHERE "${field}" IS NOT NULL AND btrim("${field}") <> ''
          ) s
        `)
      ).rows[0];
      structured[field] = { label, ...r };
    }
    report.structuredEntities = structured;

    // Delimited multi-value fields → deterministic edges.
    const delimited = {};
    for (const [field, cfg] of Object.entries(DELIMITED_FIELDS)) {
      if (cfg.column) {
        const r = (
          await client.query(`
            WITH d AS (
              SELECT trim(${cfg.column}) AS v
              FROM cn_medicine_leaflets
              WHERE "${field}" IS NOT NULL
            )
            SELECT
              count(*)::int AS edge_rows,
              count(DISTINCT v)::int AS distinct_targets
            FROM d WHERE v IS NOT NULL AND v <> ''
          `)
        ).rows[0];
        delimited[field] = { target: cfg.target, edge: cfg.edge, ...r };
      } else {
        // ingredient prose needs the heuristic splitter → done in JS
        const rows = (
          await client.query(
            `SELECT ingredients FROM cn_medicine_leaflets WHERE ingredients IS NOT NULL`,
          )
        ).rows;
        const set = new Set();
        let edges = 0;
        for (const row of rows) {
          const parts = new Set(splitIngredients(row.ingredients));
          for (const p of parts) {
            set.add(p);
            edges += 1;
          }
        }
        delimited[field] = {
          target: cfg.target,
          edge: cfg.edge,
          edge_rows: edges,
          distinct_targets: set.size,
          heuristic: true,
        };
      }
    }
    report.delimitedEdges = delimited;

    // ── 4. Chunk count for the LLM side (production chunking) ──
    // Computed in SQL for the naive case (whole-field chunking), which is what
    // rebuild-leaflet-index.ts actually does.
    const chunkRows = (
      await client.query(
        `SELECT ${CHUNKABLE_FIELDS.map((f) => `"${f}"`).join(', ')} FROM cn_medicine_leaflets`,
      )
    ).rows;

    let chunks = 0;
    let chunksAfterDedup = 0;
    const seenDigests = new Set();
    let chunksInRedundantDocs = 0;

    // Chunk-level dedup is the unit that matters: LightRAG extracts (and
    // charges) per chunk, not per document. Whole-document dedup is nearly
    // useless here because concatenating 10 fields makes every leaflet unique
    // even when its individual fields are heavily shared.
    const seenChunks = new Set();
    let uniqueChunks = 0;
    let uniqueChunkChars = 0;
    let totalChunkChars = 0;

    const fieldChunkCounts = Object.fromEntries(
      CHUNKABLE_FIELDS.map((f) => [f, 0]),
    );
    const fieldUniqueChunkCounts = Object.fromEntries(
      CHUNKABLE_FIELDS.map((f) => [f, 0]),
    );
    const fieldUniqueValues = Object.fromEntries(
      CHUNKABLE_FIELDS.map((f) => [f, 0]),
    );
    const fieldValues = Object.fromEntries(CHUNKABLE_FIELDS.map((f) => [f, 0]));
    const seenFieldValue = Object.fromEntries(
      CHUNKABLE_FIELDS.map((f) => [f, new Set()]),
    );

    for (const row of chunkRows) {
      const texts = CHUNKABLE_FIELDS.map((f) => normalizeValue(row[f]));
      const digestParts = texts.map((t) => t ?? '').join('|');
      const digest = md5(digestParts);
      const isRedundant = seenDigests.has(digest);
      seenDigests.add(digest);

      let docChunks = 0;
      for (let i = 0; i < CHUNKABLE_FIELDS.length; i += 1) {
        const text = texts[i];
        const field = CHUNKABLE_FIELDS[i];
        if (!text || text.trim().length === 0) {
          continue;
        }

        fieldValues[field] += 1;
        const fv = md5(text);
        if (!seenFieldValue[field].has(fv)) {
          seenFieldValue[field].add(fv);
          fieldUniqueValues[field] += 1;
        }

        const fieldChunks = chunkText(text);
        fieldChunkCounts[field] += fieldChunks.length;
        docChunks += fieldChunks.length;

        for (const c of fieldChunks) {
          totalChunkChars += c.length;
          const ch = md5(c);
          if (!seenChunks.has(ch)) {
            seenChunks.add(ch);
            uniqueChunks += 1;
            uniqueChunkChars += c.length;
            fieldUniqueChunkCounts[field] += 1;
          }
        }
      }
      chunks += docChunks;
      if (isRedundant) {
        chunksInRedundantDocs += docChunks;
      } else {
        chunksAfterDedup += docChunks;
      }
    }

    report.llmSide = {
      totalChunks: chunks,
      chunksAfterDedup,
      chunksInRedundantDocs,
      dedupReductionPct:
        chunks > 0 ? (100 * chunksInRedundantDocs) / chunks : 0,
      fieldChunkCounts,
      fieldUniqueChunkCounts,
      fieldValues,
      fieldUniqueValues,
      // Chunk-level (the real saving)
      uniqueChunks,
      chunkDedupPct: chunks > 0 ? (100 * (chunks - uniqueChunks)) / chunks : 0,
      totalChunkChars,
      uniqueChunkChars,
      charDedupPct:
        totalChunkChars > 0
          ? (100 * (totalChunkChars - uniqueChunkChars)) / totalChunkChars
          : 0,
    };

    // ── 5. Cost projection at the measured rate ────────────────
    const charRate = SECONDS_PER_1000_CHARS;
    const secFor = (chars) => (chars / 1000) * charRate;

    const allChars = report.llmSide.totalChunkChars;
    const uniqueChars = report.llmSide.uniqueChunkChars;

    report.projection = {
      basis: `${SECONDS_PER_1000_CHARS} s per 1000 chars (measured, MAX_ASYNC_LLM=16)`,
      allData: { chars: allChars, seconds: secFor(allChars) },
      afterChunkDedup: { chars: uniqueChars, seconds: secFor(uniqueChars) },
      afterChunkDedupAndGleaningOff: {
        chars: uniqueChars,
        seconds: secFor(uniqueChars) / 2,
      },
    };
    for (const row of Object.values(report.projection) as ProjectionRow[]) {
      if (row?.seconds != null) {
        row.hours = hours(row.seconds);
        row.days = (row.seconds / 86400).toFixed(1);
      }
    }

    // ── print ──────────────────────────────────────────────────
    const line = '─'.repeat(72);
    console.log(line);
    console.log('CORPUS');
    console.log(line);
    console.log(`  leaflets                ${fmt(total)}`);
    console.log(
      `  LLM-extractable chars   ${fmt(report.corpus.llmExtractableChars)}  (10 chunkable fields)`,
    );
    console.log('');
    console.log('  chars by field (desc):');
    Object.entries(report.corpus.fieldChars)
      .sort((a, b) => b[1] - a[1])
      .forEach(([f, n]) =>
        console.log(`    ${f.padEnd(24)} ${String(fmt(n)).padStart(12)}`),
      );

    console.log('');
    console.log(line);
    console.log(
      'DEDUP — whole document (nearly useless: 10 fields concatenated)',
    );
    console.log(line);
    console.log(`  distinct documents      ${fmt(dedup.distinct_docs)}`);
    console.log(`  redundant documents     ${fmt(dedup.redundant_docs)}`);
    console.log(
      `  chars saved             ${fmt(report.dedupChars.savedChars)}  (${(
        (100 * report.dedupChars.savedChars) /
        report.dedupChars.allChars
      ).toFixed(1)}%)`,
    );

    console.log('');
    console.log(line);
    console.log('DEDUP — per field value (the unit LightRAG bills on)');
    console.log(line);
    const dfl = report.llmSide;
    console.log(
      `  field values            ${fmt(Object.values(dfl.fieldValues).reduce((a, b) => a + b, 0))}`,
    );
    console.log(
      `  distinct field values   ${fmt(Object.values(dfl.fieldUniqueValues).reduce((a, b) => a + b, 0))}`,
    );
    console.log('');
    console.log('  per-field unique/total:');
    Object.keys(dfl.fieldValues)
      .sort(
        (a, b) =>
          dfl.fieldUniqueValues[a] / (dfl.fieldValues[a] || 1) -
          dfl.fieldUniqueValues[b] / (dfl.fieldValues[b] || 1),
      )
      .forEach((f) => {
        const u = dfl.fieldUniqueValues[f];
        const t = dfl.fieldValues[f];
        console.log(
          `    ${f.padEnd(24)} ${String(fmt(u)).padStart(7)} / ${String(fmt(t)).padStart(7)}  = ${((100 * u) / t).toFixed(1)}% unique`,
        );
      });

    console.log('');
    console.log(line);
    console.log('DEDUP — per CHUNK (what extraction actually costs)');
    console.log(line);
    console.log(`  chunks generated        ${fmt(dfl.totalChunks)}`);
    console.log(
      `  distinct chunks         ${fmt(dfl.uniqueChunks)}  (-${dfl.chunkDedupPct.toFixed(1)}%)`,
    );
    console.log(
      `  chunk chars             ${fmt(dfl.totalChunkChars)} -> ${fmt(dfl.uniqueChunkChars)}  (-${dfl.charDedupPct.toFixed(1)}%)`,
    );

    console.log('');
    console.log(line);
    console.log('DETERMINISTIC (zero-LLM) GRAPH MATERIAL');
    console.log(line);
    for (const [field, s] of Object.entries(report.structuredEntities)) {
      console.log(
        `  ${field.padEnd(20)} ${s.label.padEnd(16)} nodes=${String(fmt(s.distinct_values)).padStart(8)}  (from ${fmt(s.populated)} leaflets)`,
      );
    }
    for (const [field, d] of Object.entries(report.delimitedEdges)) {
      console.log(
        `  ${field.padEnd(20)} ${d.edge.padEnd(16)} edges=${String(fmt(d.edge_rows)).padStart(8)}  targets=${fmt(d.distinct_targets)}${d.heuristic ? '  [heuristic]' : ''}`,
      );
    }

    console.log('');
    console.log(line);
    console.log('LLM SIDE (what still needs extraction)');
    console.log(line);
    console.log(`  chunks today            ${fmt(report.llmSide.totalChunks)}`);
    console.log(
      `  after chunk dedup       ${fmt(report.llmSide.uniqueChunks)}  (-${report.llmSide.chunkDedupPct.toFixed(1)}%)`,
    );

    console.log('');
    console.log(line);
    console.log('PROJECTION (single worker at measured rate)');
    console.log(line);
    console.log(`  basis: ${report.projection.basis}`);
    console.log(
      `  all data                ${report.projection.allData.hours} h  (${report.projection.allData.days} d)`,
    );
    console.log(
      `  after chunk dedup       ${report.projection.afterChunkDedup.hours} h  (${report.projection.afterChunkDedup.days} d)`,
    );
    console.log(
      `  dedup + MAX_GLEANING=0  ${report.projection.afterChunkDedupAndGleaningOff.hours} h  (${report.projection.afterChunkDedupAndGleaningOff.days} d)`,
    );
    console.log('');

    if (jsonPath) {
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
      console.log(`JSON report written to ${jsonPath}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
