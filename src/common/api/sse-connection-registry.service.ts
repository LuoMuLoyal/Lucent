import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import {
  writeSseEvent,
  type SseConnectionTracker,
  type SseMessage,
} from './sse';

/**
 * Terminal event pushed to every live SSE connection right before it is
 * closed on server shutdown. Reuses the existing `error` event shape
 * (`{ message }`, plus an additive `reason`) so current clients handle it
 * without any contract change.
 */
const SHUTDOWN_MESSAGE: SseMessage = {
  event: 'error',
  data: {
    message: 'Server is shutting down. Please retry your request.',
    reason: 'server_shutdown',
  },
};

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
  private readonly connections = new Set<ServerResponse>();

  /** Number of currently tracked connections. */
  get size(): number {
    return this.connections.size;
  }

  register(response: ServerResponse): void {
    this.connections.add(response);
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
    for (const response of this.connections) {
      this.connections.delete(response);
      try {
        writeSseEvent(response, SHUTDOWN_MESSAGE);
        if (!response.writableEnded) {
          response.end();
        }
      } catch {
        // Best-effort: one broken connection must not abort the shutdown.
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
