import 'reflect-metadata';

import { Public, IS_PUBLIC_KEY } from './public.decorator';

describe('Public', () => {
  it('sets IS_PUBLIC_KEY metadata to true on the decorated method', () => {
    class TestController {
      @Public()
      getPublic() {}
    }

    const metadata = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      TestController.prototype.getPublic,
    );

    expect(metadata).toBe(true);
  });

  it('sets IS_PUBLIC_KEY metadata to true on a decorated class', () => {
    @Public()
    class PublicController {
      _dummy() {}
    }

    const metadata = Reflect.getMetadata(IS_PUBLIC_KEY, PublicController);

    expect(metadata).toBe(true);
  });

  it('does not set metadata on undecorated methods', () => {
    class PlainController {
      noDecorator() {}
    }

    const metadata = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      PlainController.prototype.noDecorator,
    );

    expect(metadata).toBeUndefined();
  });
});
