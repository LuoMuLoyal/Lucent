import { describe, expect, it } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveAgentWorkspace, scrubEnvironment } from './workspace.js';

describe('scrubEnvironment', () => {
  it('drops credential-shaped names', () => {
    // The process holds the database URL, the Redis password and provider keys.
    // An inherited environment hands every one of them to anything the model
    // runs — `env`, a crash report, a carelessly written script.
    const scrubbed = scrubEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/u',
      DATABASE_URL: 'postgres://user:pw@host/db',
      REDIS_PASSWORD: 'hunter2',
      OPENAI_API_KEY: 'sk-live',
      WECHAT_APPSECRET: 'secret',
      JWT_TOKEN: 'jwt',
      SOME_CREDENTIAL: 'creds',
    } as NodeJS.ProcessEnv);

    expect(Object.keys(scrubbed).sort()).toEqual(['HOME', 'PATH']);
  });

  it('drops the harness namespace', () => {
    const scrubbed = scrubEnvironment({
      PATH: '/usr/bin',
      DSH_PROFILE: 'desktop',
      DSH_INSTALL_DIR: '/opt/dsh',
    } as NodeJS.ProcessEnv);

    expect(Object.keys(scrubbed)).toEqual(['PATH']);
  });

  it('keeps ordinary variables untouched', () => {
    const scrubbed = scrubEnvironment({
      NODE_ENV: 'test',
      LANG: 'en_US.UTF-8',
      TZ: 'UTC',
    } as NodeJS.ProcessEnv);

    expect(scrubbed).toEqual({
      NODE_ENV: 'test',
      LANG: 'en_US.UTF-8',
      TZ: 'UTC',
    });
  });

  it('is case-insensitive about credential names', () => {
    const scrubbed = scrubEnvironment({
      apiKey: 'x',
      Api_Token: 'y',
      password: 'z',
      Path: '/bin',
    } as NodeJS.ProcessEnv);

    expect(Object.keys(scrubbed)).toEqual(['Path']);
  });
});

describe('resolveAgentWorkspace', () => {
  it('creates a dedicated directory per conversation', () => {
    // Without this the shell's cwd is the repository root, which holds
    // `.env.development` and the whole source tree.
    const workspace = resolveAgentWorkspace('conv-abc123');
    try {
      expect(workspace).toContain('lucent-agent-conv-abc123');
      expect(existsSync(workspace)).toBe(true);
      expect(workspace.startsWith(tmpdir())).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('mints a fresh directory when there is no conversation id', () => {
    const first = resolveAgentWorkspace();
    const second = resolveAgentWorkspace();
    try {
      expect(first).not.toBe(second);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('refuses a conversation id that would escape the temp root', () => {
    // The id reaches this function from the request body. Accepting it verbatim
    // would let `../../etc` point the workspace at an arbitrary directory —
    // the one traversal risk `virtualMode` cannot cover, because the root is
    // chosen before any tool runs.
    const workspace = resolveAgentWorkspace('../../etc');
    try {
      expect(workspace).not.toContain('..');
      expect(workspace.startsWith(tmpdir())).toBe(true);
      expect(workspace).toContain('lucent-agent-ephemeral-');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('accepts ids with uuid characters and underscores', () => {
    const workspace = resolveAgentWorkspace('a1b2-c3d4_e5f6');
    try {
      expect(workspace).toContain('lucent-agent-a1b2-c3d4_e5f6');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('is idempotent for the same conversation id', () => {
    const first = resolveAgentWorkspace('conv-same');
    const second = resolveAgentWorkspace('conv-same');
    try {
      expect(first).toBe(second);
    } finally {
      rmSync(first, { recursive: true, force: true });
    }
  });
});
