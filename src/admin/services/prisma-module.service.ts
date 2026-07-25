import { readFile } from 'node:fs/promises';
import { getDMMF } from '@prisma/internals';

import { SCHEMA_PATH } from '../constants/admin.constants';
import type { PrismaClientModule } from '../types/admin.types';

/**
 * Builds a minimal Prisma client module from the schema file for AdminJS.
 */
export async function buildPrismaClientModule(): Promise<PrismaClientModule> {
  const schema = await readFile(SCHEMA_PATH, 'utf8');
  const dmmf = await getDMMF({
    datamodel: [[SCHEMA_PATH, schema]],
  });

  return {
    Prisma: {
      dmmf: dmmf as unknown as PrismaClientModule['Prisma']['dmmf'],
    },
  };
}
