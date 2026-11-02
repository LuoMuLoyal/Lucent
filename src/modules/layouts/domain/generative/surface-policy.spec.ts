import { checkSurfaceProduction } from './surface-policy.js';

/**
 * Admission-policy tests.
 *
 * These are the security boundary, so every case is phrased as an attack: what
 * a model could emit to get a fabricated number, a write action, or rewritten
 * medical advice onto a user's screen. They are pure-function tests — no model,
 * no HTTP — so they stay fast and deterministic.
 */
describe('checkSurfaceProduction', () => {
  const minimal = (components: unknown[]) => [
    {
      version: 'v0.9',
      updateComponents: { surfaceId: 'generative.review', components },
    },
  ];

  /** A tree the client would render without complaint. */
  const validTree = [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'generative.review',
        catalogId: 'com.luminous.generative',
        sendDataModel: false,
      },
    },
    ...minimal([
      { id: 'root', component: 'Column', children: ['title', 'water'] },
      { id: 'title', component: 'Text', text: 'This week' },
      { id: 'water', component: 'metric_card', kind: 'water', range: '7d' },
    ]),
  ];

  describe('accepts', () => {
    it('a valid tree of primitives and domain components', () => {
      expect(checkSurfaceProduction(validTree)).toEqual([]);
    });

    it('trend_chart with a single kind', () => {
      expect(
        checkSurfaceProduction(
          minimal([{ id: 'root', component: 'trend_chart', kind: 'water' }]),
        ),
      ).toEqual([]);
    });

    it('trend_chart with kinds', () => {
      expect(
        checkSurfaceProduction(
          minimal([
            { id: 'root', component: 'trend_chart', kinds: ['water', 'sleep'] },
          ]),
        ),
      ).toEqual([]);
    });

    it('finding referenced by id', () => {
      expect(
        checkSurfaceProduction(
          minimal([{ id: 'root', component: 'finding', findingId: 'f-1' }]),
        ),
      ).toEqual([]);
    });
  });

  describe('rejects fabricated numbers', () => {
    it('a numeric value on metric_card', () => {
      const violations = checkSurfaceProduction(
        minimal([
          { id: 'root', component: 'metric_card', kind: 'water', value: 1800 },
        ]),
      );
      expect(violations.map((v) => v.kind)).toContain('unexpectedProperty');
    });

    it('a number smuggled into a nested array', () => {
      const violations = checkSurfaceProduction(
        minimal([
          {
            id: 'root',
            component: 'trend_chart',
            kinds: ['water', 7600],
          },
        ]),
      );
      expect(violations.map((v) => v.kind)).toContain('fabricatedNumber');
    });

    it('a number on finding is rejected (as an unexpected key first)', () => {
      // A number can only arrive through a property, and `score` is not in
      // `finding`'s whitelist — so the stricter `unexpectedProperty` fires
      // first. Both verdicts reject the tree; the key rule wins because it
      // applies before the value rule.
      const violations = checkSurfaceProduction(
        minimal([
          { id: 'root', component: 'finding', findingId: 'f-1', score: 92 },
        ]),
      );
      expect(violations.map((v) => v.kind)).toContain('unexpectedProperty');
      expect(violations[0]?.property).toBe('score');
    });
  });

  describe('rejects components outside the catalog', () => {
    it.each([
      'Button',
      'TextField',
      'CheckBox',
      'Slider',
      'DateTimeInput',
      'Modal',
      'Tabs',
      'AudioPlayer',
      'Video',
    ])('%s', (component) => {
      const violations = checkSurfaceProduction(
        minimal([{ id: 'root', component }]),
      );
      expect(violations.map((v) => v.kind)).toContain('unexpectedComponent');
    });

    it('and names the offending type so the log is actionable', () => {
      const [violation] = checkSurfaceProduction(
        minimal([{ id: 'root', component: 'Button', action: 'submit' }]),
      );
      expect(violation?.componentType).toBe('Button');
    });
  });

  describe('rejects rewritten finding text', () => {
    it('a finding carrying its own title', () => {
      const violations = checkSurfaceProduction(
        minimal([
          {
            id: 'root',
            component: 'finding',
            findingId: 'f-1',
            title: 'You are sleeping badly',
          },
        ]),
      );
      expect(violations.map((v) => v.kind)).toContain('unexpectedProperty');
      expect(violations[0]?.property).toBe('title');
    });

    it('a finding carrying its own body', () => {
      const violations = checkSurfaceProduction(
        minimal([
          {
            id: 'root',
            component: 'finding',
            findingId: 'f-1',
            body: 'Stop taking your medication',
          },
        ]),
      );
      expect(violations.map((v) => v.kind)).toContain('unexpectedProperty');
    });
  });

  describe('rejects malformed production', () => {
    it('an empty message list', () => {
      expect(checkSurfaceProduction([]).map((v) => v.kind)).toEqual([
        'invalidMessage',
      ]);
    });

    it('a message with no A2UI body key', () => {
      expect(
        checkSurfaceProduction([{ version: 'v0.9', something: {} }]).map(
          (v) => v.kind,
        ),
      ).toContain('invalidMessage');
    });

    it('a tree without a root component', () => {
      const violations = checkSurfaceProduction(
        minimal([{ id: 'title', component: 'Text', text: 'hi' }]),
      );
      expect(violations.map((v) => v.kind)).toContain('invalidMessage');
    });

    it('a component without a discriminator', () => {
      expect(
        checkSurfaceProduction(minimal([{ id: 'root' }])).map((v) => v.kind),
      ).toContain('invalidMessage');
    });

    it('a missing reference key', () => {
      const violations = checkSurfaceProduction(
        minimal([{ id: 'root', component: 'metric_card', range: '7d' }]),
      );
      expect(violations.map((v) => v.kind)).toContain('missingProperty');
    });

    it('a trend_chart with neither kind nor kinds', () => {
      const violations = checkSurfaceProduction(
        minimal([{ id: 'root', component: 'trend_chart', range: '7d' }]),
      );
      expect(violations.map((v) => v.kind)).toContain('missingProperty');
    });
  });

  it('reports every violation, not just the first', () => {
    const violations = checkSurfaceProduction(
      minimal([
        { id: 'root', component: 'Column', children: ['a', 'b'] },
        { id: 'a', component: 'Button' },
        { id: 'b', component: 'metric_card', kind: 'water', value: 1800 },
      ]),
    );
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });
});
