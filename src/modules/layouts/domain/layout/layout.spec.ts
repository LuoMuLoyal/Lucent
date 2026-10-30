import { describe, expect, it } from 'vitest';

import type { LayoutSaveRequest, LayoutState } from './layout.js';
import {
  nextVersion,
  validateSaveRequest,
  validateVersionPrecondition,
} from './layout.js';

function state(overrides: Partial<LayoutState> = {}): LayoutState {
  return {
    surface: 'today',
    version: 3,
    schemaVersion: 1,
    payload: {},
    updatedAt: new Date('2026-10-30T00:00:00Z'),
    ...overrides,
  };
}

function request(
  overrides: Partial<LayoutSaveRequest> = {},
): LayoutSaveRequest {
  return {
    surface: 'today',
    ifVersion: null,
    schemaVersion: 1,
    payload: {},
    ...overrides,
  };
}

describe('validateSaveRequest', () => {
  it('accepts a well-formed request', () => {
    expect(validateSaveRequest(request())).toBeNull();
  });

  it('rejects an unknown surface', () => {
    const failure = validateSaveRequest(request({ surface: 'settings' }));
    expect(failure?.code).toBe('LAYOUT_SURFACE_UNKNOWN');
    expect(failure?.kind).toBe('validation');
  });

  it('rejects a schema version above the supported range', () => {
    const failure = validateSaveRequest(request({ schemaVersion: 99 }));
    expect(failure?.code).toBe('LAYOUT_SCHEMA_VERSION_UNSUPPORTED');
    expect(failure?.kind).toBe('validation');
  });

  it('rejects a schema version below the supported range', () => {
    const failure = validateSaveRequest(request({ schemaVersion: 0 }));
    expect(failure?.code).toBe('LAYOUT_SCHEMA_VERSION_UNSUPPORTED');
  });

  it('checks the surface before the schema version', () => {
    // Both are wrong; the surface is the cheaper, more actionable diagnosis.
    const failure = validateSaveRequest(
      request({ surface: 'nope', schemaVersion: 99 }),
    );
    expect(failure?.code).toBe('LAYOUT_SURFACE_UNKNOWN');
  });
});

describe('validateVersionPrecondition', () => {
  it('allows an unconditional write against a missing row', () => {
    expect(validateVersionPrecondition(null, null)).toBeNull();
  });

  it('allows an unconditional write against an existing row', () => {
    expect(validateVersionPrecondition(state(), null)).toBeNull();
  });

  it('allows a conditional write that matches the stored version', () => {
    expect(validateVersionPrecondition(state({ version: 3 }), 3)).toBeNull();
  });

  it('rejects a conditional write with a stale version', () => {
    const failure = validateVersionPrecondition(state({ version: 3 }), 2);
    expect(failure?.code).toBe('LAYOUT_VERSION_CONFLICT');
    expect(failure?.kind).toBe('conflict');
    expect(failure?.args).toEqual({ ifVersion: 2, currentVersion: 3 });
  });

  it('rejects a conditional write against a missing row', () => {
    // The client believes it has a layout the server does not have.
    const failure = validateVersionPrecondition(null, 1);
    expect(failure?.code).toBe('LAYOUT_VERSION_CONFLICT');
    expect(failure?.args).toEqual({ ifVersion: 1, currentVersion: 0 });
  });
});

describe('nextVersion', () => {
  it('starts at 1 for a first write', () => {
    expect(nextVersion(null)).toBe(1);
  });

  it('increments the stored version', () => {
    expect(nextVersion(state({ version: 1 }))).toBe(2);
    expect(nextVersion(state({ version: 41 }))).toBe(42);
  });
});
