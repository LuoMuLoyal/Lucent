import 'reflect-metadata';

import {
  SkipApiEnvelope,
  SKIP_API_ENVELOPE_KEY,
} from './skip-api-envelope.decorator';

describe('SkipApiEnvelope', () => {
  it('sets SKIP_API_ENVELOPE_KEY metadata to true on the decorated method', () => {
    class TestController {
      @SkipApiEnvelope()
      rawEndpoint() {}
    }

    const metadata = Reflect.getMetadata(
      SKIP_API_ENVELOPE_KEY,
      TestController.prototype.rawEndpoint,
    );

    expect(metadata).toBe(true);
  });

  it('sets SKIP_API_ENVELOPE_KEY metadata to true on a decorated class', () => {
    @SkipApiEnvelope()
    class RawController {
      _dummy() {}
    }

    const metadata = Reflect.getMetadata(SKIP_API_ENVELOPE_KEY, RawController);

    expect(metadata).toBe(true);
  });

  it('does not set metadata on undecorated methods', () => {
    class PlainController {
      normalEndpoint() {}
    }

    const metadata = Reflect.getMetadata(
      SKIP_API_ENVELOPE_KEY,
      PlainController.prototype.normalEndpoint,
    );

    expect(metadata).toBeUndefined();
  });
});
