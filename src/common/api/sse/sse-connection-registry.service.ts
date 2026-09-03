import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { writeSseEvent, type SseConnectionTracker } from './sse.js';
import { SseProblemDetailsMapper } from './sse-problem-details.js';

/**
 * Tracks every open SSE connection so a shutdown (SIGTERM →
 * `app.enableShutdownHooks()` → `beforeApplicationShutdown`) can notify
 * clients with a terminal event and end their streams instead of letting
 * the process kill them mid-flight. `closeAll` is deliberately
 * non-blocking: it writes the terminal event best-effort and ends each
 * response without awaiting client drains.
 */
@Injectable()
export class SseConnectionRegistry
  implements SseConnectionTracker, BeforeApplicationShutdown
{
  private readonly logger = new Logger(SseConnectionRegistry.name);
  private readonly connections = new Map<ServerResponse, string>();

  constructor(private readonly problemDetails: SseProblemDetailsMapper) {}

  /** Number of currently tracked connections. */
  get size(): number {
    return this.connections.size;
  }

  register(response: ServerResponse, language = 'en'): void {
    this.connections.set(response, language);
    // Client disconnects / network resets surface as `close`; drop the
    // connection so closeAll never writes to a dead socket.
    response.once('close', () => {
      this.unregister(response);
    });
  }

  unregister(response: ServerResponse): void {
    this.connections.delete(response);
  }

  closeAll(): void {
    const count = this.connections.size;
    for (const [response, language] of this.connections) {
      this.connections.delete(response);
      try {
        writeSseEvent(response, {
          event: 'error',
          data: this.problemDetails.build(new Error('server shutdown'), {
            lang: language,
            code: 'SERVER_SHUTDOWN',
            status: 'server_shutdown',
          }),
        });
        if (!response.writableEnded) {
          response.end();
        }
      } catch (error) {
        // Best-effort: one broken connection must not abort the shutdown,
        // but we log it so operators can diagnose leaks during graceful shutdown.
        this.logger.warn('Failed to close SSE connection during shutdown', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (count > 0) {
      this.logger.log(
        `Closed ${String(count)} active SSE connection(s) for server shutdown`,
      );
    }
  }

  beforeApplicationShutdown(): void {
    this.closeAll();
  }
}
