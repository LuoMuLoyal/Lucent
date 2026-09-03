import type { ValidationError } from '@nestjs/common';

import {
  formatValidationErrors,
  collectValidationMessages,
} from './setup-app.js';

describe('collectValidationMessages', () => {
  it('returns constraint messages from a flat error', () => {
    const error: ValidationError = {
      property: 'name',
      constraints: {
        isString: 'name must be a string',
        isNotEmpty: 'name should not be empty',
      },
      children: [],
    };

    const messages = collectValidationMessages(error);

    expect(messages).toHaveLength(2);
    expect(messages).toContain('name must be a string');
    expect(messages).toContain('name should not be empty');
  });

  it('returns empty array when constraints are absent', () => {
    const error: ValidationError = {
      property: 'name',
      children: [],
    };

    const messages = collectValidationMessages(error);

    expect(messages).toEqual([]);
  });

  it('recursively collects messages from child errors', () => {
    const error: ValidationError = {
      property: 'user',
      children: [
        {
          property: 'email',
          constraints: { isEmail: 'email must be a valid address' },
          children: [],
        },
        {
          property: 'profile',
          children: [
            {
              property: 'age',
              constraints: {
                min: 'age must be at least 0',
                isInt: 'age must be an integer',
              },
              children: [],
            },
          ],
        },
      ],
    };

    const messages = collectValidationMessages(error);

    expect(messages).toHaveLength(3);
    expect(messages).toContain('email must be a valid address');
    expect(messages).toContain('age must be at least 0');
    expect(messages).toContain('age must be an integer');
  });

  it('handles deeply nested children with no constraints at intermediate levels', () => {
    const error: ValidationError = {
      property: 'root',
      children: [
        {
          property: 'level1',
          children: [
            {
              property: 'level2',
              children: [
                {
                  property: 'leaf',
                  constraints: { isString: 'leaf must be a string' },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const messages = collectValidationMessages(error);

    expect(messages).toEqual(['leaf must be a string']);
  });
});

describe('formatValidationErrors', () => {
  it('joins multiple top-level error messages with semicolons', () => {
    const errors: ValidationError[] = [
      {
        property: 'name',
        constraints: { isString: 'name must be a string' },
        children: [],
      },
      {
        property: 'age',
        constraints: { isInt: 'age must be an integer' },
        children: [],
      },
    ];

    const result = formatValidationErrors(errors);

    expect(result).toBe('name must be a string; age must be an integer');
  });

  it('returns empty string for empty errors array', () => {
    const result = formatValidationErrors([]);

    expect(result).toBe('');
  });

  it('flattens nested child messages into the top-level output', () => {
    const errors: ValidationError[] = [
      {
        property: 'user',
        children: [
          {
            property: 'email',
            constraints: { isEmail: 'email must be valid' },
            children: [],
          },
        ],
      },
      {
        property: 'name',
        constraints: { isString: 'name must be a string' },
        children: [],
      },
    ];

    const result = formatValidationErrors(errors);

    expect(result).toBe('email must be valid; name must be a string');
  });

  it('handles errors with both constraints and children', () => {
    const errors: ValidationError[] = [
      {
        property: 'dto',
        constraints: { isObject: 'dto must be an object' },
        children: [
          {
            property: 'field',
            constraints: { isString: 'field must be a string' },
            children: [],
          },
        ],
      },
    ];

    const result = formatValidationErrors(errors);

    expect(result).toBe('dto must be an object; field must be a string');
  });
});
