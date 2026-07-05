const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJson(value[key])]),
    );
  }
  return value;
}

function hasSemanticJsonDiff(committedText, generatedText) {
  const committed = normalizeJson(JSON.parse(committedText));
  const generated = normalizeJson(JSON.parse(generatedText));
  return JSON.stringify(committed) !== JSON.stringify(generated);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const openApiPath = path.resolve(repoRoot, 'docs', 'openapi.json');

  if (!fs.existsSync(openApiPath)) {
    console.error(`OpenAPI file not found: ${openApiPath}`);
    process.exit(1);
  }

  const diffResult = spawnSync(
    'git',
    ['diff', '--no-ext-diff', '--unified=0', '--', 'docs/openapi.json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  if (diffResult.status !== 0 && diffResult.status !== 1) {
    console.error(diffResult.stderr || diffResult.stdout);
    process.exit(diffResult.status ?? 1);
  }

  if (!diffResult.stdout.trim()) {
    console.log('Committed OpenAPI matches generated output.');
    return;
  }

  const workingTreeText = fs.readFileSync(openApiPath, 'utf8');
  const committedTextResult = spawnSync(
    'git',
    ['show', 'HEAD:docs/openapi.json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  if (committedTextResult.status !== 0) {
    console.error(committedTextResult.stderr || committedTextResult.stdout);
    process.exit(committedTextResult.status ?? 1);
  }

  if (!hasSemanticJsonDiff(committedTextResult.stdout, workingTreeText)) {
    console.log(
      'Committed OpenAPI is semantically unchanged; only formatting differs.',
    );
    return;
  }

  console.error(
    'OpenAPI schema drift detected. Re-run `pnpm export:openapi` and commit the updated docs/openapi.json.',
  );
  process.exit(1);
}

module.exports = {
  hasSemanticJsonDiff,
};

if (require.main === module) {
  main();
}
