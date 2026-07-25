import { generateAdminResourceConfigs } from './resource-config.service';
import type { PrismaClientModule } from '../types/admin.types';

function makeClientModule(
  models: {
    name: string;
    fields: { name: string; kind: string; type: string }[];
  }[],
): PrismaClientModule {
  return {
    Prisma: {
      dmmf: {
        datamodel: { models: models as never },
      },
    },
  };
}

describe('generateAdminResourceConfigs', () => {
  it('returns one config per model', () => {
    const module = makeClientModule([
      {
        name: 'User',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'email', kind: 'scalar', type: 'String' },
        ],
      },
      {
        name: 'Post',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'title', kind: 'scalar', type: 'String' },
        ],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);

    expect(configs).toHaveLength(2);
    expect(configs.map((c) => c.modelName)).toEqual(['User', 'Post']);
  });

  it('hides relation fields from listProperties', () => {
    const module = makeClientModule([
      {
        name: 'TestModel',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'name', kind: 'scalar', type: 'String' },
          { name: 'user', kind: 'object', type: 'User' },
        ],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);

    expect(configs[0]?.listProperties).not.toContain('user');
    expect(configs[0]?.hiddenProperties).toContain('user');
  });

  it('hides sensitive fields (passwordHash, refreshTokenHash)', () => {
    const module = makeClientModule([
      {
        name: 'TestModel',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'passwordHash', kind: 'scalar', type: 'String' },
          { name: 'refreshTokenHash', kind: 'scalar', type: 'String' },
          { name: 'name', kind: 'scalar', type: 'String' },
        ],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);

    expect(configs[0]?.hiddenProperties).toContain('passwordHash');
    expect(configs[0]?.hiddenProperties).toContain('refreshTokenHash');
    expect(configs[0]?.listProperties).not.toContain('passwordHash');
    expect(configs[0]?.showProperties).not.toContain('refreshTokenHash');
  });

  it('picks titleProperty from candidates (name > email > id)', () => {
    const module = makeClientModule([
      {
        name: 'ModelA',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'name', kind: 'scalar', type: 'String' },
        ],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);
    expect(configs[0]?.titleProperty).toBe('name');
  });

  it('falls back to id when no title candidates match', () => {
    const module = makeClientModule([
      {
        name: 'ModelB',
        fields: [{ name: 'uuid', kind: 'scalar', type: 'String' }],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);
    expect(configs[0]?.titleProperty).toBe('uuid');
  });

  it('defaults sort to createdAt desc when available', () => {
    const module = makeClientModule([
      {
        name: 'ModelC',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'createdAt', kind: 'scalar', type: 'DateTime' },
        ],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);
    expect(configs[0]?.sort).toEqual({
      sortBy: 'createdAt',
      direction: 'desc',
    });
  });

  it('does not set sort when createdAt is absent', () => {
    const module = makeClientModule([
      {
        name: 'ModelD',
        fields: [{ name: 'id', kind: 'scalar', type: 'String' }],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);
    expect(configs[0]?.sort).toBeUndefined();
  });

  it('throws when models is not an array', () => {
    const badModule: PrismaClientModule = {
      Prisma: {
        dmmf: {
          datamodel: { models: 'not an array' as never },
        },
      },
    };

    expect(() => generateAdminResourceConfigs(badModule)).toThrow(
      'Unable to read Prisma DMMF models for AdminJS setup',
    );
  });

  it('limits listProperties to first 6 fields', () => {
    const fields = Array.from({ length: 10 }, (_, i) => ({
      name: `field${i}`,
      kind: 'scalar',
      type: 'String',
    }));
    const module = makeClientModule([{ name: 'WideModel', fields }]);

    const configs = generateAdminResourceConfigs(module);
    expect(configs[0]?.listProperties).toHaveLength(6);
  });

  it('applies coreResourceOverrides when model name matches', () => {
    const module = makeClientModule([
      {
        name: 'User',
        fields: [
          { name: 'id', kind: 'scalar', type: 'String' },
          { name: 'email', kind: 'scalar', type: 'String' },
          { name: 'passwordHash', kind: 'scalar', type: 'String' },
          { name: 'createdAt', kind: 'scalar', type: 'DateTime' },
        ],
      },
    ]);

    const configs = generateAdminResourceConfigs(module);

    expect(configs[0]?.navigation).toBe('Users');
    expect(configs[0]?.titleProperty).toBe('email');
    expect(configs[0]?.listProperties).toEqual([
      'id',
      'email',
      'nickname',
      'status',
      'createdAt',
    ]);
  });
});
