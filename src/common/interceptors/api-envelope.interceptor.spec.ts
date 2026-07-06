import { lastValueFrom, of } from 'rxjs';
import { ApiEnvelopeInterceptor } from './api-envelope.interceptor';
import { ResultCode } from '../api/api-envelope';
import { SKIP_API_ENVELOPE_KEY } from './skip-api-envelope.decorator';

function createMockExecutionContext(handler?: object, targetClass?: object) {
  const effectiveHandler = handler ?? function handler() {};
  function EffectiveClass() {
    return undefined;
  }
  const effectiveClass = targetClass ?? EffectiveClass;
  return {
    getHandler: () => effectiveHandler,
    getClass: () => effectiveClass,
  } as never;
}

function createMockCallHandler(data: unknown) {
  return { handle: () => of(data) };
}

describe('ApiEnvelopeInterceptor', () => {
  let interceptor: ApiEnvelopeInterceptor;

  beforeEach(() => {
    interceptor = new ApiEnvelopeInterceptor();
  });

  it('should wrap plain data into success envelope', async () => {
    const data = { id: 1, name: 'test' };
    const result = await lastValueFrom(
      interceptor.intercept(
        createMockExecutionContext(),
        createMockCallHandler(data),
      ),
    );

    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data,
    });
  });

  it('should wrap null data into success envelope', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(
        createMockExecutionContext(),
        createMockCallHandler(null),
      ),
    );

    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: null,
    });
  });

  it('should wrap undefined data into success envelope', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(
        createMockExecutionContext(),
        createMockCallHandler(undefined),
      ),
    );

    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: null,
    });
  });

  it('should pass through data that is already an ApiEnvelope (has code, message, data)', async () => {
    const envelope = {
      code: ResultCode.BAD_REQUEST,
      message: 'Invalid input',
      data: null,
    };
    const result = await lastValueFrom(
      interceptor.intercept(
        createMockExecutionContext(),
        createMockCallHandler(envelope),
      ),
    );

    // Should be passed through as-is, not wrapped again
    expect(result).toEqual(envelope);
  });

  it('should wrap primitive string data', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(
        createMockExecutionContext(),
        createMockCallHandler('hello'),
      ),
    );

    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: 'hello',
    });
  });

  it('should wrap array data', async () => {
    const data = [1, 2, 3];
    const result = await lastValueFrom(
      interceptor.intercept(
        createMockExecutionContext(),
        createMockCallHandler(data),
      ),
    );

    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: [1, 2, 3],
    });
  });

  it('should skip envelope wrapping when the handler is marked to bypass it', async () => {
    const handler = {};
    Reflect.defineMetadata(SKIP_API_ENVELOPE_KEY, true, handler);

    const result = await lastValueFrom(
      interceptor.intercept(
        createMockExecutionContext(handler),
        createMockCallHandler('plain-text'),
      ),
    );

    expect(result).toBe('plain-text');
  });
});
