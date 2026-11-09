import type { CallbackHandler } from '@langfuse/langchain';
import type { ConfigService } from '@nestjs/config';
import { EnvKey } from '../../../config/env/env-keys.enum.js';

/**
 * Langfuse tracing for LangChain / LangGraph call sites.
 *
 * `@langfuse/langchain` is loaded lazily and only when configured. Two reasons:
 *
 * 1. **Startup cost** — the package pulls in the Langfuse client, which is dead
 *    weight for every deployment that does not trace to Langfuse.
 * 2. **No-op by default** — `LANGFUSE_ENABLED` defaults to `false`
 *    (`environment.validation.ts`), so importing this module must not change
 *    behaviour or open sockets unless an operator opted in.
 *
 * The `CallbackHandler` itself only emits OpenTelemetry spans; the actual export
 * is done by the `LangfuseSpanProcessor` registered in `src/tracing.ts`. Both
 * halves are required — a handler without the processor produces spans that
 * nothing ships.
 */

let cached: Promise<CallbackHandler | null> | null = null;

/**
 * Whether Langfuse tracing is switched on for this process.
 *
 * Takes the `ConfigService` rather than reading `process.env` directly: these
 * call sites run after ConfigModule is up, and the validated values (defaults,
 * coercion) are the ones that must win. Only `src/tracing.ts` reads the bare
 * environment, because it necessarily runs before Nest exists.
 *
 * Both keys are required — enabling the flag without credentials would put
 * every span on a round trip guaranteed to fail.
 */
export function isLangfuseEnabled(config: ConfigService): boolean {
  return (
    config.get<string>(EnvKey.LANGFUSE_ENABLED) === 'true' &&
    (config.get<string>(EnvKey.LANGFUSE_PUBLIC_KEY) ?? '') !== '' &&
    (config.get<string>(EnvKey.LANGFUSE_SECRET_KEY) ?? '') !== ''
  );
}

/**
 * Resolves the process-wide `CallbackHandler`, or `null` when Langfuse is off.
 *
 * The handler is stateless with respect to the trace's identity: `userId` and
 * `sessionId` are supplied per invocation through LangChain's `config.metadata`
 * (`langfuse.user.id` / `langfuse.session.id`), so one instance serves every
 * request and every user. That is what makes a module-level cache safe here.
 *
 * A failed import resolves to `null` with a warning instead of throwing:
 * observability must never take down a conversation turn.
 */
export function getLangfuseCallbackHandler(
  config: ConfigService,
): Promise<CallbackHandler | null> {
  if (!isLangfuseEnabled(config)) {
    return Promise.resolve(null);
  }

  cached ??= (async () => {
    try {
      const { CallbackHandler: Handler } = await import('@langfuse/langchain');
      // Point the handler at the same project the span processor exports to.
      // The Cloud region lives in `LANGFUSE_BASE_URL`; omitting it here would
      // let the handler'd tracing helpers default to EU while spans go to US.
      return new Handler();
    } catch (error) {
      console.warn(
        `Langfuse CallbackHandler unavailable, continuing untraced: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  })();

  return cached;
}

/**
 * Builds the LangChain `config` fragment that carries Langfuse trace identity.
 *
 * Langfuse reads these keys off the run's metadata, so they must sit under
 * `langfuse.*` — not at the top level, which LangChain would keep as generic
 * metadata that Langfuse never interprets.
 *
 * @returns A partial LangChain config, or `undefined` when tracing is off so
 * call sites can spread it without branching.
 */
export function langfuseTraceConfig(
  handler: CallbackHandler | null,
  identity: { userId?: string; sessionId?: string; tags?: string[] },
): Record<string, unknown> | undefined {
  if (handler == null) {
    return undefined;
  }

  const metadata: Record<string, unknown> = {
    'langfuse.tags': identity.tags ?? [],
  };
  // A health-data conversation is not a security session: dropping the user id
  // per Langfuse's own guidance would still leave the transcript, so keep the
  // id — it is a UUID, not an email or a name.
  if (identity.userId != null) {
    metadata['langfuse.user.id'] = identity.userId;
  }
  if (identity.sessionId != null) {
    metadata['langfuse.session.id'] = identity.sessionId;
  }

  return { callbacks: [handler], metadata };
}
