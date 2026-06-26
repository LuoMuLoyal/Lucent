import {
  buildPrismaClientModule,
  generateAdminResourceConfigs,
  type AdminResourceConfig,
  type PrismaClientModule,
} from './adminjs.setup';

describe('AdminJS resource config generation', () => {
  let clientModule: PrismaClientModule;

  beforeAll(async () => {
    clientModule = await buildPrismaClientModule();
  }, 30_000);

  function getConfig(
    configs: AdminResourceConfig[],
    modelName: string,
  ): AdminResourceConfig {
    const config = configs.find((item) => item.modelName === modelName);
    if (config === undefined) {
      throw new Error(`Missing AdminJS config for model ${modelName}`);
    }
    return config;
  }

  it('generates a config for every Prisma model', () => {
    const configs = generateAdminResourceConfigs(clientModule);
    const modelNames = clientModule.Prisma.dmmf.datamodel.models.map(
      (model) => model.name,
    );

    expect(configs.map((config) => config.modelName).sort()).toEqual(
      modelNames.sort(),
    );
  });

  it('hides relation fields and sensitive scalar fields by default', () => {
    const config = getConfig(
      generateAdminResourceConfigs(clientModule),
      'User',
    );

    expect(config.hiddenProperties).toContain('passwordHash');
    expect(config.hiddenProperties).toContain('profile');
    expect(config.hiddenProperties).toContain('sessions');
    expect(config.hiddenProperties).toContain('identities');
  });

  it('keeps manual overrides for core models', () => {
    const configs = generateAdminResourceConfigs(clientModule);
    const userConfig = getConfig(configs, 'User');

    expect(userConfig.navigation).toBe('Users');
    expect(userConfig.titleProperty).toBe('email');
    expect(userConfig.listProperties).toContain('email');
    expect(userConfig.listProperties).not.toContain('passwordHash');

    const tipConfig = getConfig(configs, 'MedicineSafetyTip');

    expect(tipConfig.navigation).toBe('Medicine Knowledge');
    expect(
      tipConfig.properties?.['category']?.['availableValues'],
    ).toHaveLength(8);
  });

  it('defaults all resources to full CRUD (readOnly is not true)', () => {
    const configs = generateAdminResourceConfigs(clientModule);
    const readOnlyResources = configs.filter((config) => config.readOnly);

    expect(readOnlyResources).toHaveLength(0);
  });

  it('auto-assigns navigation and title properties to unknown models', () => {
    const configs = generateAdminResourceConfigs(clientModule);
    const userSession = getConfig(configs, 'UserSession');

    expect(userSession.navigation).toBe('UserSession');
    expect(userSession.titleProperty).toBeDefined();
    expect(userSession.listProperties.length).toBeGreaterThan(0);
    expect(userSession.showProperties.length).toBeGreaterThan(0);
    expect(userSession.filterProperties.length).toBeGreaterThan(0);
  });
});
