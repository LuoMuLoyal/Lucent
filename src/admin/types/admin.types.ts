import type { BaseDatabase, BaseResource, ResourceOptions } from 'adminjs';
import type AdminJSDefault from 'adminjs';
import type { FastifyInstance } from 'fastify';

export type DynamicImport = <T>(specifier: string) => Promise<T>;

export type AdminJSConstructor = typeof AdminJSDefault;

export interface AdminJsModule {
  default: AdminJSConstructor;
  Router: {
    assets: AdminAsset[];
  };
}

export interface AdminJsFastifyModule {
  buildAuthenticatedRouter: (
    admin: AdminJSDefault,
    auth: {
      cookieName: string;
      cookiePassword: string;
      authenticate: (email: string, password: string) => AdminUser | null;
    },
    fastifyApp: FastifyInstance,
    sessionOptions?: {
      cookie?: {
        httpOnly?: boolean;
        sameSite?: 'lax' | 'strict' | 'none';
        secure?: boolean;
      };
    },
  ) => Promise<void>;
}

export interface AdminJsPrismaModule {
  Database: typeof BaseDatabase;
  Resource: typeof BaseResource;
  getModelByName: (name: string, clientModule?: PrismaClientModule) => unknown;
}

/**
 * Minimal Prisma client module shape required by the AdminJS Prisma adapter.
 */
export interface PrismaClientModule {
  Prisma: {
    dmmf: {
      datamodel: {
        models: PrismaDmmfModel[];
      };
    };
  };
}

export interface AdminUser {
  email: string;
}

export interface AdminAsset {
  path: string;
  src: string;
}

export interface PrismaDmmfModel {
  name: string;
  fields: PrismaDmmfField[];
}

export interface PrismaDmmfField {
  name: string;
  kind: 'scalar' | 'object' | 'enum';
  type: string;
}

/**
 * Configuration for a single AdminJS resource derived from a Prisma model.
 */
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
