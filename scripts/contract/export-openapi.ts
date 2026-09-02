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
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

async function main() {
  delete process.env.REDIS_URL;
  process.env.OPENAPI_EXPORT_SKIP_DB_CONNECT = 'true';
  process.env.OPENAPI_EXPORT_SKIP_REDIS = 'true';

  // The OpenAPI export builds the application only to introspect controllers
  // and DTOs. It never starts the HTTP server or connects to real infra, so
  // missing secrets should not block artifact generation. Provide safe
  // placeholders for required environment variables when they are absent.
  setIfMissing(
    'BETTER_AUTH_SECRET',
    'better-auth-export-only-placeholder-0000',
  );
  setIfMissing('BETTER_AUTH_URL', 'http://localhost:3000');
  setIfMissing('JWT_ACCESS_SECRET', 'jwt-access-export-only-placeholder-000');
  setIfMissing('JWT_REFRESH_SECRET', 'jwt-refresh-export-only-placeholder-00');
  setIfMissing('ADMIN_EMAIL', 'admin@example.com');
  setIfMissing('ADMIN_PASSWORD', 'admin-export-only-placeholder-00');
  setIfMissing('ADMIN_COOKIE_SECRET', 'admin-cookie-export-only-placeholder-0');

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
      extraModels: [
        problemDetails.ProblemDetailsDto,
        problemDetails.SseProblemDetailsDto,
      ],
    },
  );

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
