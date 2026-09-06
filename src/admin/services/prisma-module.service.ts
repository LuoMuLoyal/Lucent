import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { InternalServerErrorException } from '@nestjs/common';
import { SCHEMA_DIR, SCHEMA_MAIN_FILE } from '../constants/admin.constants.js';
import type { PrismaClientModule } from '../types/admin.types.js';

/**
 * `@prisma/internals` is CommonJS whose named-export surface is not
 * statically analyzable by Node's cjs-module-lexer (`getDMMF` is re-exported
 * dynamically). A bare named import therefore fails at ESM runtime, so the
 * module is loaded via dynamic import and the interop `default` (the CJS
 * `module.exports` object) is unwrapped — registered in the ESM
 * legacy-dependency list in docs/TODO.md.
 */
interface PrismaInternals {
  getDMMF: (options: { datamodel: string }) => Promise<unknown>;
}

async function loadPrismaInternals(): Promise<PrismaInternals> {
  const loaded = (await import('@prisma/internals')) as PrismaInternals & {
    default?: PrismaInternals;
  };
  // Named export first (vitest mocks / statically-analyzable entries); fall
  // back to the CJS interop `default` only when the named surface is missing
  // (real Node, where cjs-module-lexer cannot see the re-exported `getDMMF`).
  // The `default` property must not be read eagerly — vitest throws when a
  // mocked CJS module has no default export.
  if (typeof loaded.getDMMF === 'function') {
    return loaded;
  }
  const internals = loaded.default;
  if (internals === undefined) {
    // HttpException (not a bare Error) so the error goes through the Nest
    // exception-filter pipeline and keeps a traceId in logs — module-loading
    // invariant of the admin panel, not a request-path failure.
    throw new InternalServerErrorException(
      'Admin Prisma init failed (module-load): @prisma/internals interop failed — no default export available',
    );
  }
  return internals;
}

/**
 * Builds a minimal Prisma client module from the multi-file Prisma schema for
 * AdminJS. Reads the main `schema.prisma` (generator + datasource) plus every
 * `*.prisma` file under `prisma/models/`, concatenates them, and passes the
 * combined datamodel to `getDMMF`.
 */
export async function buildPrismaClientModule(): Promise<PrismaClientModule> {
  const { getDMMF } = await loadPrismaInternals();
  const mainPath = join(SCHEMA_DIR, SCHEMA_MAIN_FILE);
  const modelsDir = join(SCHEMA_DIR, 'models');

  const mainSchema = await readFile(mainPath, 'utf8');

  const modelFiles = (await readdir(modelsDir))
    .filter((file) => file.endsWith('.prisma'))
    .sort();
  const modelSchemas = await Promise.all(
    modelFiles.map((file) => readFile(join(modelsDir, file), 'utf8')),
  );

  const datamodel = [mainSchema, ...modelSchemas].join('\n\n');
  const dmmf = await getDMMF({ datamodel });

  return {
    Prisma: {
      dmmf: dmmf as PrismaClientModule['Prisma']['dmmf'],
    },
  };
}
