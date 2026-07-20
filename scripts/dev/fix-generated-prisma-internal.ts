const fs = require('node:fs/promises');
const path = require('node:path');
const ts = require('typescript');

/**
 * Prisma 7's `prisma-client` generator emits only `.ts` files.
 * The runtime (compiled `dist/`) imports `generated/prisma/client.js`,
 * so we must transpile every `.ts` file under `generated/prisma/`
 * (both root-level and `internal/`) to `.js` using the TypeScript
 * compiler with CommonJS module output.
 */
async function transpileDir(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    const sourcePath = path.join(dir, entry.name);
    const outputPath = sourcePath.replace(/\.ts$/, '.js');
    const source = await fs.readFile(sourcePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: entry.name,
    });
    await fs.writeFile(outputPath, transpiled.outputText, 'utf8');
  }
}

async function main() {
  const prismaDir = path.resolve(__dirname, '../../generated/prisma');

  // Transpile root-level .ts files (client.ts, enums.ts, models.ts, etc.)
  await transpileDir(prismaDir);

  // Transpile internal/*.ts files (class.ts, prismaNamespace.ts, etc.)
  const internalDir = path.join(prismaDir, 'internal');
  await transpileDir(internalDir);

  // Transpile models/*.ts files if the directory exists
  const modelsDir = path.join(prismaDir, 'models');
  try {
    await fs.access(modelsDir);
    await transpileDir(modelsDir);
  } catch {
    // models directory may not exist in all Prisma versions
  }
}

main().catch((error) => {
  console.error('Failed to transpile generated Prisma files:', error);
  process.exitCode = 1;
});
