import type { DeepMocked } from '../../common/types/deep-mocked';
import { buildResources } from './resource-builder.service';
import type { PrismaService } from '../../prisma';
import type { PrismaClientModule, AdminJsPrismaModule } from '../types';

describe('buildResources', () => {
  let mockGetModelByName: vi.Mock;
  let mockPrisma: DeepMocked<PrismaService>;
  let mockClientModule: PrismaClientModule;

  beforeEach(() => {
    mockGetModelByName = vi.fn().mockReturnValue({ name: 'Model' });
    mockPrisma = {} as DeepMocked<PrismaService>;
    mockClientModule = {
      Prisma: {
        dmmf: {
          datamodel: {
            models: [
              {
                name: 'User',
                fields: [
                  { name: 'id', kind: 'scalar', type: 'String' },
                  { name: 'email', kind: 'scalar', type: 'String' },
                  { name: 'passwordHash', kind: 'scalar', type: 'String' },
                  { name: 'createdAt', kind: 'scalar', type: 'DateTime' },
                  { name: 'posts', kind: 'object', type: 'Post' },
                ],
              },
            ],
          },
        },
      },
    };
  });

  it('returns one resource per model', () => {
    const results = buildResources(
      mockGetModelByName as AdminJsPrismaModule['getModelByName'],
      mockPrisma,
      mockClientModule,
    );

    expect(results).toHaveLength(1);
  });

  it('sets resource model via getModelByName', () => {
    const results = buildResources(
      mockGetModelByName as AdminJsPrismaModule['getModelByName'],
      mockPrisma,
      mockClientModule,
    );

    expect(mockGetModelByName).toHaveBeenCalledWith('User', mockClientModule);
    expect(results[0]?.resource).toHaveProperty('model');
    expect(results[0]?.resource).toHaveProperty('client', mockPrisma);
    expect(results[0]?.resource).toHaveProperty(
      'clientModule',
      mockClientModule,
    );
  });

  it('hides relation fields and sensitive fields', () => {
    const results = buildResources(
      mockGetModelByName as AdminJsPrismaModule['getModelByName'],
      mockPrisma,
      mockClientModule,
    );

    const options = results[0]?.options;
    // posts (relation) and passwordHash (sensitive) should be hidden
    expect(options?.properties).toHaveProperty('posts');
    expect(options?.properties).toHaveProperty('passwordHash');
    expect(options?.properties?.['posts']).toMatchObject({
      isVisible: false,
      isDisabled: true,
    });
  });

  it('sets listProperties from visible scalar fields', () => {
    const results = buildResources(
      mockGetModelByName as AdminJsPrismaModule['getModelByName'],
      mockPrisma,
      mockClientModule,
    );

    const options = results[0]?.options;
    // id, email, createdAt are visible (passwordHash is sensitive, posts is relation)
    expect(options?.listProperties).toContain('id');
    expect(options?.listProperties).toContain('email');
    expect(options?.listProperties).not.toContain('passwordHash');
    expect(options?.listProperties).not.toContain('posts');
  });

  it('applies override from coreResourceOverrides for User model', () => {
    const results = buildResources(
      mockGetModelByName as AdminJsPrismaModule['getModelByName'],
      mockPrisma,
      mockClientModule,
    );

    const options = results[0]?.options;
    expect(options?.id).toBe('User');
    expect(options?.navigation).toBe('Users');
    expect(options?.titleProperty).toBe('email');
  });
});
