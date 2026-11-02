import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { FastifyAdapter } from '@nestjs/platform-fastify';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Generated region markers: module READMEs may reserve an endpoint summary
 * block between these markers; the export backfills it from the freshly
 * generated spec, so endpoint prose never goes stale by hand.
 */
const REGION_RE =
  /<!--[\s]*@generated openapi:BEGIN prefix=([^\s]+)[\s]*-->[\s\S]*?<!--[\s]*@generated openapi:END[\s]*-->/g;

/**
 * Rewrite a JSON-Schema (zod `toJSONSchema`) node into an OpenAPI 3.0
 * compatible schema: drops JSON-Schema-only keys the OpenAPI generator
 * rejects (`$schema`, `propertyNames`, …) and folds `anyOf` nullable
 * branches into `nullable: true`.
 */
function openApiSchema(node) {
  if (Array.isArray(node)) return node.map((n) => openApiSchema(n));
  if (node === null || typeof node !== 'object') return node;
  if (
    Array.isArray(node.anyOf) &&
    node.anyOf.length === 2 &&
    node.anyOf.some(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (branch: any) => branch != null && branch.type === 'null',
    )
  ) {
    const other = node.anyOf.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (branch: any) => branch != null && branch.type !== 'null',
    );
    return openApiSchema({ ...other, nullable: true });
  }
  const OPENAPI_SCHEMA_KEYS = new Set([
    'type',
    'format',
    'title',
    'description',
    'default',
    'enum',
    'items',
    'properties',
    'required',
    'additionalProperties',
    'nullable',
    'allOf',
    'anyOf',
    'oneOf',
    '$ref',
    'pattern',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minItems',
    'maxItems',
    'minProperties',
    'maxProperties',
    'uniqueItems',
    'example',
    'examples',
    'readOnly',
    'writeOnly',
    'deprecated',
  ]);
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (!OPENAPI_SCHEMA_KEYS.has(key)) continue;
    if (key === 'properties' && value && typeof value === 'object') {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          openApiSchema(child),
        ]),
      );
    } else if (
      (key === 'items' || key === 'additionalProperties') &&
      value &&
      typeof value === 'object'
    ) {
      out[key] = openApiSchema(value);
    } else if (
      (key === 'allOf' || key === 'anyOf' || key === 'oneOf') &&
      Array.isArray(value)
    ) {
      out[key] = value.map((child) => openApiSchema(child));
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Render one compact line per operation for paths under `prefix`. */
function renderRegionEntries(document, prefix) {
  const lines = [];
  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    if (route !== prefix && !route.startsWith(`${prefix}/`)) continue;
    for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
      const op = pathItem[method];
      if (!op) continue;
      const label = op.summary ?? op.operationId ?? '';
      lines.push(
        `- \`${method.toUpperCase()} ${route}\`${label ? ` — ${label}` : ''}`,
      );
    }
  }
  return lines.sort().join('\n');
}

/**
 * Backfill `<!-- @generated openapi:BEGIN prefix=… -->` regions inside
 * `src/modules/<name>/README.md` from the generated document. Idempotent: a
 * clean re-export produces zero diff.
 */
function fillGeneratedRegions(repoRoot, document) {
  const modulesDir = path.resolve(repoRoot, 'src', 'modules');
  if (!fs.existsSync(modulesDir)) return;
  let filled = 0;
  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const readmePath = path.join(modulesDir, entry.name, 'README.md');
    if (!fs.existsSync(readmePath)) continue;
    const original = fs.readFileSync(readmePath, 'utf-8');
    let hits = 0;
    const updated = original.replace(REGION_RE, (marker, prefix) => {
      hits += 1;
      return `<!-- @generated openapi:BEGIN prefix=${prefix} -->\n${renderRegionEntries(document, prefix)}\n<!-- @generated openapi:END -->`;
    });
    if (hits > 0 && updated !== original) {
      fs.writeFileSync(readmePath, updated, 'utf-8');
      filled += hits;
    }
  }
  if (filled > 0) console.log(`Generated regions filled: ${filled}`);
}

/**
 * Format JSON with the repo's prettier config (scripts/format uses prettier).
 * Keeps `docs/reference/generated/openapi.json` in the same style as a
 * committed artifact, so re-running the export produces zero diff on a clean
 * tree.
 */
async function formatJsonWithRepoPrettier(content, outputPath, repoRoot) {
  const prettier = await import('prettier');
  const prettierConfig = await prettier.resolveConfig(repoRoot);
  return prettier.format(content, {
    ...prettierConfig,
    filepath: outputPath,
  });
}

/**
 * Match the worktree line-ending convention: with `core.autocrlf=true` (the
 * Windows default) git checks files out as CRLF, so an LF write would show a
 * cosmetic "modified" state until git touches the file. CI (autocrlf unset)
 * keeps LF. Prettier emits LF; convert only when the worktree expects CRLF —
 * and never convert content that is already CRLF (e.g. a prettier config with
 * `endOfLine: crlf`), which would corrupt it with `\r\r\n` sequences.
 */
function toWorktreeEol(content, repoRoot) {
  if (content.includes('\r\n')) return content;
  try {
    const autocrlf = execSync('git config --get core.autocrlf', {
      cwd: repoRoot,
      encoding: 'utf-8',
    })
      .trim()
      .toLowerCase();
    return autocrlf === 'true' ? content.replace(/\n/g, '\r\n') : content;
  } catch {
    return content;
  }
}

function setIfMissing(key: string, value: string) {
  // Falsy (not just undefined) on purpose: `.env.development` ships these keys
  // with an empty value, and the schema validates a present-but-blank URI as a
  // present value — so an empty string still fails `z.url()`.
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

/**
 * Collect every `operationId` annotated in `src/**` controller code.
 *
 * The operationId is a property of the endpoint, so it lives on the handler's
 * `@ApiOperation` — next to the `@Get`/`@Post` it names. That keeps a rename
 * and its operationId in one edit and one diff, and removes the failure mode a
 * separate lookup table had: an unmapped or stale key silently exported the
 * mechanical `Controller_method` name instead.
 *
 * Scanning the source (rather than reading the previous export) means the
 * guard below sees what is *actually* annotated, including duplicates that
 * would otherwise collapse into whichever handler Swagger reached last.
 */
function collectAnnotatedOperationIds(repoRoot: string): Set<string> {
  const ids = new Set<string>();
  const duplicates: string[] = [];
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
        files.push(full);
    }
  };
  const srcRoot = path.resolve(repoRoot, 'src');
  if (!fs.existsSync(srcRoot)) return ids;
  visit(srcRoot);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8');
    for (const match of source.matchAll(/operationId:\s*'([^']+)'/g)) {
      const id = match[1]!;
      if (ids.has(id))
        duplicates.push(`${id} (${path.relative(repoRoot, file)})`);
      ids.add(id);
    }
  }
  if (duplicates.length > 0) {
    throw new Error(
      `[openapi-export] duplicate operationId annotated in src/: ${duplicates.join(', ')}. ` +
        'operationId is the client method name, so it must be unique across the whole API.',
    );
  }
  return ids;
}

/** PascalCase a camelCase identifier: `changeEmail` → `ChangeEmail`. */
function toPascalCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Semantic request component name for a *new* operationId (already camelCase,
 * e.g. `changeEmail`): `ChangeEmailRequest`. AIP-136 RPC-style.
 */
function toRequestComponentName(operationId: string): string {
  return toPascalCase(operationId) + 'Request';
}

/**
 * Strip a trailing `Dto` suffix from a component name so promoted inline
 * children are semantic even when the parent is a legacy DTO name
 * (`AccountResponseDto` → `AccountResponse`). ProblemDetails error
 * contracts keep their suffix (intentional, see response-schema.registry).
 */
function toSemanticParentName(parentName: string): string {
  if (/Dto$/.test(parentName)) return parentName.replace(/Dto$/, '');
  return parentName;
}

/**
 * Promote inline object / array-of-object schema properties into named
 * components (`<Parent><Field>` PascalCase, e.g. `DailyRecordListItem`,
 * `AccountLinkedIdentity`) and point the parent at the new `$ref`. This
 * removes the dart-dio `<Parent>_inner` mechanical names (AIP-190 naming
 * reform §2.4): a named component maps 1:1 to a generated model class.
 *
 * Runs after response injection + request-body promotion so every registered
 * component already exists. Recurses into freshly promoted children (a
 * nested object inside a promoted child becomes `<Child><Field>`). Skips
 * fields already pointing at `$ref`, and skips resource fields that are
 * scalar enums/strings/numbers. Returns the number of components promoted.
 */
function promoteInlineObjects(document: any): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemas: Record<string, any> = document.components?.schemas ?? {};
  let promoted = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const promoteSchema = (parentName: string, parentSchema: any): void => {
    if (!parentSchema || typeof parentSchema !== 'object') return;
    // oneOf/allOf branches may hold inline objects too
    for (const branchKey of ['oneOf', 'allOf', 'anyOf']) {
      const branches = parentSchema[branchKey];
      if (Array.isArray(branches)) {
        for (const branch of branches) {
          if (branch && typeof branch === 'object' && !branch.$ref) {
            promoteSchema(parentName, branch);
          }
        }
      }
    }
    const props = parentSchema.properties;
    if (!props || typeof props !== 'object') return;
    for (const [fieldName, fieldSchema] of Object.entries(props)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const field: any = fieldSchema;
      if (!field || typeof field !== 'object' || field.$ref) continue;
      // Composition fields (oneOf/anyOf/allOf): recurse into each inline
      // branch so nested array items / objects inside them are promoted
      // (dart-dio would otherwise name them <parent>_<field>_one_of_..._inner).
      // Branches that are pure $ref lists need no promotion.
      for (const branchKey of ['oneOf', 'anyOf', 'allOf']) {
        const branches = field[branchKey];
        if (Array.isArray(branches)) {
          for (const branch of branches) {
            if (branch && typeof branch === 'object' && !branch.$ref) {
              promoteSchema(parentName, branch);
            }
          }
        }
      }
      // Determine the actual object schema (unwrap array-of-object)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let targetSchema: any = field;
      if (
        field.type === 'array' &&
        field.items &&
        typeof field.items === 'object'
      ) {
        targetSchema = field.items;
      }
      if (!targetSchema || typeof targetSchema !== 'object') continue;
      if (targetSchema.$ref) continue;
      // Only promote structured objects (with explicit `properties`).
      // Free-form `additionalProperties` maps (e.g. `Map<String, dynamic>`)
      // are left inline: promoting them yields an empty named component and the
      // generator would reject a `$ref` combined with `additionalProperties`.
      const hasProperties =
        targetSchema.properties && typeof targetSchema.properties === 'object';
      const isObjectNode = targetSchema.type === 'object' && hasProperties;
      if (!isObjectNode) continue;
      // Name: <SemanticParent><Field PascalCase> (items/data/payload -> parent-word fallback)
      const fieldPascal = toPascalCase(fieldName);
      const semanticParent = toSemanticParentName(parentName);
      const childName = `${semanticParent}${fieldPascal}`;
      // Guard: avoid clobbering an existing component with a different purpose
      if (schemas[childName] == null) {
        schemas[childName] = openApiSchema(targetSchema);
        promoted += 1;
      }
      // Point the field at the new component (preserve array wrapper)
      if (field.type === 'array') {
        field.items = { $ref: `#/components/schemas/${childName}` };
      } else {
        field.$ref = `#/components/schemas/${childName}`;
        delete field.type;
        delete field.properties;
        delete field.required;
        delete field.additionalProperties;
        delete field.description;
      }
      // Recurse into the promoted child for nested inline objects
      promoteSchema(childName, schemas[childName]);
    }
  };

  for (const [name, schema] of Object.entries(schemas)) {
    promoteSchema(name, schema);
  }

  // Top-level array schemas with inline object items: promote items into
  // a named component so dart-dio does not generate `<name>_inner`.
  for (const [name, schema] of Object.entries(schemas)) {
    if (!schema || typeof schema !== 'object' || schema.type !== 'array')
      continue;
    const items = schema.items;
    if (!items || typeof items !== 'object' || items.$ref) continue;
    const hasItemsProperties =
      items.properties && typeof items.properties === 'object';
    const isObjectItems = items.type === 'object' && hasItemsProperties;
    if (!isObjectItems) continue;
    const entryName = toArrayElementName(name);
    if (schemas[entryName] == null) {
      schemas[entryName] = openApiSchema(items);
      promoted += 1;
    }
    schema.items = { $ref: '#/components/schemas/' + entryName };
    promoteSchema(entryName, schemas[entryName]);
  }
  return promoted;
}

/**
 * Restate shared enum discriminators on the union node that owns them.
 *
 * When a union's branches each declare the same property with a *different*
 * single-value `enum` (what zod's `discriminatedUnion` emits), the dart-dio
 * generator flattens the union into one wrapper model and copies only the first
 * branch's enum onto it. The wrapper then cannot represent the other branches'
 * values at all — `MedicineDetailResponseDetail.kind` carried just `cnProduct`,
 * so a `drugbank` payload had no legal Dart value and the hand-written
 * dispatch could not name it.
 *
 * Declaring the property on the union node itself with the merged value set
 * makes the flattened wrapper carry every legal value, while each branch keeps
 * its own narrow enum — so per-branch precision survives (widening the branches
 * instead would let each variant accept the others' discriminators). The wire
 * shape is unchanged: the union already accepted exactly this value set.
 *
 * Returns the number of discriminators restated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hoistUnionDiscriminators(document: any): number {
  let hoisted = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;

    for (const branchKey of ['oneOf', 'anyOf']) {
      const branches = node[branchKey];
      if (
        !Array.isArray(branches) ||
        branches.length < 2 ||
        !branches.every(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (branch: any) =>
            branch &&
            typeof branch === 'object' &&
            !branch.$ref &&
            branch.properties &&
            typeof branch.properties === 'object',
        )
      ) {
        continue;
      }
      // Properties every branch declares.
      let shared: string[] = Object.keys(branches[0].properties);
      for (const branch of branches.slice(1)) {
        shared = shared.filter((prop) => prop in branch.properties);
      }
      for (const prop of shared) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const branchSchemas = branches.map((b: any) => b.properties[prop]);
        if (
          !branchSchemas.every(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (schema: any) => schema && Array.isArray(schema.enum),
          )
        ) {
          continue;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const merged = [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...new Set(branchSchemas.flatMap((schema: any) => schema.enum)),
        ];
        // Branches that spell the property identically need no restatement;
        // only a genuinely wider union changes the generated wrapper.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const widestBranch = Math.max(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...branchSchemas.map((schema: any) => schema.enum.length),
        );
        if (merged.length <= widestBranch) continue;

        // A union that forbids undeclared keys cannot also declare the
        // discriminator without contradicting its branches; leave it alone.
        if (node.additionalProperties === false) continue;
        node.properties ??= {};
        if (node.properties[prop] != null) continue;
        // Declare the property only — no `type` — so the union node stays a
        // pure carrier of the legal value set and the branches keep deciding
        // the shape.
        node.properties[prop] = { enum: merged };
        if (
          branches.every(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (branch: any) =>
              Array.isArray(branch.required) && branch.required.includes(prop),
          )
        ) {
          if (!Array.isArray(node.required)) node.required = [];
          if (!node.required.includes(prop)) node.required.push(prop);
        }
        hoisted += 1;
      }
    }

    for (const value of Object.values(node)) visit(value);
  };

  visit(document);
  return hoisted;
}

/**
 * Element component name for a top-level array schema with inline object
 * items. Generic structural rule (no per-schema whitelist): strip a trailing
 * `Dto`/`Response`/`List`/`Data` word, then if the base already ends in
 * `Item`/`Items` append `Entry` (avoids `SessionListItemItem`), otherwise
 * append `Item`. New array responses are handled automatically on export.
 */
function toArrayElementName(arrayName: string): string {
  let base = arrayName
    .replace(/Dto$/, '')
    .replace(/Response$/, '')
    .replace(/List$/, '')
    .replace(/Data$/, '');
  if (/Item$/.test(base) || /Items$/.test(base)) {
    return base.replace(/s$/, '') + 'Entry';
  }
  return base + 'Item';
}

async function main() {
  delete process.env.REDIS_URL;
  process.env.OPENAPI_EXPORT_SKIP_DB_CONNECT = 'true';
  process.env.OPENAPI_EXPORT_SKIP_REDIS = 'true';

  // The OpenAPI export builds the application only to introspect controllers
  // and DTOs. It never starts the HTTP server or connects to real infra, so
  // missing secrets should not block artifact generation. Provide safe
  // placeholders for required environment variables when they are absent.
  setIfMissing('JWT_ACCESS_SECRET', 'jwt-access-export-only-placeholder-000');
  setIfMissing('JWT_REFRESH_SECRET', 'jwt-refresh-export-only-placeholder-00');

  const repoRoot = path.resolve(thisDir, '..', '..');

  const appModulePath = pathToFileURL(
    path.resolve(repoRoot, 'dist', 'app.module.js'),
  ).href;
  const setupAppPath = pathToFileURL(
    path.resolve(repoRoot, 'dist', 'setup-app.js'),
  ).href;

  const appModuleImport = await import(appModulePath);
  const AppModule =
    appModuleImport.AppModule ?? appModuleImport.default?.AppModule;
  const setupAppImport = await import(setupAppPath);
  const setupApp = setupAppImport.setupApp ?? setupAppImport.default?.setupApp;
  const problemDetailsModule = await import(
    pathToFileURL(
      path.resolve(repoRoot, 'dist', 'common', 'api', 'problem-details.dto.js'),
    ).href
  );
  const problemDetails = problemDetailsModule.default ?? problemDetailsModule;

  const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await setupApp(app, app.get(ConfigService));

  const annotatedOperationIds = collectAnnotatedOperationIds(repoRoot);

  // operationId comes from the handler's `@ApiOperation({ operationId })` when
  // it has one — Swagger passes an explicit `operationId` straight through and
  // never calls this factory for that operation. Everything else falls back to
  // Nest's mechanical `<Controller>_<method>`, which the check after the export
  // rejects: every operation must carry a name, otherwise the generated client
  // method is named after the controller wiring rather than the intent.
  const seenOperationIds = new Set<string>();
  const operationIdFactory = (
    controllerKey: string,
    methodKey: string,
    version?: string,
  ): string => {
    const key = controllerKey + '_' + methodKey;
    if (seenOperationIds.has(key)) {
      throw new Error(
        `[openapi-export] duplicate operationId '${key}' from two handlers.`,
      );
    }
    seenOperationIds.add(key);
    return key;
  };

  const document = SwaggerModule.createDocument(
    app,
    {
      openapi: '3.0.0',
      info: {
        title: 'Lucent API',
        description: 'Lucent 后端 API 文档',
        version: '1.0',
      },
    },
    {
      operationIdFactory,
      extraModels: [
        problemDetails.ProblemDetailsDto,
        problemDetails.SseProblemDetailsDto,
      ],
    },
  );

  // Every exported operation must be named by an annotation, and every
  // annotation must name an exported operation. Without this pair, an endpoint
  // that lost its `@ApiOperation` silently shipped a `Controller_method` method
  // name to both clients, and a renamed handler left a dead annotation behind
  // that nothing referenced.
  const exportedOperationIds = new Set<string>();
  const unnamed: string[] = [];
  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const op: any = (pathItem as any)?.[method];
      if (!op) continue;
      const id = op.operationId as string | undefined;
      if (!id || !annotatedOperationIds.has(id)) {
        unnamed.push(
          `${method.toUpperCase()} ${route} (${id ?? 'no operationId'})`,
        );
        continue;
      }
      exportedOperationIds.add(id);
    }
  }
  if (unnamed.length > 0) {
    throw new Error(
      `[openapi-export] ${unnamed.length} operation(s) carry no @ApiOperation({ operationId }) from src/:\n  ` +
        `${unnamed.join('\n  ')}\n` +
        "Annotate the handler (e.g. `@ApiOperation({ operationId: 'listDoseLogs' })`) " +
        'so the generated client method name is the endpoint intent, not the ' +
        'controller wiring. The runtime testing-support controller is exempt ' +
        'only because it is not part of the registered document.',
    );
  }
  const staleAnnotations = [...annotatedOperationIds].filter(
    (id) => !exportedOperationIds.has(id),
  );
  if (staleAnnotations.length > 0) {
    throw new Error(
      `[openapi-export] ${staleAnnotations.length} operationId annotation(s) in src/ name no exported operation: ` +
        `${staleAnnotations.join(', ')}. Remove the annotation or restore the handler.`,
    );
  }

  // Inject registered response schemas (Standard Schema / zod) as named
  // components and point their operations at the `$ref`, since Swagger does
  // not introspect `@SerializeOptions({ schema })`. Component names match the
  // former DTO class names so the Luminous client model names stay stable.
  // Registration paths must equal the exported operation paths verbatim
  // (module mounts like the RouterModule `user` prefix included, path params
  // in `{…}` form); anything else fails the export below.
  const { z } = await import('zod');
  const { responseSchemaRegistrations } = await import(
    pathToFileURL(
      path.resolve(
        repoRoot,
        'dist',
        'common',
        'api',
        'response-schema.registry.js',
      ),
    ).href
  );
  const unresolvedRegistrations: Array<{
    path: string;
    method: string;
    componentName: string;
  }> = [];
  for (const registration of responseSchemaRegistrations) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const draft: any = document;
    draft.components ??= {};
    draft.components.schemas ??= {};
    try {
      draft.components.schemas[registration.componentName] = openApiSchema(
        z.toJSONSchema(registration.schema, { target: 'openapi-3.0' }),
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `[openapi-export] cannot convert response schema component ${registration.componentName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const operation = draft.paths?.[registration.path]?.[registration.method];
    if (!operation) {
      unresolvedRegistrations.push({
        path: registration.path,
        method: registration.method,
        componentName: registration.componentName,
      });
      continue;
    }
    // Wire the primary success response (prefer 200, then 201, then 202).
    const successCode = ['200', '201', '202'].find(
      (code) => operation?.responses?.[code] != null,
    );
    const response =
      successCode != null ? operation.responses[successCode] : undefined;
    if (response && typeof response === 'object') {
      response.description ??= registration.description ?? '';
      response.content ??= {};
      response.content['application/json'] ??= {};
      response.content['application/json'].schema = {
        $ref: `#/components/schemas/${registration.componentName}`,
      };
    }
    // Failure responses that reuse the same body shape (e.g. health probes
    // return the identical `HealthCheckResult` body with a 503 status).
    for (const status of registration.errorStatuses ?? []) {
      const errorResponse = operation?.responses?.[String(status)];
      if (errorResponse && typeof errorResponse === 'object') {
        errorResponse.description ??= '';
        errorResponse.content ??= {};
        errorResponse.content['application/json'] ??= {};
        errorResponse.content['application/json'].schema = {
          $ref: `#/components/schemas/${registration.componentName}`,
        };
      }
    }
  }
  // Promote every inline JSON request body to a per-operation named component
  // (`<SemanticOperationId>Request`, e.g. `ChangeEmailRequest`) and point the operation at the `$ref`. Request
  // bodies are normally emitted inline by Swagger; the dart-dio generator's
  // inline-model resolver names identical bodies after the first operation it
  // encounters, so content-equal bodies shared across operations collapsed
  // onto one request model (e.g. QQ/google OAuth callbacks reusing the
  // wechat-web request, session refresh reusing logout, clinic share reusing
  // preview). A per-operation component keeps each operation's client request
  // model and parameter name aligned with its operationId. The wire shape is
  // unchanged — only the schema location (inline → named `$ref`) differs.
  let requestComponents = 0;
  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const op: any = pathItem?.[method];
      const json = op?.requestBody?.content?.['application/json'];
      const schema = json?.schema;
      if (!op?.operationId || !json || !schema || typeof schema !== 'object') {
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((schema as any).$ref) continue;
      const componentName = toRequestComponentName(op.operationId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      const draft: any = document;
      draft.components ??= {};
      draft.components.schemas ??= {};
      if (draft.components.schemas[componentName] == null) {
        draft.components.schemas[componentName] = openApiSchema(schema);
        requestComponents += 1;
      }
      json.schema = { $ref: `#/components/schemas/${componentName}` };
    }
  }
  if (requestComponents > 0) {
    console.log(`Request-body components promoted: ${requestComponents}`);
  }

  // Promote inline response/request object properties into named components
  // (<Parent><Field>, AIP-190 §2.4) so the dart-dio client gets semantic
  // model names instead of <Parent>_inner mechanical ones.
  const inlinePromoted = promoteInlineObjects(document);
  if (inlinePromoted > 0) {
    console.log(`Inline object components promoted: ${inlinePromoted}`);
  }

  // Runs last so it sees the final branch shape: a union whose branches each
  // narrow the same discriminator to a different single value would otherwise
  // generate a flattened client wrapper that can only express one of them.
  const discriminatorsHoisted = hoistUnionDiscriminators(document);
  if (discriminatorsHoisted > 0) {
    console.log(`Union discriminators restated: ${discriminatorsHoisted}`);
  }

  // A registration that does not resolve to a real operation would silently
  // drop the success-schema wiring (client then sees `Response<void>`), so
  // fail the export instead of producing a partial contract.
  if (unresolvedRegistrations.length > 0) {
    for (const reg of unresolvedRegistrations) {
      // eslint-disable-next-line no-console
      console.error(
        `[openapi-export] response schema ${reg.componentName} registered for ${reg.method.toUpperCase()} ${reg.path} matches no operation in the generated document`,
      );
    }
    throw new Error(
      `[openapi-export] ${unresolvedRegistrations.length} response schema registration(s) match no operation path`,
    );
  }

  const outputPath = path.resolve(
    repoRoot,
    'docs',
    'reference',
    'generated',
    'openapi.json',
  );
  const json = `${JSON.stringify(document, null, 2)}\n`;
  const formatted = await formatJsonWithRepoPrettier(
    json,
    outputPath,
    repoRoot,
  );
  // Write via temp file + rename so the committed artifact is replaced
  // atomically (no partial file if the export fails midway).
  const tmpPath = `${outputPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, toWorktreeEol(formatted, repoRoot), 'utf-8');
    fs.renameSync(tmpPath, outputPath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }

  console.log(`OpenAPI spec exported to: ${outputPath}`);
  console.log(`Paths: ${Object.keys(document.paths).length}`);
  console.log(
    `Schemas: ${Object.keys(document.components?.schemas ?? {}).length}`,
  );
  fillGeneratedRegions(repoRoot, document);

  await app.close();
}

void main().catch((error) => {
  console.error('Export failed:', error);
  process.exit(1);
});
