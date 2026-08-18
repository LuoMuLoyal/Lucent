import { buildPrismaClientModule } from './prisma-module.service';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue(['user.prisma', 'assistant.prisma']),
  readFile: vi.fn().mockImplementation((path: string) => {
    if (path === 'prisma/schema.prisma') {
      return Promise.resolve('generator client { provider = "prisma-client" }');
    }
    return Promise.resolve('model User { id String @id }');
  }),
}));

vi.mock('@prisma/internals', () => ({
  getDMMF: vi.fn().mockResolvedValue({
    datamodel: { models: [{ name: 'User', fields: [] }] },
  }),
}));

describe('buildPrismaClientModule', () => {
  it('reads the multi-file schema and returns Prisma DMMF', async () => {
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
