import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { EnvKey } from '../../config/env-keys.enum';

/**
 * Centralised Prometheus metrics registry for the Lucent backend.
 *
 * Collects:
 * - Default Node.js runtime metrics (heap, rss, event loop lag, GC, etc.)
 * - HTTP request latency histogram and counter
 * - BullMQ job counter and gauges
 * - LLM call duration and token usage
 *
 * The `/metrics` endpoint is served by a raw Express route registered in
 * `setupApp`, not a NestJS controller, so it bypasses the interceptor/filter
 * stack and avoids self-referential metric noise.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap {
  private readonly registry: Registry;
  private readonly enabled: boolean;

  // ── HTTP metrics ──────────────────────────────────────────────────────────

  private readonly httpRequestDuration: Histogram;
  private readonly httpRequestsTotal: Counter;

  // ── BullMQ metrics ────────────────────────────────────────────────────────

  private readonly bullmqJobsTotal: Counter;
  private readonly bullmqActiveJobs: Gauge;
  private readonly bullmqWaitingJobs: Gauge;

  // ── LLM metrics ───────────────────────────────────────────────────────────

  private readonly llmCallDuration: Histogram;
  private readonly llmTokensUsed: Counter;

  constructor(private readonly configService: ConfigService) {
    this.registry = new Registry();

    const nodeEnv =
      this.configService.get<string>(EnvKey.NODE_ENV) ?? 'development';
    const explicitlyEnabled =
      this.configService.get<string>(EnvKey.METRICS_ENABLED) !== 'false';
    this.enabled = explicitlyEnabled && nodeEnv !== 'test';

    // HTTP metrics
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    // BullMQ metrics
    this.bullmqJobsTotal = new Counter({
      name: 'bullmq_jobs_total',
      help: 'Total BullMQ jobs by final status',
      labelNames: ['queue', 'status'] as const,
      registers: [this.registry],
    });

    this.bullmqActiveJobs = new Gauge({
      name: 'bullmq_active_jobs',
      help: 'Number of active BullMQ jobs',
      labelNames: ['queue'] as const,
      registers: [this.registry],
    });

    this.bullmqWaitingJobs = new Gauge({
      name: 'bullmq_waiting_jobs',
      help: 'Number of waiting BullMQ jobs',
      labelNames: ['queue'] as const,
      registers: [this.registry],
    });

    // LLM metrics
    this.llmCallDuration = new Histogram({
      name: 'llm_call_duration_seconds',
      help: 'LLM API call duration in seconds',
      labelNames: ['role', 'model', 'status'] as const,
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
      registers: [this.registry],
    });

    this.llmTokensUsed = new Counter({
      name: 'llm_tokens_used_total',
      help: 'Total LLM tokens used',
      labelNames: ['role', 'model', 'type'] as const,
      registers: [this.registry],
    });
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      return;
    }

    collectDefaultMetrics({ register: this.registry });
  }

  /** Returns true when metrics collection is active. */
  is_enabled(): boolean {
    return this.enabled;
  }

  /** Returns the Prometheus exposition-format text. */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** Returns the content type for the Prometheus exposition format. */
  getContentType(): string {
    return this.registry.contentType;
  }

  // ── Recording methods ─────────────────────────────────────────────────────

  /**
   * Records a single HTTP request observation.
   * Called by the metrics middleware on `res.on('finish')`.
   */
  recordHttpRequest(
    method: string,
    route: string,
    status: number,
    durationSeconds: number,
  ): void {
    if (!this.enabled) {
      return;
    }
    const labels = { method, route, status: String(status) };
    this.httpRequestDuration.observe(labels, durationSeconds);
    this.httpRequestsTotal.inc(labels);
  }

  /**
   * Records a BullMQ job completion or failure.
   * Called from queue service event listeners.
   */
  recordBullmqJob(queue: string, status: 'completed' | 'failed'): void {
    if (!this.enabled) {
      return;
    }
    this.bullmqJobsTotal.inc({ queue, status });
  }

  /**
   * Sets the current active job count for a BullMQ queue.
   * Called from queue service event listeners.
   */
  setBullmqActiveJobs(queue: string, count: number): void {
    if (!this.enabled) {
      return;
    }
    this.bullmqActiveJobs.set({ queue }, count);
  }

  /**
   * Sets the current waiting job count for a BullMQ queue.
   * Called from queue service event listeners.
   */
  setBullmqWaitingJobs(queue: string, count: number): void {
    if (!this.enabled) {
      return;
    }
    this.bullmqWaitingJobs.set({ queue }, count);
  }

  /**
   * Records an LLM API call observation.
   * Called from AI service wrappers.
   */
  recordLlmCall(
    role: string,
    model: string,
    status: 'success' | 'error',
    durationSeconds: number,
  ): void {
    if (!this.enabled) {
      return;
    }
    this.llmCallDuration.observe({ role, model, status }, durationSeconds);
  }

  /**
   * Records LLM token usage.
   * Called from AI service wrappers.
   */
  recordLlmTokens(
    role: string,
    model: string,
    type: 'prompt' | 'completion',
    count: number,
  ): void {
    if (!this.enabled) {
      return;
    }
    this.llmTokensUsed.inc({ role, model, type }, count);
  }
}
