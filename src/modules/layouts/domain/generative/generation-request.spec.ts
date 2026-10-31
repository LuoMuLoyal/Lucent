import {
  GENERATIVE_PROMPT_MAX_LENGTH,
  validateGenerationRequest,
} from './generation-request.js';

/**
 * Request-validation tests: the guards that run before a model call is paid
 * for. Every case asserts the specific failure code, because the client keys
 * its copy off the code (not the HTTP status) and maps it to a field.
 */
describe('validateGenerationRequest', () => {
  const valid = { surface: 'review', prompt: 'show my water trend' };

  it('accepts a well-formed request', () => {
    expect(validateGenerationRequest(valid)).toBeNull();
  });

  it('accepts every composable surface', () => {
    for (const surface of ['today', 'record', 'medicine', 'review', 'mine']) {
      expect(validateGenerationRequest({ surface, prompt: 'hi' })).toBeNull();
    }
  });

  it('rejects an unknown surface', () => {
    const failure = validateGenerationRequest({
      surface: 'nope',
      prompt: 'hi',
    });
    expect(failure?.code).toBe('LAYOUT_SURFACE_UNKNOWN');
  });

  it('rejects the tab bar, which is not a page', () => {
    const failure = validateGenerationRequest({
      surface: 'tab_chrome',
      prompt: 'hi',
    });
    expect(failure?.code).toBe('GENERATIVE_SURFACE_UNSUPPORTED');
  });

  it('rejects an empty prompt', () => {
    expect(
      validateGenerationRequest({ surface: 'review', prompt: '' })?.code,
    ).toBe('GENERATIVE_PROMPT_EMPTY');
  });

  it('rejects a whitespace-only prompt', () => {
    expect(
      validateGenerationRequest({ surface: 'review', prompt: '   \n\t ' })
        ?.code,
    ).toBe('GENERATIVE_PROMPT_EMPTY');
  });

  it('accepts a prompt at exactly the limit', () => {
    expect(
      validateGenerationRequest({
        surface: 'review',
        prompt: 'a'.repeat(GENERATIVE_PROMPT_MAX_LENGTH),
      }),
    ).toBeNull();
  });

  it('rejects a prompt one over the limit', () => {
    expect(
      validateGenerationRequest({
        surface: 'review',
        prompt: 'a'.repeat(GENERATIVE_PROMPT_MAX_LENGTH + 1),
      })?.code,
    ).toBe('GENERATIVE_PROMPT_TOO_LONG');
  });

  it('measures the limit after trimming', () => {
    // 2000 characters plus surrounding whitespace is still acceptable: the
    // bound is about what the user meant, not how they padded it.
    expect(
      validateGenerationRequest({
        surface: 'review',
        prompt: `   ${'a'.repeat(GENERATIVE_PROMPT_MAX_LENGTH)}   `,
      }),
    ).toBeNull();
  });

  it('reports the bound so the message can name it', () => {
    const failure = validateGenerationRequest({
      surface: 'review',
      prompt: 'a'.repeat(GENERATIVE_PROMPT_MAX_LENGTH + 1),
    });
    expect(failure?.args).toEqual({ maxLength: GENERATIVE_PROMPT_MAX_LENGTH });
  });
});
