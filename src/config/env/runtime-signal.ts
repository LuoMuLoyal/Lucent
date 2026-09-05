/**
 * Detects whether the current process is running from **source** (e.g.
 * `pnpm start:dev` via ts-node / SWC) or from a **compiled image**
 * (`dist/`, `build/`, or any other output directory).
 *
 * The check walks up from the calling module's `import.meta.url` directory
 * and inspects each ancestor's basename: a `src` ancestor means source,
 * a known build-output name (`dist` / `build` / `lib`) means compiled.
 * This centralises the src-vs-dist assumption so a future
 * `compilerOptions.outputPath` change only needs to update the list below.
 *
 * Used by:
 * - `app.module.ts` — gate `TestingSupportModule` (NODE_ENV=test + source only)
 * - `i18n.module.ts` — gate `typesOutputPath` (NODE_ENV=development + source only)
 */

import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory names that `nest build` / bundlers commonly emit into. */
const BUILD_OUTPUT_NAMES = new Set(['dist', 'build', 'lib']);

export function isRunningFromSource(): boolean {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // Walk up from the module's directory toward the project root, inspecting
  // each ancestor's basename. Handles both `src/app.module.ts` (one level
  // up is `src`) and `src/i18n/i18n.module.ts` (one level up is `i18n`,
  // two levels up is `src`).
  const parts = moduleDir.split(sep);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const name = parts[i];
    if (name === undefined) continue;
    if (name === 'src') return true;
    if (BUILD_OUTPUT_NAMES.has(name)) return false;
  }
  return false;
}
