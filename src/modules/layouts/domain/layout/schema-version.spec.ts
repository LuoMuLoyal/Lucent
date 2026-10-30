import { describe, expect, it } from 'vitest';

import {
  isSupportedSchemaVersion,
  LAYOUT_SCHEMA_VERSION_MAX,
  LAYOUT_SCHEMA_VERSION_MIN,
} from './schema-version.js';

describe('isSupportedSchemaVersion', () => {
  it('accepts the current range boundaries', () => {
    expect(isSupportedSchemaVersion(LAYOUT_SCHEMA_VERSION_MIN)).toBe(true);
    expect(isSupportedSchemaVersion(LAYOUT_SCHEMA_VERSION_MAX)).toBe(true);
  });

  it('rejects one below MIN and one above MAX', () => {
    expect(isSupportedSchemaVersion(LAYOUT_SCHEMA_VERSION_MIN - 1)).toBe(false);
    expect(isSupportedSchemaVersion(LAYOUT_SCHEMA_VERSION_MAX + 1)).toBe(false);
  });

  it('rejects zero and negative versions', () => {
    expect(isSupportedSchemaVersion(0)).toBe(false);
    expect(isSupportedSchemaVersion(-1)).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(isSupportedSchemaVersion(1.5)).toBe(false);
    expect(isSupportedSchemaVersion(Number.NaN)).toBe(false);
  });
});
