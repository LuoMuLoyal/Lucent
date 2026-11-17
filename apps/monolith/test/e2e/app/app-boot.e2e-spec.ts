import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../../src/app.module.js';

/**
 * Whole-application DI boot check.
 *
 * Every other e2e suite boots a *subset* of the module graph, so a binding that
 * is missing from one module only fails when that module's own suite runs — or,
 * worse, only in production. This suite compiles the real `AppModule`, which
 * makes Nest resolve every provider in every module.
 *
 * It exists because three classes of defect are invisible to `typecheck`,
 * `lint` and module-scoped tests, and all three were hit while merging the
 * ADR-0024 four-layer migration:
 *
 * 1. a constructor parameter imported with `import type` — the binding is
 *    erased, so Nest injects `undefined` and the failure appears at the first
 *    method call ("Cannot read properties of undefined (reading 'read')");
 * 2. an `interface` used as a constructor parameter — interfaces have no
 *    runtime value, so Nest cannot use one as a token;
 * 3. a port token that is injected by name but never listed in `providers`, or
 *    a token listed in `exports` without a matching provider.
 *
 * The assertion is deliberately just "it compiles": a passing compile means the
 * container could construct every provider, which is exactly the invariant
 * these three defects break.
 */
describe('AppModule DI boot (e2e)', () => {
  it(
    'resolves every provider in the whole application',
    { timeout: 120000 },
    async () => {
      const builder = Test.createTestingModule({ imports: [AppModule] });
      // Keep Nest's own logs out of the test output; a failure still throws.
      builder.setLogger(new Logger());

      const moduleRef = await builder.compile();

      expect(moduleRef).toBeDefined();
      await moduleRef.close();
    },
  );
});
