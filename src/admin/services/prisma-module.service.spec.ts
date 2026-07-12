import { buildPrismaClientModule } from './prisma-module.service';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('model User { id String @id }'),
}));

vi.mock('@prisma/internals', () => ({
  getDMMF: vi.fn().mockResolvedValue({
    datamodel: { models: [{ name: 'User', fields: [] }] },
  }),
}));

describe('buildPrismaClientModule', () => {
  it('reads the schema file and returns Prisma DMMF', async () => {
    const result = await buildPrismaClientModule();

    expect(result).toHaveProperty('Prisma');
    expect(result.Prisma).toHaveProperty('dmmf');
    expect(result.Prisma.dmmf).toHaveProperty('datamodel');
  });

  it('returns dmmf with models array', async () => {
    const result = await buildPrismaClientModule();

    expect(Array.isArray(result.Prisma.dmmf.datamodel.models)).toBe(true);
  });
});
