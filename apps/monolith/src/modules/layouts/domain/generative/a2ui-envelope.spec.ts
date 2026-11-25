import { describe, expect, it } from 'vitest';

import {
  A2UI_MESSAGE_KEYS,
  A2UI_PROTOCOL_VERSION,
  checkSurfaceProduction,
} from './a2ui-envelope.js';

/**
 * Envelope checks for A2UI v1.0 output.
 *
 * A2UI 1.0 removed the closed vocabulary, so these cases are about the shape of
 * what the model produced — not about which components it chose.
 */
function createSurface(
  surfaceId = 'generative.review',
): Record<string, unknown> {
  return {
    version: A2UI_PROTOCOL_VERSION,
    createSurface: {
      surfaceId,
      catalogId: 'https://luminous.app/a2ui/catalog/v1.json',
    },
  };
}

function components(
  list: readonly Record<string, unknown>[],
  surfaceId = 'generative.review',
): Record<string, unknown> {
  return {
    version: A2UI_PROTOCOL_VERSION,
    updateComponents: { surfaceId, components: list },
  };
}

const rootColumn = { id: 'root', component: 'Column', children: ['a'] };
const leafText = { id: 'a', component: 'Text', text: 'hi' };

describe('checkSurfaceProduction', () => {
  it('accepts a minimal valid v1.0 sequence', () => {
    expect(
      checkSurfaceProduction([
        createSurface(),
        components([rootColumn, leafText]),
      ]),
    ).toEqual([]);
  });

  it('accepts the v1.0 single-message instantiation', () => {
    expect(
      checkSurfaceProduction([
        {
          version: A2UI_PROTOCOL_VERSION,
          createSurface: {
            surfaceId: 'generative.review',
            catalogId: 'https://luminous.app/a2ui/catalog/v1.json',
            components: [rootColumn, leafText],
            dataModel: {},
          },
        },
      ]),
    ).toEqual([]);
  });

  it('accepts actions and input components — 1.0 dropped the whitelist', () => {
    expect(
      checkSurfaceProduction([
        createSurface(),
        components([
          {
            id: 'root',
            component: 'Column',
            children: ['field', 'btn', 'label'],
          },
          {
            id: 'field',
            component: 'TextField',
            label: 'Medicine',
            value: { '@path': '/medicine' },
          },
          {
            id: 'btn',
            component: 'Button',
            child: 'label',
            action: { event: { name: 'submit' } },
          },
          { id: 'label', component: 'Text', text: 'Save' },
        ]),
      ]),
    ).toEqual([]);
  });

  it('rejects an empty sequence', () => {
    const violations = checkSurfaceProduction([]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe('invalidMessage');
  });

  it('rejects a non-object message', () => {
    const violations = checkSurfaceProduction([createSurface(), 'nope']);
    expect(violations.map((v) => v.kind)).toContain('invalidMessage');
  });

  it('rejects a v0.9 envelope', () => {
    const violations = checkSurfaceProduction([
      { ...createSurface(), version: 'v0.9' },
      components([rootColumn]),
    ]);
    expect(violations.map((v) => v.kind)).toContain('wrongVersion');
  });

  it('rejects a message with no body key', () => {
    const violations = checkSurfaceProduction([
      createSurface(),
      { version: A2UI_PROTOCOL_VERSION, components: [rootColumn] },
    ]);
    expect(violations.map((v) => v.kind)).toContain('noBodyKey');
  });

  it('rejects a message with two body keys', () => {
    const violations = checkSurfaceProduction([
      createSurface(),
      {
        version: A2UI_PROTOCOL_VERSION,
        updateComponents: { surfaceId: 's', components: [rootColumn] },
        deleteSurface: { surfaceId: 's' },
      },
    ]);
    expect(violations.map((v) => v.kind)).toContain('noBodyKey');
  });

  it('rejects a sequence with no createSurface', () => {
    const violations = checkSurfaceProduction([
      components([rootColumn, leafText]),
    ]);
    expect(violations.map((v) => v.kind)).toContain('missingCreateSurface');
  });

  it('rejects a sequence with no root component', () => {
    const violations = checkSurfaceProduction([
      createSurface(),
      components([leafText]),
    ]);
    expect(violations.map((v) => v.kind)).toContain('missingRoot');
  });

  it('reports every violation, not just the first', () => {
    const violations = checkSurfaceProduction([
      { version: 'v0.9', foo: 'bar' },
      { ...createSurface(), version: '0.9' },
    ]);
    expect(violations.length).toBeGreaterThan(2);
  });

  it('exports the six v1.0 body keys', () => {
    // v1.0 added the bidirectional pair; a typo here would reject every valid
    // function-call message.
    expect([...A2UI_MESSAGE_KEYS]).toEqual([
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
      'callRendererFunction',
      'agentFunctionResponse',
    ]);
  });
});
