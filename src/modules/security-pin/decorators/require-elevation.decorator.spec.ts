import 'reflect-metadata';

import {
  RequireSecurityElevation,
  REQUIRE_SECURITY_ELEVATION_KEY,
} from './require-elevation.decorator';

describe('RequireSecurityElevation', () => {
  it('sets REQUIRE_SECURITY_ELEVATION_KEY metadata to true on the decorated method', () => {
    class TestController {
      @RequireSecurityElevation()
      sensitiveAction() {}
    }

    const metadata = Reflect.getMetadata(
      REQUIRE_SECURITY_ELEVATION_KEY,
      TestController.prototype.sensitiveAction,
    );

    expect(metadata).toBe(true);
  });

  it('sets REQUIRE_SECURITY_ELEVATION_KEY metadata to true on a decorated class', () => {
    @RequireSecurityElevation()
    class SensitiveController {
      _dummy() {}
    }

    const metadata = Reflect.getMetadata(
      REQUIRE_SECURITY_ELEVATION_KEY,
      SensitiveController,
    );

    expect(metadata).toBe(true);
  });

  it('does not set metadata on undecorated methods', () => {
    class PlainController {
      normalAction() {}
    }

    const metadata = Reflect.getMetadata(
      REQUIRE_SECURITY_ELEVATION_KEY,
      PlainController.prototype.normalAction,
    );

    expect(metadata).toBeUndefined();
  });
});
