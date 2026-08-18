import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getDMMF } from '@prisma/internals';

import { SCHEMA_DIR, SCHEMA_MAIN_FILE } from '../constants/admin.constants';
import type { PrismaClientModule } from '../types/admin.types';

/**
 * Builds a minimal Prisma client module from the multi-file Prisma schema for
 * AdminJS. Reads the main `schema.prisma` (generator + datasource) plus every
 * `*.prisma` file under `prisma/models/`, concatenates them, and passes the
 * combined datamodel to `getDMMF`.
 */
export async function buildPrismaClientModule(): Promise<PrismaClientModule> {
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
      dmmf: dmmf as unknown as PrismaClientModule['Prisma']['dmmf'],
    },
  };
}
