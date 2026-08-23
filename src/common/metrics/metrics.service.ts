import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { EnvKey } from '../../config/env/env-keys.enum';

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

  // ── Cache metrics ─────────────────────────────────────────────────────────

  private readonly assistantCacheAccesses: Counter;

  // ── Proactive suggestion metrics ─────────────────────────────────────────

  private readonly suggestionRecomputeEnqueues: Counter;
  private readonly suggestionRecomputeDedupes: Counter;
  private readonly suggestionRecomputeDuration: Histogram;
  private readonly suggestionMaterializationReady: Counter;
  private readonly suggestionMaterializationFailed: Counter;
  private readonly suggestionStaleAge: Histogram;

  // ── Product event metrics ───────────────────────────────────────────────

  private readonly productEventEmissionFailures: Counter;

  // ── Audit log metrics ──────────────────────────────────────────────────

  private readonly auditLogWriteFailures: Counter;

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

    this.assistantCacheAccesses = new Counter({
      name: 'assistant_cache_accesses_total',
      help: 'Assistant cache accesses by layer and hit/miss',
      labelNames: ['kind', 'hit'] as const,
      registers: [this.registry],
    });

    // Proactive suggestion metrics intentionally use no user, date, or health
    // content labels so their cardinality stays bounded.
    this.suggestionRecomputeEnqueues = new Counter({
      name: 'today_suggestion_recompute_enqueue_total',
      help: 'Total proactive suggestion recompute enqueue attempts',
      registers: [this.registry],
    });

    this.suggestionRecomputeDedupes = new Counter({
      name: 'today_suggestion_recompute_dedupe_total',
      help: 'Total proactive suggestion recompute jobs coalesced',
      registers: [this.registry],
    });

    this.suggestionRecomputeDuration = new Histogram({
      name: 'today_suggestion_recompute_duration_seconds',
      help: 'Proactive suggestion recompute duration in seconds',
      labelNames: ['status'] as const,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      registers: [this.registry],
    });

    this.suggestionMaterializationReady = new Counter({
      name: 'today_suggestion_materialization_ready_total',
      help: 'Total proactive suggestion materializations marked ready',
      registers: [this.registry],
    });

    this.suggestionMaterializationFailed = new Counter({
      name: 'today_suggestion_materialization_failed_total',
      help: 'Total proactive suggestion materializations marked failed',
      registers: [this.registry],
    });

    this.suggestionStaleAge = new Histogram({
      name: 'today_suggestion_stale_age_seconds',
      help: 'Age in seconds of an observed stale suggestion materialization',
      buckets: [60, 300, 900, 1_800, 3_600, 10_800, 86_400, 604_800],
      registers: [this.registry],
    });

    // Labeled only by the fixed event name (11 values) — no userId, date or
    // health content in labels, so cardinality stays bounded.
    this.productEventEmissionFailures = new Counter({
      name: 'product_event_emission_failure_total',
      help: 'Total server-side product event emission failures by event name',
      labelNames: ['event'] as const,
      registers: [this.registry],
    });

    // Labeled only by the fixed audit action string — no userId, resource id
    // or metadata in labels, so cardinality stays bounded.
    this.auditLogWriteFailures = new Counter({
      name: 'audit_log_write_failure_total',
      help: 'Total audit log write failures by action',
      labelNames: ['action'] as const,
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

  /**
   * Records an assistant cache access (node / tool / response layer).
   * Used to observe cache hit rates for the LangGraph runtime.
   */
  recordCacheAccess(kind: 'node' | 'tool' | 'response', hit: boolean): void {
    if (!this.enabled) {
      return;
    }
    this.assistantCacheAccesses.inc({ kind, hit: String(hit) });
  }

  recordSuggestionRecomputeEnqueue(): void {
    if (!this.enabled) return;
    this.suggestionRecomputeEnqueues.inc();
  }

  recordSuggestionRecomputeDedupe(): void {
    if (!this.enabled) return;
    this.suggestionRecomputeDedupes.inc();
  }

  recordSuggestionRecomputeDuration(
    status: 'success' | 'failed',
    durationSeconds: number,
  ): void {
    if (!this.enabled) return;
    this.suggestionRecomputeDuration.observe({ status }, durationSeconds);
  }

  recordSuggestionMaterializationReady(): void {
    if (!this.enabled) return;
    this.suggestionMaterializationReady.inc();
  }

  recordSuggestionMaterializationFailed(): void {
    if (!this.enabled) return;
    this.suggestionMaterializationFailed.inc();
  }

  recordSuggestionStaleAge(ageSeconds: number): void {
    if (!this.enabled) return;
    this.suggestionStaleAge.observe(ageSeconds);
  }

  /**
   * Records a server-side product event emission failure (event name only —
   * no userId, no event content). Called from the fire-and-forget emission
   * path in `ProductEventsService.emitServerEvent`.
   */
  recordProductEventEmissionFailure(eventName: string): void {
    if (!this.enabled) return;
    this.productEventEmissionFailures.inc({ event: eventName });
  }

  /**
   * Records an audit-log write failure (action only — no userId, resource id
   * or metadata). Called from the fire-and-forget path in
   * `AuditLogService.logFireAndForget`.
   */
  recordAuditLogWriteFailure(action: string): void {
    if (!this.enabled) return;
    this.auditLogWriteFailures.inc({ action });
  }
}
