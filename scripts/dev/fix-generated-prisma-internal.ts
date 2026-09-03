import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformFile } from '@swc/core';

// ESM equivalent of __dirname (scripts/ is a "type": "module" package).
const thisDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prisma 7's `prisma-client` generator emits only `.ts` files.
 * The runtime (compiled `dist/`, ESM since the full-repo ESM switch) imports
 * `generated/prisma/client.js`, so we must transpile every `.ts` file under
 * `generated/prisma/` (both root-level and `internal/`) to `.js` using SWC
 * with ES module output — the root `package.json` is `"type": "module"`, so
 * `.js` artifacts are interpreted as ESM. SWC is significantly faster than
 * the TypeScript compiler for single-file transpilation.
 */
async function transpileDir(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    const sourcePath = path.join(dir, entry.name);
    const outputPath = sourcePath.replace(/\.ts$/, '.js');
    const result = await transformFile(sourcePath, {
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
      },
      module: {
        type: 'es6',
      },
    });
    await fs.writeFile(outputPath, result.code, 'utf8');
  }
}

async function main() {
  const prismaDir = path.resolve(thisDir, '../../generated/prisma');

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
