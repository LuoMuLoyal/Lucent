import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { createMcpAuthenticator } from './auth.js';

/** Minimal request stub carrying only what the authenticator reads. */
function requestWith(authorization?: string): IncomingMessage {
  return {
    headers: authorization == null ? {} : { authorization },
  } as IncomingMessage;
}

describe('createMcpAuthenticator', () => {
  it('accepts the configured token', async () => {
    const authenticate = createMcpAuthenticator({
      expectedToken: 'secret-token',
    });
    const caller = await authenticate(requestWith('Bearer secret-token'));

    expect(caller).not.toBeNull();
    expect(caller?.subject).toBe('mcp-client');
    expect(caller?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a wrong token', async () => {
    const authenticate = createMcpAuthenticator({
      expectedToken: 'secret-token',
    });
    expect(await authenticate(requestWith('Bearer wrong-token'))).toBeNull();
    expect(
      await authenticate(requestWith('Bearer secret-token-but-longer')),
    ).toBeNull();
  });

  it('rejects a missing or malformed authorization header', async () => {
    const authenticate = createMcpAuthenticator({
      expectedToken: 'secret-token',
    });
    expect(await authenticate(requestWith())).toBeNull();
    expect(await authenticate(requestWith('secret-token'))).toBeNull();
    expect(await authenticate(requestWith('Basic secret-token'))).toBeNull();
  });

  it('runs unauthenticated when no token is configured', async () => {
    // Deployment-controlled: `MCP_ENABLED` without `MCP_API_KEY` is a deliberate
    // local setup. The module logs a warning at startup so it cannot happen
    // silently; here we only pin that the behaviour is "allow", not "reject".
    const authenticate = createMcpAuthenticator({ expectedToken: undefined });
    const caller = await authenticate(requestWith());

    expect(caller?.subject).toBe('anonymous');
  });

  it('treats an empty token as "not configured"', async () => {
    const authenticate = createMcpAuthenticator({ expectedToken: '' });
    expect((await authenticate(requestWith()))?.subject).toBe('anonymous');
  });

  it('issues a distinct requestId per call', async () => {
    const authenticate = createMcpAuthenticator({
      expectedToken: 'secret-token',
    });
    const first = await authenticate(requestWith('Bearer secret-token'));
    const second = await authenticate(requestWith('Bearer secret-token'));

    expect(first?.requestId).not.toBe(second?.requestId);
  });
});
