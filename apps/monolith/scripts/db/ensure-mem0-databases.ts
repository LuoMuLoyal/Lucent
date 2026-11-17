/**
 * Creates the Mem0 sidecar's two databases and enables pgvector in them.
 *
 * ## Why this cannot be a manual step
 *
 * `mem0` (the sidecar's pgvector store) and `mem0_app` (its own `users` /
 * `api_keys` / `request_logs`, created by Alembic) are **separate databases**,
 * not schemas of `lucent`: its `users` table would collide with Prisma's `User`.
 * A deployment that creates them by hand is one rebuild away from the sidecar
 * crash-looping on `relation "request_logs" does not exist`.
 *
 * ## Why it runs from the entrypoint and not `docker/postgres`
 *
 * The Postgres image's `/docker-entrypoint-initdb.d/` runs **only when the data
 * directory is empty**. Every existing volume (the dev stack and the production
 * machines) is already initialised, so an initdb script would be silently
 * skipped exactly where it is needed. This runs from the app container on every
 * start instead — the same place `prisma migrate deploy` already runs — and every
 * statement is existence-checked, so re-running is a no-op.
 *
 * ## Privileges
 *
 * `CREATE DATABASE` and `CREATE EXTENSION vector` both need superuser.
 * `DATABASE_URL` carries the deployment's own role, which the official Postgres
 * image creates as superuser when `POSTGRES_USER` is set — true for both the dev
 * stack (`postgres`) and production (`lucent`).
 *
 * ## Module resolution
 *
 * Lives under `apps/monolith` because it imports `pg`, a dependency of this
 * workspace member. pnpm links it into `apps/monolith/node_modules`, which the
 * production image already carries (the entrypoint reaches `prisma` through the
 * same directory).
 *
 * Usage:
 *   node apps/monolith/scripts/db/ensure-mem0-databases.ts
 *   pnpm --filter monolith db:ensure:mem0
 *
 * Gated on `MEM0_ENABLED=true`; a no-op otherwise.
 */
import { Client } from 'pg';

/** The two databases the sidecar needs. Constants, never input. */
const MEM0_DATABASES = ['mem0', 'mem0_app'] as const;

/** Connects to `base`, overriding only the database name. */
function clientFor(base: URL, database: string): Client {
  const url = new URL(base.toString());
  url.pathname = `/${database}`;
  return new Client({ connectionString: url.toString() });
}

async function main(): Promise<void> {
  if (process.env.MEM0_ENABLED !== 'true') {
    return;
  }

  const raw = process.env.DATABASE_URL;
  if (raw == null || raw.length === 0) {
    throw new Error(
      'MEM0_ENABLED=true but DATABASE_URL is unset; cannot create the mem0 databases.',
    );
  }

  const base = new URL(raw);
  // `CREATE DATABASE` cannot run inside a transaction, and its connection must
  // target a database that already exists — so it goes through the app's own
  // database, which is present by the time this runs (after `migrate deploy`).
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();

  try {
    for (const name of MEM0_DATABASES) {
      const { rowCount } = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [name],
      );
      if ((rowCount ?? 0) > 0) {
        console.log(`[mem0-db] database "${name}" already exists; skipping.`);
        continue;
      }
      // Interpolated because `CREATE DATABASE` takes no parameters. The value
      // comes from the constant list above, never from input.
      await admin.query(`CREATE DATABASE "${name}"`);
      console.log(`[mem0-db] created database "${name}".`);
    }
  } finally {
    await admin.end();
  }

  // pgvector is per-database and does not carry over. The image is
  // `pgvector/pgvector`, so the extension files are already installed.
  for (const name of MEM0_DATABASES) {
    const client = clientFor(base, name);
    await client.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log(`[mem0-db] pgvector enabled in "${name}".`);
    } finally {
      await client.end();
    }
  }
}

await main();
