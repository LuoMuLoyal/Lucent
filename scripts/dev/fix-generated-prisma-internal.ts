const fs = require('node:fs/promises');
const path = require('node:path');
const ts = require('typescript');

async function main() {
  const internalDir = path.resolve(
    __dirname,
    '../../generated/prisma/internal',
  );
  const entries = await fs.readdir(internalDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) {
      continue;
    }

    const sourcePath = path.join(internalDir, entry.name);
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

main().catch((error) => {
  console.error('Failed to transpile generated Prisma internal files:', error);
  process.exitCode = 1;
});
