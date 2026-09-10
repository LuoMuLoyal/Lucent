import type { ConfigService } from '@nestjs/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { EnvKey } from '../config/env/env-keys.enum.js';
import { registerAdminPanel } from './setup.js';
import { buildPrismaClientModule } from './services/prisma-module.service.js';
import { generateAdminResourceConfigs } from './services/resource-config.service.js';
import type {
  AdminResourceConfig,
  PrismaClientModule,
} from './types/admin.types.js';

// 门控测试只关心"是否进入了注册路径",因此把三个面板依赖换成空壳,
// 避免真的加载 adminjs 与建路由(那部分由 buildPrismaClientModule 等用例覆盖)。
vi.mock('adminjs', () => ({ default: { registerAdapter: vi.fn() } }));
vi.mock('@adminjs/fastify', () => ({ buildAuthenticatedRouter: vi.fn() }));
vi.mock('@sergiyiva/adminjs-prisma', () => ({
  // registerAdapter 在下面的 mock adminjs 里是空实现,这里给普通对象即可
  // (用空 class 会触发 typescript/no-extraneous-class)。
  Database: {},
  Resource: {},
  getModelByName: vi.fn(),
}));

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

    expect(config.hiddenProperties).toContain('profile');
    expect(config.hiddenProperties).toContain('sessions');
  });

  it('keeps manual overrides for core models', () => {
    const configs = generateAdminResourceConfigs(clientModule);
    const userConfig = getConfig(configs, 'User');

    expect(userConfig.navigation).toBe('Users');
    expect(userConfig.titleProperty).toBe('email');
    expect(userConfig.listProperties).toContain('email');
    expect(userConfig.listProperties).not.toContain('password');

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

describe('registerAdminPanel gating', () => {
  function makeConfigService(adminEnabled: string | undefined): ConfigService {
    // 形参用 EnvKey 而非常量 string:与枚举成员比较需要共享枚举类型
    // (否则触发 @typescript-eslint/no-unsafe-enum-comparison)。
    const get = (key: EnvKey): string | undefined =>
      key === EnvKey.ADMIN_ENABLED ? adminEnabled : undefined;
    return { get } as unknown as ConfigService;
  }

  it('skips registration entirely when ADMIN_ENABLED=false', async () => {
    const get = vi.fn();
    const app = { get } as unknown as NestFastifyApplication;

    await registerAdminPanel(app, makeConfigService('false'));

    // 完全没碰应用:既没取 PrismaService,也没注册路由(从而不加载 adminjs)。
    expect(get).not.toHaveBeenCalled();
  });

  it('enters the registration path for any value other than "false"', async () => {
    const app = {
      get: () => {
        throw new Error('registration path reached');
      },
    } as unknown as NestFastifyApplication;

    for (const value of ['true', undefined]) {
      await expect(
        registerAdminPanel(app, makeConfigService(value)),
      ).rejects.toThrow('registration path reached');
    }
  });
});
