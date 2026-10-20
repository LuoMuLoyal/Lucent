import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  collectRuntimeConfigExampleProblems,
  diffRuntimeConfigExampleKeys,
} from './runtime-config-example.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('diffRuntimeConfigExampleKeys', () => {
  it('accepts a document whose keys match exactly', () => {
    const raw = '# comment\nA=1\nB=2\n';
    expect(diffRuntimeConfigExampleKeys(raw, ['A', 'B'])).toEqual([]);
  });

  it('reports missing keys', () => {
    const problems = diffRuntimeConfigExampleKeys('A=1\n', ['A', 'B']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('missing keys');
    expect(problems[0]).toContain('B');
  });

  it('reports keys the schema does not accept', () => {
    const problems = diffRuntimeConfigExampleKeys('A=1\nC=3\n', ['A']);
    expect(problems[0]).toContain('not accepted');
    expect(problems[0]).toContain('C');
  });

  it('reports duplicate keys', () => {
    const problems = diffRuntimeConfigExampleKeys('A=1\nA=2\n', ['A']);
    expect(problems[0]).toContain('duplicate keys');
  });
});

describe('collectRuntimeConfigExampleProblems', () => {
  it('keeps the checked-in template aligned with the schema', async () => {
    await expect(
      collectRuntimeConfigExampleProblems(repoRoot),
    ).resolves.toEqual([]);
  });
});
