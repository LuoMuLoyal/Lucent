import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { REPO_ROOT } from './env.ts';
import { normalizeStableIdPart } from './stable-id.ts';

// ─── Value normalisation ──────────────────────────────────────

/**
 * Normalizes a value for SQL parameter binding.
 * Objects/arrays are JSON-serialized; undefined becomes null.
 * Primitive values (number, boolean, string) are passed through as-is
 * so the pg driver can handle them with correct type coercion.
 */
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

// ─── SQL helpers ──────────────────────────────────────────────

function sqlIdentifier(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Builds a parameterised ON CONFLICT upsert statement.
 *
 * SECURITY: `spec.tableName` and `spec.columns` are interpolated into SQL
 * via `sqlIdentifier` (double-quote escaping). They MUST come from trusted,
 * hard-coded call sites — never from user input.
 */
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

function dedupeByConflictColumns(spec, records) {
  const deduped = new Map();
  for (const record of records) {
    const key = spec.conflictColumns
      .map((column) => normalizeStableIdPart(record[column]))
      .join('||');
    deduped.set(key, record);
  }
  return [...deduped.values()];
}

async function executeUpsert(client, spec, records) {
  if (records.length === 0) {
    return 0;
  }

  const rows = dedupeByConflictColumns(spec, records);
  const sql = buildUpsertStatement(spec, rows.length);
  const params = rows.flatMap((record) =>
    spec.columns.map((column) => normalizeValue(record[column])),
  );

  await client.query(sql, params);
  return rows.length;
}

// ─── File hashing ─────────────────────────────────────────────

async function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ─── Import-run tracking ──────────────────────────────────────

async function startImportRun(
  client,
  importRunsTable,
  config,
  filePath,
  options,
) {
  const sourceStats = await fs.promises.stat(filePath);
  const importRunId = crypto.randomUUID();

  await client.query(
    `
      INSERT INTO ${sqlIdentifier(importRunsTable)} (
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

async function finishImportRun(client, importRunsTable, importRunId, summary) {
  await client.query(
    `
      UPDATE ${sqlIdentifier(importRunsTable)}
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

// ─── Parser orchestration ─────────────────────────────────────

function createParserArgs(config, sourcePath, options) {
  const parserArgs = [config.parser, '--source-path', sourcePath];

  if (options.limit !== undefined) {
    parserArgs.push('--limit', String(options.limit));
  }

  if (config.sourceDataset) {
    parserArgs.push('--source-dataset', config.sourceDataset);
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

function parsePositiveIntegerOption(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
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

/**
 * Spawns a Python parser, reads NDJSON from stdout, batches records,
 * and upserts them via the provided flushBatch callback.
 *
 * @param {object} config  — COMMANDS entry with parser path, sourceDataset, etc.
 * @param {string} sourcePath
 * @param {object} options — { limit?: number }
 * @param {function} flushBatch — async (batch) => void
 * @returns {Promise<{ rawRowCount: number, rejectedRowCount: number, rejectionSamples: array }>}
 */
async function streamParseAndUpsert(config, sourcePath, options, flushBatch) {
  const parserArgs = createParserArgs(config, sourcePath, options);

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

  // ⚠️ 刻意不用 `readline` 的异步迭代器。
  //
  // 原写法是 `for await (const line of readline.createInterface(...))`，循环体内
  // `await flushBatch()` 会长时间暂停消费 stdout。此时若子进程已输出完毕并退出，
  // readline 的内部状态会与其 close 事件竞争，在循环末尾抛 `readline was closed`：
  //   · 该次导入被记为 status = failed（但进程仍退出 0，错误只体现在 note 里）；
  //   · **最后一批（不足 batchSize 的余数批）没有写入**。
  // 实测：63,889 行的 links 表稳定只写入 63,800 行（638 个整批），恰丢末尾 89 行；
  // 而同样 63,889 行的 products 表因每批耗时不同未触发 —— 典型的时序相关丢数据。
  //
  // 改为在 `data` 事件上手工切行：读取是同步的，不依赖 await 时序；
  // 行处理串到一条 promise 链上顺序执行，既保留 await 写入又不阻塞读取。
  const stats = {
    rawRowCount: 0,
    rejectedRowCount: 0,
    rejectionSamples: [],
  };

  let currentBatch = [];

  const handleLine = async (line) => {
    if (!line.trim()) {
      return;
    }

    const payload = JSON.parse(line);
    stats.rawRowCount += 1;

    if (payload.kind === 'error') {
      stats.rejectedRowCount += 1;
      collectRejectionSample(stats.rejectionSamples, payload);
      return;
    }

    if (payload.kind !== 'record') {
      stats.rejectedRowCount += 1;
      collectRejectionSample(stats.rejectionSamples, {
        rowNumber: null,
        message: `Unsupported payload kind: ${String(payload.kind)}`,
      });
      return;
    }

    currentBatch.push(payload.data);
    if (currentBatch.length >= options.batchSize) {
      await flushBatch(currentBatch);
      currentBatch = [];
    }
  };

  let queue = Promise.resolve();
  let buffer = '';
  let streamError = null;

  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      queue = queue.then(() => handleLine(line));
      newlineIndex = buffer.indexOf('\n');
    }
  });
  child.stdout.on('error', (error) => {
    streamError = error;
  });

  await new Promise((resolve, reject) => {
    child.stdout.on('end', resolve);
    child.stdout.on('error', reject);
  });

  // 收尾：最后一行可能没有换行符。
  if (buffer.length > 0) {
    const tail = buffer;
    buffer = '';
    queue = queue.then(() => handleLine(tail));
  }
  await queue;

  if (streamError) {
    throw new Error(`Parser stdout stream error: ${String(streamError)}`);
  }

  await flushBatch(currentBatch);

  const exitCode = await childExit;
  if (exitCode !== 0) {
    throw new Error(`Parser exited with code ${String(exitCode)}`);
  }

  return stats;
}

export {
  normalizeValue,
  sqlIdentifier,
  buildUpsertStatement,
  dedupeByConflictColumns,
  executeUpsert,
  computeFileHash,
  startImportRun,
  finishImportRun,
  createParserArgs,
  collectRejectionSample,
  parsePositiveIntegerOption,
  parseArgs,
  streamParseAndUpsert,
};
