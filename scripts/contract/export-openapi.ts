const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { SwaggerModule } = require('@nestjs/swagger');
const { FastifyAdapter } = require('@nestjs/platform-fastify');

/**
 * Format JSON with the repo's prettier config (scripts/format uses prettier).
 * Keeps `docs/openapi.json` in the same style as a committed artifact, so
 * re-running the export produces zero diff on a clean tree.
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

async function main() {
  delete process.env.REDIS_URL;
  process.env.OPENAPI_EXPORT_SKIP_DB_CONNECT = 'true';
  process.env.OPENAPI_EXPORT_SKIP_REDIS = 'true';
  const repoRoot = path.resolve(__dirname, '..', '..');

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

  const outputPath = path.resolve(repoRoot, 'docs', 'openapi.json');
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

  await app.close();
}

void main().catch((error) => {
  console.error('Export failed:', error);
  process.exit(1);
});
