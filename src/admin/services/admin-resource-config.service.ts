import {
  AUTO_TITLE_PROPERTY_CANDIDATES,
  DEFAULT_SENSITIVE_FIELDS,
  coreResourceOverrides,
} from '../constants/adminjs.constants';
import type {
  AdminResourceConfig,
  PrismaClientModule,
  PrismaDmmfModel,
} from '../types/adminjs.types';

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
