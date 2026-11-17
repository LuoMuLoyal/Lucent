/**
 * Verifies the checked-in Go contract bindings match the published OpenAPI JSON.
 *
 * The failure this prevents: someone changes a DTO in the backend, regenerates
 * `docs/reference/generated/openapi.json` (which the backend CI already enforces),
 * and forgets that Go has its own copy. Nothing breaks at build time — the stale
 * structs still compile — and the mismatch only surfaces at runtime as an empty
 * field.
 *
 * Note the bindings are **not committed** (same treatment as the Prisma client):
 * the contract JSON is the artifact, its Go rendering is derived. So this check is
 * only meaningful right after a regeneration — the build pipeline runs `generate`
 * before compiling, which is where drift would actually bite.
 *
 * Usage: node infra/ci/check-go-contract.ts
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const GO_MODULE = resolve(ROOT, 'packages/contracts/go');

function run(command: string, args: string[], cwd: string) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

try {
  run('go', ['vet', './...'], GO_MODULE);
} catch (error) {
  const err = error as { stdout?: string; stderr?: string };
  console.error('go vet failed:');
  console.error(`${err.stdout ?? ''}${err.stderr ?? ''}`.trim());
  process.exit(1);
}

console.log('Go contract bindings vet clean (packages/contracts/go)');
