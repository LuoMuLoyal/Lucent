import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Circuit breaker states.
 *
 * - `closed`   — requests flow normally; failures are counted.
 * - `open`     — requests are rejected immediately without calling the LLM.
 * - `halfOpen` — a limited number of probe requests are allowed through to
 *   test whether the downstream provider has recovered.
 */
export type CircuitState = 'closed' | 'open' | 'halfOpen';

/**
 * Snapshot of circuit-breaker internals, mainly for observability and tests.
 */
export interface CircuitBreakerSnapshot {
  state: CircuitState;
  /** Consecutive failure count in the current closed window. */
  consecutiveFailures: number;
  /** Consecutive success count in the current half-open window. */
  consecutiveSuccesses: number;
  /** Epoch-ms timestamp of the last state transition to `open`. */
  openedAt: number | null;
}

/**
 * Tunable parameters for {@link LlmCircuitBreakerService}.
 */
export interface CircuitBreakerOptions {
  /** Failures in `closed` state required to trip the breaker to `open`. */
  failureThreshold: number;
  /** Milliseconds to stay `open` before transitioning to `halfOpen`. */
  recoveryTimeoutMs: number;
  /** Successes in `halfOpen` required to close the breaker. */
  halfOpenSuccessThreshold: number;
  /**
   * Maximum concurrent probe requests allowed in `halfOpen` state. Extra
   * callers receive the same fast-fail as in `open` state.
   */
  halfOpenMaxProbes: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 2,
  halfOpenMaxProbes: 1,
};

/**
 * Circuit-breaker error thrown when the breaker is `open` or when probe
 * capacity in `halfOpen` is exhausted.
 *
 * Uses `ServiceUnavailableException` (HTTP 503) so the global exception filter
 * returns a semantically correct status to API callers, while the summary
 * fallback layer in `BaseLlmSummaryService` still catches and degrades.
 */
export class LlmCircuitOpenError extends ServiceUnavailableException {
  constructor(message = 'LLM circuit breaker is open') {
    super(message);
  }
}

/**
 * Lightweight circuit breaker for all outbound LLM calls.
 *
 * Design notes:
 *
 * - Pure in-process counter — no Redis coordination. In a single-slot
 *   deployment this is sufficient because there is only one backend instance
 *   at a time.
 * - Not a per-role breaker: all LLM roles (`analysis`, `chat`, …) share one
 *   breaker. Rationale: they typically point to the same provider and API key,
 *   so a provider outage affects all roles simultaneously. Splitting per-role
 *   would delay tripping and add complexity without real benefit.
 * - Thread-safety: relies on Node.js single-threaded event loop. The
 *   `halfOpenInFlight` counter is updated synchronously before any `await`,
 *   so there is no race window.
 */
@Injectable()
export class LlmCircuitBreakerService {
  private readonly logger = new Logger(LlmCircuitBreakerService.name);
  private readonly options: CircuitBreakerOptions;

  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;
  private halfOpenInFlight = 0;

  /**
   * @param options optional tuning overrides. When instantiated by NestJS DI
   * (no provider for the options object), `@Optional()` lets the container
   * pass `undefined` and the defaults are used.
   */
  constructor(@Optional() options?: Partial<CircuitBreakerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
  }

  /**
   * Returns the current breaker state, transitioning `open → halfOpen` lazily
   * when the recovery window has elapsed.
   */
  getState(now: number = Date.now()): CircuitState {
    if (this.state === 'open' && this.openedAt !== null) {
      if (now - this.openedAt >= this.options.recoveryTimeoutMs) {
        this.state = 'halfOpen';
        this.consecutiveSuccesses = 0;
        this.halfOpenInFlight = 0;
        this.logger.warn('LLM circuit breaker transitioning open → halfOpen');
      }
    }
    return this.state;
  }

  /**
   * Throws {@link LlmCircuitOpenError} when the call must not proceed.
   *
   * - `closed`  → always allows.
   * - `open`    → always rejects.
   * - `halfOpen`→ allows up to `halfOpenMaxProbes` concurrent probes; extra
   *   callers are rejected so they fall back immediately.
   */
  acquire(): void {
    const state = this.getState();

    if (state === 'open') {
      throw new LlmCircuitOpenError();
    }

    if (state === 'halfOpen') {
      if (this.halfOpenInFlight >= this.options.halfOpenMaxProbes) {
        throw new LlmCircuitOpenError(
          'LLM circuit breaker is half-open and probe capacity is exhausted',
        );
      }
      this.halfOpenInFlight += 1;
    }
  }

  /**
   * Records a successful call and may close the breaker from `halfOpen`.
   */
  recordSuccess(): void {
    const state = this.getState();

    if (state === 'halfOpen') {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.options.halfOpenSuccessThreshold) {
        this.close();
      }
      return;
    }

    // closed
    this.consecutiveFailures = 0;
  }

  /**
   * Records a failed call and may trip the breaker to `open`.
   *
   * When the breaker is already `open`, this is a no-op: the failure was
   * rejected by `acquire()` before the call was made, so it should not
   * inflate `consecutiveFailures` and skew `snapshot()` metrics.
   */
  recordFailure(): void {
    const state = this.getState();

    if (state === 'open') {
      return;
    }

    if (state === 'halfOpen') {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      // A single failure in half-open reopens the breaker.
      this.trip();
      return;
    }

    // closed
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.trip();
    }
  }

  /**
   * Returns a snapshot for metrics / health checks.
   */
  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      openedAt: this.openedAt,
    };
  }

  // ── Internal transitions ──────────────────────────────────────────────────

  private trip(): void {
    if (this.state === 'open') return;
    this.state = 'open';
    this.openedAt = Date.now();
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
    this.logger.error(
      `LLM circuit breaker tripped to OPEN — fast-failing for ${String(this.options.recoveryTimeoutMs)} ms`,
    );
  }

  private close(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.openedAt = null;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenInFlight = 0;
    this.logger.log('LLM circuit breaker closed — LLM calls resumed');
  }
}
