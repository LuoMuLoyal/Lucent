/**
 * End-to-end check that the pino logger actually lands entries in VictoriaLogs.
 *
 * Builds the same logger the application builds in production — `buildPinoOptions`
 * plus a `VictoriaLogsStream` — points the stream at a local VictoriaLogs, emits
 * a few entries, and then queries them back through the LogsQL HTTP API.
 *
 * Run against a local container:
 *   docker run -d -p 19428:9428 victoriametrics/victoria-logs:v1.51.1
 *   node scripts/verify-victorialogs-ingest.mjs
 */

import { pino } from 'pino';
import { buildPinoOptions } from '../dist/common/logger/logger.config.js';
import { VictoriaLogsStream } from '../dist/common/logger/victorialogs-stream.js';

const BASE_URL = process.env.VICTORIA_LOGS_URL ?? 'http://127.0.0.1:19428';
const INGEST_URL = `${BASE_URL}/insert/jsonline`;
const MARKER = `verify-${Date.now()}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function query() {
  const expression = `_msg:${MARKER} | sort by (_time) | limit 10`;
  const url = `${BASE_URL}/select/logsql/query?query=${encodeURIComponent(expression)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `query failed: ${response.status} ${await response.text()}`,
    );
  }
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${message}`);
  }
}

async function main() {
  const stream = new VictoriaLogsStream({
    url: INGEST_URL,
    batchCount: 1,
    onWarn: (message) => console.error(`ingest warning: ${message}`),
  });
  const logger = pino(buildPinoOptions('info'), stream);

  logger.info({ context: 'Verify', userId: 'u1' }, `${MARKER} info entry`);
  logger.error(
    { context: 'Verify', error: new Error('boom'), userId: 'u1' },
    `${MARKER} error entry`,
  );

  stream.end();
  await sleep(1_500);

  const entries = await query();
  console.log(`queried ${entries.length} entries`);

  const info = entries.find((entry) => entry._msg === `${MARKER} info entry`);
  const error = entries.find((entry) => entry._msg === `${MARKER} error entry`);

  check(info !== undefined, 'info entry is queryable by _msg');
  check(error !== undefined, 'error entry is queryable by _msg');
  check(typeof info?._time === 'string', '_time mapped from timestamp');
  check(info?.level === 'info', 'level preserved as a string label');
  check(info?.userId === 'u1', 'caller metadata is a top-level field');
  check(info?.context === 'Verify', 'context is a top-level field');
  // VictoriaLogs flattens nested JSON objects into dotted field names, so the
  // `error` serializer's message/stack surface as `error.message` / `error.stack`.
  check(
    error?.['error.message'] === 'boom',
    'error.message survives ingestion',
  );
  check(
    typeof error?.['error.stack'] === 'string' &&
      error['error.stack'].includes('boom'),
    'error.stack is a string (not an empty object)',
  );
  check(
    typeof error?.['error.type'] === 'string',
    'error.type survives ingestion',
  );

  if (entries.length === 0) {
    console.error(
      `No entries arrived. Is the VictoriaLogs container running on ${BASE_URL}?`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
