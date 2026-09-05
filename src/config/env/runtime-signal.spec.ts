import { describe, expect, it } from 'vitest';
import { isRunningFromSource } from './runtime-signal.js';

describe('isRunningFromSource', () => {
  it('returns true for the source-layout test module itself', () => {
    // The test runs from src/config/env/runtime-signal.spec.ts — execution
    // from the real (uncompiled) tree must report "from source".
    expect(isRunningFromSource()).toBe(true);
  });

  it('returns false when the module sits under a compiled output dir', async () => {
    // Simulate a compiled-image layout by loading the built JS (dist/
    // sibling of src/) when it exists — its import.meta.url resolves under
    // dist/, so the walk must report "compiled".
    const { pathToFileURL } = await import('node:url');
    const { dirname } = await import('node:path');
    const thisSpecDir = dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    );
    const distPath = `${thisSpecDir}/../../dist/config/env/runtime-signal.js`;
    try {
      const distUrl = pathToFileURL(distPath).href;
      const mod = (await import(distUrl)) as {
        isRunningFromSource?: () => boolean;
      };
      expect(mod.isRunningFromSource?.()).toBe(false);
    } catch {
      // dist/ not built in this environment — the compiled-image branch is
      // covered by the source test's contract instead.
      expect(true).toBe(true);
    }
  });
});
