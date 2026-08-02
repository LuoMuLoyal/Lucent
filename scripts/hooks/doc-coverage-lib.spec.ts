import { describe, expect, it } from 'vitest';
import {
  buildReport,
  extractPlanReferences,
  findDocMapOrphans,
  findDocMapGlobOrphans,
  findDocsMissingFrontMatter,
  findStaleStatusDocs,
  findUnreferencedActiveDocs,
  getStaleByFrontMatter,
  getStaleDocs,
  getTodayDate,
  globToRegExp,
  hasMultipleH1,
  isActiveDoc,
  isFrontMatterRequired,
  parseDocMapYaml,
  parseFrontMatter,
} from './doc-coverage-lib.ts';

const SAMPLE_YAML = `
rules:
  - name: infra
    code:
      - src/setup-app.ts
    docs_required:
      - docs/02-logs/migration-log/*.md
    docs_any_of:
      - docs/01-reference/architecture.md
      - docs/01-reference/environment.md
    docs_info:
      - docs/00-current/TODO.md
`;

describe('parseDocMapYaml', () => {
  it('parses 3-tier schema', () => {
    const rules = parseDocMapYaml(SAMPLE_YAML);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('infra');
    expect(rules[0].codePatterns).toEqual(['src/setup-app.ts']);
    expect(rules[0].requiredDocs).toEqual(['docs/02-logs/migration-log/*.md']);
    expect(rules[0].anyOfDocs).toEqual([
      'docs/01-reference/architecture.md',
      'docs/01-reference/environment.md',
    ]);
    expect(rules[0].infoDocs).toEqual(['docs/00-current/TODO.md']);
  });
  it('defaults missing tiers to empty arrays', () => {
    const rules = parseDocMapYaml(
      'rules:\n  - name: x\n    code:\n      - src/a.ts\n    docs_required:\n      - docs/02-logs/migration-log/*.md\n',
    );
    expect(rules[0].anyOfDocs).toEqual([]);
    expect(rules[0].infoDocs).toEqual([]);
  });
});

describe('globToRegExp', () => {
  it('matches single-segment * and multi-segment **', () => {
    expect(
      globToRegExp('docs/02-logs/migration-log/*.md').test(
        'docs/02-logs/migration-log/2026-08-01.md',
      ),
    ).toBe(true);
    expect(
      globToRegExp('docs/02-logs/migration-log/*.md').test(
        'docs/02-logs/migration-log/a/b.md',
      ),
    ).toBe(false);
    expect(
      globToRegExp('src/common/**').test(
        'src/common/logger/trace-context.utils.ts',
      ),
    ).toBe(true);
  });
});

describe('isActiveDoc', () => {
  it('classifies active vs archived', () => {
    expect(isActiveDoc('docs/01-reference/architecture.md')).toBe(true);
    expect(isActiveDoc('docs/00-current/TODO.md')).toBe(true);
    expect(isActiveDoc('docs/02-logs/README.md')).toBe(true);
    expect(isActiveDoc('docs/03-archive/current-state/Meal_Analysis.md')).toBe(
      false,
    );
  });
});

describe('buildReport 3-tier', () => {
  const rules = parseDocMapYaml(SAMPLE_YAML);
  it('warns when required (migration log) missing', () => {
    const r = buildReport(
      rules,
      ['src/setup-app.ts'],
      ['docs/01-reference/architecture.md'],
    );
    expect(r.hasWarnings).toBe(true);
    expect(r.matchedRules[0].missingRequired).toContain(
      'docs/02-logs/migration-log/*.md',
    );
    expect(r.matchedRules[0].missingAnyOf).toEqual([]);
  });
  it('warns when any_of all missing but required present', () => {
    const r = buildReport(
      rules,
      ['src/setup-app.ts'],
      ['docs/02-logs/migration-log/2026-08-01.md'],
    );
    expect(r.hasWarnings).toBe(true);
    expect(r.matchedRules[0].missingRequired).toEqual([]);
    expect(r.matchedRules[0].missingAnyOf).toHaveLength(2);
  });
  it('no warning when required + one any_of hit (info ignored)', () => {
    const r = buildReport(
      rules,
      ['src/setup-app.ts'],
      [
        'docs/02-logs/migration-log/2026-08-01.md',
        'docs/01-reference/architecture.md',
      ],
    );
    expect(r.hasWarnings).toBe(false);
    expect(r.matchedRules[0].missingInfo).toContain('docs/00-current/TODO.md');
    expect(r.hasInfos).toBe(true);
  });
  it('no matched rule when code untouched', () => {
    const r = buildReport(rules, ['src/modules/auth/auth.service.ts'], []);
    expect(r.matchedRules).toHaveLength(0);
  });
});

describe('getTodayDate / getTodayLogPath', () => {
  it('formats YYYY-MM-DD', () => {
    expect(getTodayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getStaleDocs', () => {
  it('flags docs older than threshold', () => {
    const stale = getStaleDocs(
      ['docs/01-reference/a.md', 'docs/01-reference/b.md'],
      {
        'docs/01-reference/a.md': '2026-01-01',
        'docs/01-reference/b.md': '2026-07-30',
      },
      '2026-08-01',
      90,
    );
    expect(stale).toEqual(['docs/01-reference/a.md']);
  });
  it('skips untracked docs', () => {
    expect(
      getStaleDocs(['docs/01-reference/c.md'], {}, '2026-08-01', 90),
    ).toEqual([]);
  });
});

describe('findUnreferencedActiveDocs', () => {
  it('flags active docs not referenced by any rule', () => {
    const rules = parseDocMapYaml(SAMPLE_YAML);
    const active = [
      'docs/01-reference/architecture.md',
      'docs/01-reference/foo.md',
      'docs/README.md',
    ];
    expect(findUnreferencedActiveDocs(rules, active)).toEqual([
      'docs/01-reference/foo.md',
    ]);
  });
  it('exempts docs with standing reader channels', () => {
    const rules = parseDocMapYaml(SAMPLE_YAML);
    const active = [
      'docs/01-reference/deployment.md',
      'docs/01-reference/environment-variables.md',
      'docs/01-reference/adr/0001-nestjs-prisma-stack.md',
      'docs/01-reference/how-to/deploy.md',
      'docs/01-reference/contracts/reminder-contract.md',
    ];
    expect(findUnreferencedActiveDocs(rules, active)).toEqual([]);
  });
});

describe('extractPlanReferences', () => {
  it('extracts plans/ and .trae/specs/ references', () => {
    const content =
      '按 plans/2026-08-01-otel-tracing.md 实施，经 .trae/specs/enhance-trace-logging/ 流程';
    expect(extractPlanReferences(content)).toEqual([
      'plans/2026-08-01-otel-tracing.md',
      '.trae/specs/enhance-trace-logging/',
    ]);
  });
});

describe('hasMultipleH1', () => {
  it('detects multiple H1', () => {
    expect(hasMultipleH1('# A\n## B\n# C\n')).toBe(true);
    expect(hasMultipleH1('# A\n## B\n### C\n')).toBe(false);
  });
  it('ignores headings inside fenced code blocks', () => {
    expect(hasMultipleH1('# A\n```bash\n# .env\n```\n')).toBe(false);
  });
});

describe('findDocMapOrphans / findDocMapGlobOrphans', () => {
  it('flags missing literal docs', () => {
    const rules = parseDocMapYaml(SAMPLE_YAML);
    expect(
      findDocMapOrphans(rules, ['docs/01-reference/architecture.md']),
    ).toContain('infra: "docs/01-reference/environment.md" does not exist');
  });
  it('flags glob patterns matching nothing', () => {
    const rules = parseDocMapYaml(SAMPLE_YAML);
    expect(
      findDocMapGlobOrphans(rules, ['docs/01-reference/architecture.md']),
    ).toEqual([
      'infra: glob "docs/02-logs/migration-log/*.md" matches no existing file',
    ]);
  });
});

describe('isFrontMatterRequired', () => {
  it('requires front-matter for reference/how-to/current docs only', () => {
    expect(isFrontMatterRequired('docs/01-reference/architecture.md')).toBe(
      true,
    );
    expect(isFrontMatterRequired('docs/01-reference/how-to/deploy.md')).toBe(
      true,
    );
    expect(isFrontMatterRequired('docs/00-current/TODO.md')).toBe(true);
    expect(isFrontMatterRequired('docs/01-reference/adr/0001-x.md')).toBe(
      false,
    );
    expect(isFrontMatterRequired('docs/01-reference/contracts/x.md')).toBe(
      false,
    );
    expect(isFrontMatterRequired('docs/README.md')).toBe(false);
  });
});

describe('parseFrontMatter', () => {
  it('parses a leading front-matter block', () => {
    const content = `---
status: active
owner: backend
quadrant: reference
updated: 2026-08-02
---

# Title
`;
    expect(parseFrontMatter(content)).toEqual({
      status: 'active',
      owner: 'backend',
      quadrant: 'reference',
      updated: '2026-08-02',
    });
  });
  it('returns empty object when no front-matter', () => {
    expect(parseFrontMatter('# Title\n')).toEqual({});
  });
});

describe('findDocsMissingFrontMatter', () => {
  it('flags required docs without a full front-matter block', () => {
    const contents: Record<string, string> = {
      'docs/01-reference/a.md': '# A',
      'docs/01-reference/b.md': `---
status: active
owner: backend
quadrant: reference
updated: 2026-08-02
---

# B`,
      'docs/01-reference/c.md': `---
status: active
---

# C`,
      'docs/01-reference/adr/0001-x.md': '# ADR',
    };
    expect(
      findDocsMissingFrontMatter(
        [
          'docs/01-reference/a.md',
          'docs/01-reference/b.md',
          'docs/01-reference/c.md',
          'docs/01-reference/adr/0001-x.md',
        ],
        contents,
      ),
    ).toEqual(['docs/01-reference/a.md', 'docs/01-reference/c.md']);
  });
});

describe('getStaleByFrontMatter', () => {
  it('flags active docs whose updated is older than threshold', () => {
    const contents: Record<string, string> = {
      'docs/01-reference/a.md': `---
status: active
updated: 2026-01-01
---`,
      'docs/01-reference/b.md': `---
status: active
updated: 2026-07-30
---`,
      'docs/01-reference/c.md': `---
status: stale
updated: 2026-01-01
---`,
    };
    expect(
      getStaleByFrontMatter(
        [
          'docs/01-reference/a.md',
          'docs/01-reference/b.md',
          'docs/01-reference/c.md',
        ],
        contents,
        '2026-08-01',
        90,
      ),
    ).toEqual(['docs/01-reference/a.md']);
  });
  it('skips docs without front-matter or updated', () => {
    expect(
      getStaleByFrontMatter(
        ['docs/01-reference/d.md'],
        { 'docs/01-reference/d.md': '# D' },
        '2026-08-01',
        90,
      ),
    ).toEqual([]);
  });
});

describe('findStaleStatusDocs', () => {
  it('flags docs explicitly marked stale but not archived', () => {
    const contents: Record<string, string> = {
      'docs/01-reference/a.md': `---
status: stale
---`,
      'docs/01-reference/b.md': `---
status: active
---`,
    };
    expect(
      findStaleStatusDocs(
        ['docs/01-reference/a.md', 'docs/01-reference/b.md'],
        contents,
      ),
    ).toEqual(['docs/01-reference/a.md']);
  });
});
