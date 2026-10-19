import { EnvKey } from '../env/env-keys.enum.js';
import {
  RUNTIME_CONFIG_DOCUMENT_MAX_BYTES,
  parseRuntimeConfigDocument,
} from './runtime-config.schema.js';

const HEADER = 'RNACOS_SCHEMA_VERSION=3\nRNACOS_REVISION=test.1\n';

function parse(body: string, header: string = HEADER) {
  return parseRuntimeConfigDocument(`${header}${body}`);
}

describe('parseRuntimeConfigDocument', () => {
  it('applies a valid document and resolves typed values', () => {
    const result = parse(
      [
        'THROTTLE_LIMIT=250',
        'THROTTLE_TTL_MS=30000',
        'JWT_ACCESS_TTL=15m',
        'AI_VISION_TEMPERATURE=0.4',
        'LIGHTRAG_GRAPH_SOURCES=leaflet, qa',
        'VERIFICATION_CODE_LENGTH=8',
        'PROMPT_MEAL_ANALYSIS_SYSTEM=请用 {{language}} 回答。',
      ].join('\n'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revision).toBe('test.1');
    expect(result.overrides[EnvKey.THROTTLE_LIMIT]).toBe(250);
    expect(result.overrides[EnvKey.THROTTLE_TTL_MS]).toBe(30_000);
    expect(result.overrides[EnvKey.JWT_ACCESS_TTL]).toBe(900);
    expect(result.overrides[EnvKey.AI_VISION_TEMPERATURE]).toBe(0.4);
    expect(result.overrides[EnvKey.LIGHTRAG_GRAPH_SOURCES]).toEqual([
      'leaflet',
      'qa',
    ]);
    expect(result.overrides[EnvKey.VERIFICATION_CODE_LENGTH]).toBe(8);
    expect(result.overrides[EnvKey.PROMPT_MEAL_ANALYSIS_SYSTEM]).toBe(
      '请用 {{language}} 回答。',
    );
  });

  it('treats blank values as "keep the baseline" instead of zero or empty', () => {
    const result = parse('THROTTLE_LIMIT=\nTHROTTLE_TTL_MS=\n');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides).toEqual({});
  });

  it('expands \\n escapes in prompts', () => {
    const result = parse('PROMPT_INTENT_ROUTER=route one\\nturn');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides[EnvKey.PROMPT_INTENT_ROUTER]).toBe(
      'route one\nturn',
    );
  });

  it('ignores comments and blank lines, and does not treat inline # as a comment', () => {
    const result = parse(
      [
        '# a comment',
        '   # an indented comment',
        '',
        'TENCENT_COS_PUBLIC_BASE_URL=https://cos.example.com/#/bucket',
      ].join('\n'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides[EnvKey.TENCENT_COS_PUBLIC_BASE_URL]).toBe(
      'https://cos.example.com/#/bucket',
    );
  });

  it('rejects a line without KEY=value', () => {
    const result = parse('THROTTLE_LIMIT 100');

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_syntax' }),
    );
  });

  it('rejects a key that does not match the env charset', () => {
    const result = parse('throttle_limit=100');

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_syntax' }),
    );
  });

  it('rejects duplicate keys rather than taking the last one', () => {
    const result = parse('THROTTLE_LIMIT=100\nTHROTTLE_LIMIT=200');

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'duplicate_key' }),
    );
  });

  it('rejects keys outside the whitelist, including secrets and connection strings', () => {
    for (const key of [
      'JWT_ACCESS_SECRET',
      'AI_VISION_API_KEY',
      'DATABASE_URL',
      'AI_PROVIDER',
      'THROTTLE_LIMITTT',
    ]) {
      const result = parse(`${key}=whatever`);
      expect(result).toEqual(
        expect.objectContaining({ ok: false, reason: 'invalid_schema' }),
      );
      if (result.ok) continue;
      expect(result.message).toContain(key);
    }
  });

  it('never echoes the offending value in the rejection message', () => {
    const result = parse('THROTTLE_LIMIT=super-secret-value');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(EnvKey.THROTTLE_LIMIT);
    expect(result.message).not.toContain('super-secret-value');
  });

  it('rejects out-of-range and mistyped values', () => {
    for (const body of [
      'THROTTLE_LIMIT=0',
      'THROTTLE_LIMIT=1001',
      'THROTTLE_TTL_MS=500',
      'METRICS_ENABLED=yes',
      'AI_VISION_TEMPERATURE=2.5',
      'AI_VISION_MAX_RETRIES=9',
      'VERIFICATION_CODE_LENGTH=12',
      'LOG_LEVEL=trace',
      'MEAL_ANALYSIS_REAP_CRON=*/5 * * *',
      'LIGHTRAG_GRAPH_SOURCES=leaflet,,qa',
      'TENCENT_COS_PUBLIC_BASE_URL=cos.example.com',
      'SUPPORT_EMAIL=not-an-email',
    ]) {
      const result = parse(body);
      expect(result).toEqual(
        expect.objectContaining({ ok: false, reason: 'invalid_schema' }),
      );
    }
  });

  it('accepts a fractional temperature but rejects a fractional integer field', () => {
    expect(parse('AI_VISION_TEMPERATURE=0.15').ok).toBe(true);
    expect(parse('THROTTLE_LIMIT=10.5')).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_schema' }),
    );
  });

  it('rejects a prompt that drops a declared placeholder', () => {
    const result = parse('PROMPT_MEAL_ANALYSIS_SYSTEM=analyze this meal');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_schema');
    expect(result.message).toContain('{{language}}');
  });

  it('rejects a prompt longer than the limit', () => {
    const result = parse(`PROMPT_INTENT_ROUTER=${'x'.repeat(8_001)}`);

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_schema' }),
    );
  });

  it('requires the schema version to be exactly 3', () => {
    const missing = parse('THROTTLE_LIMIT=100', 'RNACOS_REVISION=test.1\n');
    expect(missing).toEqual(
      expect.objectContaining({ ok: false, reason: 'unsupported_version' }),
    );

    const version4 = parse(
      'THROTTLE_LIMIT=100',
      'RNACOS_SCHEMA_VERSION=4\nRNACOS_REVISION=test.1\n',
    );
    expect(version4).toEqual(
      expect.objectContaining({ ok: false, reason: 'unsupported_version' }),
    );
  });

  it('requires a well-formed revision', () => {
    for (const header of [
      'RNACOS_SCHEMA_VERSION=3\n',
      'RNACOS_SCHEMA_VERSION=3\nRNACOS_REVISION=\n',
      'RNACOS_SCHEMA_VERSION=3\nRNACOS_REVISION=has spaces\n',
    ]) {
      expect(parse('THROTTLE_LIMIT=100', header)).toEqual(
        expect.objectContaining({ ok: false, reason: 'invalid_schema' }),
      );
    }
  });

  it('rejects a document larger than 256 KiB', () => {
    const filler = `PROMPT_INTENT_ROUTER=${'x'.repeat(
      RUNTIME_CONFIG_DOCUMENT_MAX_BYTES,
    )}`;
    const result = parse(filler);

    expect(result).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_syntax' }),
    );
  });

  it('returns only overrides, so a header-only document means "back to baseline"', () => {
    const result = parse('');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides).toEqual({});
  });
});
