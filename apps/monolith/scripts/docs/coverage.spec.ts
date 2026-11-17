import { describe, expect, it } from 'vitest';
import {
  extractPlanReferences,
  findDocsMissingFrontMatter,
  findStaleStatusDocs,
  findUncoveredModuleDirs,
  getStaleByFrontMatter,
  getStaleDocs,
  getTodayDate,
  globToRegExp,
  hasMultipleH1,
  isActiveDoc,
  isFrozenDoc,
  isFrontMatterRequired,
  parseFrontMatter,
  withoutFrozenDocs,
} from './coverage.ts';

describe('globToRegExp', () => {
  it('matches single-segment * and multi-segment **', () => {
    expect(
      globToRegExp('docs/logs/migration-log/*.md').test(
        'docs/logs/migration-log/2026-08-01.md',
      ),
    ).toBe(true);
    expect(
      globToRegExp('docs/logs/migration-log/*.md').test(
        'docs/logs/migration-log/a/b.md',
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
  it('classifies the Diátaxis layout (2026-08-31 governance)', () => {
    expect(isActiveDoc('docs/explanation/architecture.md')).toBe(true);
    expect(isActiveDoc('docs/reference/glossary.md')).toBe(true);
    expect(isActiveDoc('docs/reference/adr/0001-nestjs-prisma-stack.md')).toBe(
      true,
    );
    expect(isActiveDoc('docs/howto/deploy.md')).toBe(true);
    // Generated artifacts and the append-only ledger are never "active".
    expect(isActiveDoc('docs/reference/generated/openapi.json')).toBe(false);
    expect(isActiveDoc('docs/reference/generated/compodoc/index.html')).toBe(
      false,
    );
    expect(isActiveDoc('docs/logs/migration-log/2026-08-31.md')).toBe(false);
    expect(isActiveDoc('docs/archive/old-note.md')).toBe(false);
    expect(isActiveDoc('docs/archive/nested/dir/old-note.md')).toBe(false);
  });
  it('legacy numbered layout is no longer active', () => {
    expect(isActiveDoc('docs/01-reference/architecture.md')).toBe(false);
    expect(isActiveDoc('docs/00-current/TODO.md')).toBe(false);
    expect(isActiveDoc('docs/02-logs/README.md')).toBe(false);
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
      ['docs/reference/a.md', 'docs/reference/b.md'],
      {
        'docs/reference/a.md': '2026-01-01',
        'docs/reference/b.md': '2026-07-30',
      },
      '2026-08-01',
      90,
    );
    expect(stale).toEqual(['docs/reference/a.md']);
  });
  it('skips untracked docs', () => {
    expect(getStaleDocs(['docs/reference/c.md'], {}, '2026-08-01', 90)).toEqual(
      [],
    );
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

describe('isFrontMatterRequired', () => {
  it('new layout: reference/howto required, explanation/ADR exempt', () => {
    expect(isFrontMatterRequired('docs/reference/glossary.md')).toBe(true);
    expect(isFrontMatterRequired('docs/howto/deploy.md')).toBe(true);
    expect(isFrontMatterRequired('docs/explanation/architecture.md')).toBe(
      false,
    );
    expect(isFrontMatterRequired('docs/reference/adr/0001-x.md')).toBe(false);
    expect(isFrontMatterRequired('docs/reference/generated/x.md')).toBe(false);
    expect(isFrontMatterRequired('docs/README.md')).toBe(false);
  });
  it('legacy numbered layout no longer requires front-matter', () => {
    expect(isFrontMatterRequired('docs/01-reference/architecture.md')).toBe(
      false,
    );
    expect(isFrontMatterRequired('docs/00-current/TODO.md')).toBe(false);
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
      'docs/reference/a.md': '# A',
      'docs/reference/b.md': `---
status: active
owner: backend
quadrant: reference
updated: 2026-08-02
---

# B`,
      'docs/reference/c.md': `---
status: active
---

# C`,
      'docs/reference/adr/0001-x.md': '# ADR',
    };
    expect(
      findDocsMissingFrontMatter(
        [
          'docs/reference/a.md',
          'docs/reference/b.md',
          'docs/reference/c.md',
          'docs/reference/adr/0001-x.md',
        ],
        contents,
      ),
    ).toEqual(['docs/reference/a.md', 'docs/reference/c.md']);
  });
});

describe('getStaleByFrontMatter', () => {
  it('flags active docs whose updated is older than threshold', () => {
    const contents: Record<string, string> = {
      'docs/reference/a.md': `---
status: active
updated: 2026-01-01
---`,
      'docs/reference/b.md': `---
status: active
updated: 2026-07-30
---`,
      'docs/reference/c.md': `---
status: stale
updated: 2026-01-01
---`,
    };
    expect(
      getStaleByFrontMatter(
        ['docs/reference/a.md', 'docs/reference/b.md', 'docs/reference/c.md'],
        contents,
        '2026-08-01',
        90,
      ),
    ).toEqual(['docs/reference/a.md']);
  });
  it('skips docs without front-matter or updated', () => {
    expect(
      getStaleByFrontMatter(
        ['docs/reference/d.md'],
        { 'docs/reference/d.md': '# D' },
        '2026-08-01',
        90,
      ),
    ).toEqual([]);
  });
});

describe('findStaleStatusDocs', () => {
  it('flags docs explicitly marked stale but not archived', () => {
    const contents: Record<string, string> = {
      'docs/reference/a.md': `---
status: stale
---`,
      'docs/reference/b.md': `---
status: active
---`,
    };
    expect(
      findStaleStatusDocs(
        ['docs/reference/a.md', 'docs/reference/b.md'],
        contents,
      ),
    ).toEqual(['docs/reference/a.md']);
  });
});

describe('findUncoveredModuleDirs', () => {
  it('flags module dirs without a README', () => {
    expect(
      findUncoveredModuleDirs(
        ['auth', 'audit-log', 'product-events'],
        (dir) => dir !== 'product-events',
      ),
    ).toEqual(['product-events']);
  });
  it('a module with a README counts as covered', () => {
    expect(findUncoveredModuleDirs(['foo'], () => true)).toEqual([]);
  });
  it('respects explicit exemptions', () => {
    expect(
      findUncoveredModuleDirs(
        ['auth', 'audit-log', 'product-events'],
        () => false,
        ['product-events', 'brand-new-module'],
      ),
    ).toEqual(['auth', 'audit-log']);
  });
});

describe('isFrozenDoc', () => {
  it('recognizes status: frozen only', () => {
    expect(isFrozenDoc('---\nstatus: frozen\n---\n# F')).toBe(true);
    expect(isFrozenDoc('---\nstatus: active\n---\n# A')).toBe(false);
    expect(isFrozenDoc('---\nstatus: stale\n---\n# S')).toBe(false);
    expect(isFrozenDoc(undefined)).toBe(false);
    expect(isFrozenDoc('# No front-matter')).toBe(false);
  });
});

describe('withoutFrozenDocs', () => {
  it('drops paths marked status: frozen, keeps the rest', () => {
    const contents: Record<string, string> = {
      'docs/reference/f.md': `---
status: frozen
---`,
      'docs/reference/a.md': `---
status: active
---`,
      'docs/reference/s.md': `---
status: stale
---`,
      'docs/reference/n.md': '# No front-matter',
    };
    expect(
      withoutFrozenDocs(
        [
          'docs/reference/f.md',
          'docs/reference/a.md',
          'docs/reference/s.md',
          'docs/reference/n.md',
        ],
        contents,
      ),
    ).toEqual([
      'docs/reference/a.md',
      'docs/reference/s.md',
      'docs/reference/n.md',
    ]);
  });
  it('keeps paths without content', () => {
    expect(withoutFrozenDocs(['docs/reference/x.md'], {})).toEqual([
      'docs/reference/x.md',
    ]);
  });
});

describe('getStaleByFrontMatter (frozen)', () => {
  it('does not flag status: frozen docs', () => {
    const contents: Record<string, string> = {
      'docs/reference/f.md': `---
status: frozen
updated: 2026-01-01
---`,
      'docs/reference/a.md': `---
status: active
updated: 2026-01-01
---`,
    };
    expect(
      getStaleByFrontMatter(
        ['docs/reference/f.md', 'docs/reference/a.md'],
        contents,
        '2026-08-01',
        90,
      ),
    ).toEqual(['docs/reference/a.md']);
  });
});
