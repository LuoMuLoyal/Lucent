import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response, Router } from 'express';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { getDMMF } from '@prisma/internals';
import type AdminJSDefault from 'adminjs';
import type {
  BaseDatabase,
  BaseResource,
  ResourceOptions,
  ResourceWithOptions,
} from 'adminjs';
import { PrismaService } from '../prisma/prisma.service';

const ADMIN_ROOT_PATH = '/admin';
const SCHEMA_PATH = 'prisma/schema.prisma';
const ADMIN_EMAIL_KEY = 'ADMIN_EMAIL';
const ADMIN_PASSWORD_KEY = 'ADMIN_PASSWORD';
const ADMIN_COOKIE_SECRET_KEY = 'ADMIN_COOKIE_SECRET';
const NODE_ENV_KEY = 'NODE_ENV';

const DEFAULT_SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'refreshTokenHash',
  'pushToken',
  'rawProfile',
]);

const AUTO_TITLE_PROPERTY_CANDIDATES = [
  'name',
  'email',
  'contentZh',
  'title',
  'nickname',
  'id',
];

type DynamicImport = <T>(specifier: string) => Promise<T>;
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- SWC compiles normal dynamic import to require() in this CJS build.
const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as DynamicImport;

type AdminJSConstructor = typeof AdminJSDefault;

interface AdminJsModule {
  default: AdminJSConstructor;
  Router: {
    assets: AdminAsset[];
  };
}

interface AdminJsExpressModule {
  buildAuthenticatedRouter: (
    admin: AdminJSDefault,
    auth: {
      cookieName: string;
      cookiePassword: string;
      authenticate: (email: string, password: string) => AdminUser | null;
    },
    predefinedRouter: null,
    sessionOptions: {
      resave: boolean;
      saveUninitialized: boolean;
      secret: string;
      name: string;
      cookie: {
        httpOnly: boolean;
        sameSite: 'lax';
        secure: boolean;
      };
    },
  ) => Router;
}

interface AdminJsPrismaModule {
  Database: typeof BaseDatabase;
  Resource: typeof BaseResource;
  getModelByName: (name: string, clientModule?: PrismaClientModule) => unknown;
}

export interface PrismaClientModule {
  Prisma: {
    dmmf: {
      datamodel: {
        models: PrismaDmmfModel[];
      };
    };
  };
}

interface AdminUser {
  email: string;
}

interface AdminAsset {
  path: string;
  src: string;
}

interface PrismaDmmfModel {
  name: string;
  fields: PrismaDmmfField[];
}

interface PrismaDmmfField {
  name: string;
  kind: 'scalar' | 'object' | 'enum';
  type: string;
}

export interface AdminResourceConfig {
  modelName: string;
  navigation: string;
  listProperties: string[];
  showProperties: string[];
  filterProperties: string[];
  titleProperty?: string;
  sort?: ResourceOptions['sort'];
  hiddenProperties?: string[];
  readOnly?: boolean;
  properties?: ResourceOptions['properties'];
}

/**
 * Manual overrides for well-known models. Any model not listed here is still
 * discovered automatically from the Prisma DMMF and gets sensible defaults.
 */
const coreResourceOverrides: Record<string, Partial<AdminResourceConfig>> = {
  User: {
    navigation: 'Users',
    listProperties: ['id', 'email', 'nickname', 'status', 'createdAt'],
    showProperties: [
      'id',
      'email',
      'nickname',
      'avatar',
      'status',
      'emailVerifiedAt',
      'lastLoginAt',
      'deletedAt',
      'createdAt',
      'updatedAt',
    ],
    filterProperties: ['email', 'nickname', 'status', 'createdAt'],
    titleProperty: 'email',
    sort: { sortBy: 'createdAt', direction: 'desc' },
    hiddenProperties: ['passwordHash'],
  },
  UserProfile: {
    navigation: 'Users',
    listProperties: ['userId', 'sexAtBirth', 'heightCm', 'bloodType', 'locale'],
    showProperties: [
      'userId',
      'birthDate',
      'sexAtBirth',
      'heightCm',
      'pregnancyState',
      'lactationState',
      'bloodType',
      'locale',
      'timezone',
      'unitSystem',
      'onboardingCompletedAt',
      'extras',
      'createdAt',
      'updatedAt',
    ],
    filterProperties: ['userId', 'sexAtBirth', 'bloodType', 'locale'],
    titleProperty: 'userId',
  },
  DrugbankDrug: {
    navigation: 'Medicine Knowledge',
    listProperties: ['drugbankId', 'name', 'drugType', 'casNumber'],
    showProperties: [
      'drugbankId',
      'name',
      'drugType',
      'casNumber',
      'unii',
      'state',
      'groups',
      'indication',
      'mechanismOfAction',
      'createdAt',
      'updatedAt',
    ],
    filterProperties: ['drugbankId', 'name', 'drugType', 'casNumber'],
    titleProperty: 'name',
  },
  CnMedicineProduct: {
    navigation: 'Medicine Knowledge',
    listProperties: [
      'id',
      'name',
      'manufacturer',
      'approvalNumber',
      'drugType',
      'mainCategory',
    ],
    showProperties: [
      'id',
      'sourceName',
      'name',
      'manufacturer',
      'approvalNumber',
      'drugType',
      'mainCategory',
      'subcategory',
      'brandName',
      'ingredients',
      'indications',
      'dosage',
      'sourceUrl',
      'createdAt',
      'updatedAt',
    ],
    filterProperties: [
      'name',
      'manufacturer',
      'approvalNumber',
      'drugType',
      'mainCategory',
    ],
    titleProperty: 'name',
  },
  UserDailyRecord: {
    navigation: 'Health Records',
    listProperties: ['id', 'userId', 'kind', 'occurredAt', 'title', 'value'],
    showProperties: [
      'id',
      'userId',
      'kind',
      'occurredAt',
      'occurredTime',
      'title',
      'value',
      'unit',
      'note',
      'payload',
      'source',
      'deletedAt',
      'createdAt',
      'updatedAt',
    ],
    filterProperties: ['userId', 'kind', 'occurredAt', 'deletedAt'],
    sort: { sortBy: 'occurredAt', direction: 'desc' },
  },
  UserDailyRecordAttachment: {
    navigation: 'Health Records',
    listProperties: [
      'id',
      'userId',
      'recordId',
      'kind',
      'provider',
      'objectKey',
    ],
    showProperties: [
      'id',
      'userId',
      'recordId',
      'kind',
      'objectKey',
      'bucket',
      'provider',
      'fileName',
      'contentType',
      'sizeBytes',
      'width',
      'height',
      'publicUrl',
      'createdAt',
    ],
    filterProperties: ['userId', 'recordId', 'kind', 'provider'],
    sort: { sortBy: 'createdAt', direction: 'desc' },
  },
  UserMedicineDoseLog: {
    navigation: 'Health Records',
    listProperties: [
      'id',
      'userId',
      'status',
      'scheduledFor',
      'currentMedicineId',
    ],
    showProperties: [
      'id',
      'userId',
      'currentMedicineId',
      'status',
      'scheduledFor',
      'takenAt',
      'doseText',
      'note',
      'source',
      'deletedAt',
      'createdAt',
      'updatedAt',
    ],
    filterProperties: ['userId', 'status', 'scheduledFor', 'currentMedicineId'],
    sort: { sortBy: 'scheduledFor', direction: 'desc' },
  },
  MedicineSafetyTip: {
    navigation: 'Medicine Knowledge',
    listProperties: [
      'id',
      'contentZh',
      'contentEn',
      'category',
      'sortOrder',
      'isActive',
    ],
    showProperties: [
      'id',
      'contentZh',
      'contentEn',
      'category',
      'sortOrder',
      'isActive',
      'createdAt',
      'updatedAt',
    ],
    filterProperties: ['category', 'isActive'],
    titleProperty: 'contentZh',
    sort: { sortBy: 'sortOrder', direction: 'asc' },
    readOnly: false,
    properties: {
      category: {
        availableValues: [
          { value: 'alcohol', label: 'alcohol' },
          { value: 'caffeine', label: 'caffeine' },
          { value: 'timing', label: 'timing' },
          { value: 'storage', label: 'storage' },
          { value: 'food', label: 'food' },
          { value: 'pregnancy', label: 'pregnancy' },
          { value: 'allergy', label: 'allergy' },
          { value: 'driving', label: 'driving' },
        ],
      },
    },
  },
};

export async function registerAdminPanel(
  app: INestApplication,
  configService: ConfigService,
): Promise<void> {
  const [adminJsModule, adminExpressModule, adminPrismaModule] =
    await Promise.all([
      dynamicImport<AdminJsModule>('adminjs'),
      dynamicImport<AdminJsExpressModule>('@adminjs/express'),
      dynamicImport<AdminJsPrismaModule>('@sergiyiva/adminjs-prisma'),
    ]);

  const AdminJS = adminJsModule.default;
  const { buildAuthenticatedRouter } = adminExpressModule;
  const { Database, Resource, getModelByName } = adminPrismaModule;

  AdminJS.registerAdapter({ Database, Resource });

  const prisma = app.get(PrismaService);
  const clientModule = await buildPrismaClientModule();
  const resources = buildResources(getModelByName, prisma, clientModule);
  const admin = new AdminJS({
    rootPath: ADMIN_ROOT_PATH,
    branding: {
      companyName: 'Lucent Admin',
      withMadeWithLove: false,
    },
    resources,
  });

  const adminEmail = configService.getOrThrow<string>(ADMIN_EMAIL_KEY);
  const adminPassword = configService.getOrThrow<string>(ADMIN_PASSWORD_KEY);
  const cookieSecret = configService.getOrThrow<string>(
    ADMIN_COOKIE_SECRET_KEY,
  );
  const isProduction = configService.get<string>(NODE_ENV_KEY) === 'production';

  const router = buildAuthenticatedRouter(
    admin,
    {
      cookieName: 'lucent-admin',
      cookiePassword: cookieSecret,
      authenticate: (email, password) =>
        email === adminEmail && password === adminPassword
          ? { email: adminEmail }
          : null,
    },
    null,
    {
      resave: false,
      saveUninitialized: false,
      secret: cookieSecret,
      name: 'lucent-admin',
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
    },
  );

  registerAdminStaticAssets(
    app,
    admin.options.rootPath,
    adminJsModule.Router.assets,
  );
  app.use(admin.options.rootPath, router);
}

function registerAdminStaticAssets(
  app: INestApplication,
  rootPath: string,
  assets: AdminAsset[],
): void {
  assets.forEach((asset) => {
    app.use(
      `${rootPath}${asset.path}`,
      (req: Request, res: Response, next: NextFunction) => {
        void sendAdminStaticAsset(req, res, asset).catch((error: unknown) => {
          next(error instanceof Error ? error : new Error(String(error)));
        });
      },
    );
  });
}

async function sendAdminStaticAsset(
  req: Request,
  res: Response,
  asset: AdminAsset,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.sendStatus(405);
    return;
  }

  const assetStats = await stat(asset.src);
  res.type(extname(asset.src));
  res.setHeader('Content-Length', String(assetStats.size));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(asset.src);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

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

export function generateAdminResourceConfigs(
  clientModule: PrismaClientModule,
): AdminResourceConfig[] {
  const models = getDmmfModels(clientModule);

  return models.map((model) => {
    const override = coreResourceOverrides[model.name];
    return buildAdminResourceConfig(model, override);
  });
}

function getDmmfModels(clientModule: PrismaClientModule): PrismaDmmfModel[] {
  const models = clientModule.Prisma.dmmf.datamodel.models;
  if (!Array.isArray(models)) {
    throw new Error('Unable to read Prisma DMMF models for AdminJS setup');
  }
  return models;
}

function buildAdminResourceConfig(
  model: PrismaDmmfModel,
  override?: Partial<AdminResourceConfig>,
): AdminResourceConfig {
  const scalarFields = model.fields.filter((field) => field.kind !== 'object');
  const scalarFieldNames = scalarFields.map((field) => field.name);
  const relationFieldNames = model.fields
    .filter((field) => field.kind === 'object')
    .map((field) => field.name);

  const sensitiveScalarFields = scalarFieldNames.filter((name) =>
    DEFAULT_SENSITIVE_FIELDS.has(name),
  );
  const hiddenProperties = unique([
    ...relationFieldNames,
    ...sensitiveScalarFields,
    ...(override?.hiddenProperties ?? []),
  ]);
  const visibleFieldNames = scalarFieldNames.filter(
    (name) => !hiddenProperties.includes(name),
  );

  const titleProperty =
    override?.titleProperty ?? pickTitleProperty(scalarFieldNames);
  const sort =
    override?.sort ??
    (visibleFieldNames.includes('createdAt')
      ? { sortBy: 'createdAt', direction: 'desc' as const }
      : undefined);

  return {
    modelName: model.name,
    navigation: override?.navigation ?? model.name,
    listProperties: override?.listProperties ?? visibleFieldNames.slice(0, 6),
    showProperties: override?.showProperties ?? visibleFieldNames,
    filterProperties: override?.filterProperties ?? visibleFieldNames,
    titleProperty,
    hiddenProperties,
    ...(sort !== undefined && { sort }),
    ...(override?.properties !== undefined && {
      properties: override.properties,
    }),
    ...(override?.readOnly !== undefined && { readOnly: override.readOnly }),
  };
}

function pickTitleProperty(fieldNames: string[]): string {
  for (const candidate of AUTO_TITLE_PROPERTY_CANDIDATES) {
    if (fieldNames.includes(candidate)) {
      return candidate;
    }
  }
  return fieldNames[0] ?? 'id';
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildResources(
  getModelByName: AdminJsPrismaModule['getModelByName'],
  prisma: PrismaService,
  clientModule: PrismaClientModule,
): ResourceWithOptions[] {
  const configs = generateAdminResourceConfigs(clientModule);

  return configs.map((config) =>
    buildResource(config, getModelByName, prisma, clientModule),
  );
}

function buildResource(
  resourceConfig: AdminResourceConfig,
  getModelByName: AdminJsPrismaModule['getModelByName'],
  prisma: PrismaService,
  clientModule: PrismaClientModule,
): ResourceWithOptions {
  const options: ResourceOptions = {
    id: resourceConfig.modelName,
    navigation: resourceConfig.navigation,
    listProperties: resourceConfig.listProperties,
    showProperties: resourceConfig.showProperties,
    filterProperties: resourceConfig.filterProperties,
    properties: {},
  };

  if (resourceConfig.titleProperty !== undefined) {
    options.titleProperty = resourceConfig.titleProperty;
  }
  if (resourceConfig.sort !== undefined) {
    options.sort = resourceConfig.sort;
  }

  if (
    resourceConfig.hiddenProperties !== undefined &&
    resourceConfig.hiddenProperties.length > 0
  ) {
    options.properties = buildPropertyOptions(resourceConfig.hiddenProperties);
  }

  if (resourceConfig.properties !== undefined) {
    options.properties = {
      ...options.properties,
      ...resourceConfig.properties,
    };
  }

  return {
    resource: {
      model: getModelByName(resourceConfig.modelName, clientModule),
      client: prisma,
      clientModule,
    },
    options,
  };
}

function buildPropertyOptions(
  hiddenProperties: string[],
): NonNullable<ResourceOptions['properties']> {
  return Object.fromEntries(
    hiddenProperties.map((property) => [
      property,
      { isVisible: false, isDisabled: true },
    ]),
  );
}
