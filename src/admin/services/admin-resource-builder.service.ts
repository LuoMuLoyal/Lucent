import type { ResourceOptions, ResourceWithOptions } from 'adminjs';

import { generateAdminResourceConfigs } from './admin-resource-config.service';
import type {
  AdminJsPrismaModule,
  AdminResourceConfig,
  PrismaClientModule,
} from '../types/adminjs.types';
import type { PrismaService } from '../../prisma/prisma.service';

export function buildResources(
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
