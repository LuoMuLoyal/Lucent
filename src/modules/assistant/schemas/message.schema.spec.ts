import {
  assistantMessageRoleSchema,
  assistantMessageSchema,
} from './message.schema';

describe('assistantMessageRoleSchema', () => {
  it('accepts system role', () => {
    expect(assistantMessageRoleSchema.safeParse('system').success).toBe(true);
  });

  it('accepts user role', () => {
    expect(assistantMessageRoleSchema.safeParse('user').success).toBe(true);
  });

  it('accepts assistant role', () => {
    expect(assistantMessageRoleSchema.safeParse('assistant').success).toBe(
      true,
    );
  });

  it('rejects an invalid role', () => {
    expect(assistantMessageRoleSchema.safeParse('bot').success).toBe(false);
  });
});

describe('assistantMessageSchema', () => {
  it('accepts a valid message', () => {
    const result = assistantMessageSchema.safeParse({
      role: 'user',
      content: 'Hello, world!',
    });
    expect(result.success).toBe(true);
  });

  it('accepts content at the 8000 char boundary', () => {
    const result = assistantMessageSchema.safeParse({
      role: 'user',
      content: 'x'.repeat(8000),
    });
    expect(result.success).toBe(true);
  });

  it('rejects content exceeding 8000 chars', () => {
    const result = assistantMessageSchema.safeParse({
      role: 'user',
      content: 'x'.repeat(8001),
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty content', () => {
    const result = assistantMessageSchema.safeParse({
      role: 'user',
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only content', () => {
    const result = assistantMessageSchema.safeParse({
      role: 'user',
      content: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid role', () => {
    const result = assistantMessageSchema.safeParse({
      role: 'admin',
      content: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from content', () => {
    const result = assistantMessageSchema.safeParse({
      role: 'user',
      content: '  Hello  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('Hello');
    }
  });
});
