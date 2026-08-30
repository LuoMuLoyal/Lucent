import {
  LlmCircuitBreakerService,
  LlmCircuitOpenError,
} from './llm-circuit-breaker.service';

describe('LlmCircuitBreakerService', () => {
  describe('closed state (initial)', () => {
    it('starts in closed state', () => {
      const breaker = new LlmCircuitBreakerService();
      expect(breaker.snapshot().state).toBe('closed');
    });

    it('allows all calls in closed state', () => {
      const breaker = new LlmCircuitBreakerService();
      expect(() => {
        breaker.acquire();
      }).not.toThrow();
      expect(() => {
        breaker.acquire();
      }).not.toThrow();
      expect(() => {
        breaker.acquire();
      }).not.toThrow();
    });

    it('resets consecutive failures on success', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 3,
      });
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();
      expect(breaker.snapshot().consecutiveFailures).toBe(0);
      expect(breaker.snapshot().state).toBe('closed');
    });
  });

  describe('tripping to open', () => {
    it('trips to open after reaching failureThreshold', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 3,
      });
      breaker.recordFailure();
      breaker.recordFailure();
      expect(breaker.snapshot().state).toBe('closed');
      breaker.recordFailure();
      expect(breaker.snapshot().state).toBe('open');
    });

    it('throws LlmCircuitOpenError when acquiring in open state', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
      });
      breaker.recordFailure();
      expect(() => {
        breaker.acquire();
      }).toThrow(LlmCircuitOpenError);
    });

    it('LlmCircuitOpenError is a ServiceUnavailableException (HTTP 503)', () => {
      const error = new LlmCircuitOpenError();
      expect(error.getStatus()).toBe(503);
    });

    it('resets counters when tripping', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 2,
      });
      breaker.recordFailure();
      breaker.recordFailure();
      const snap = breaker.snapshot();
      expect(snap.state).toBe('open');
      expect(snap.consecutiveFailures).toBe(0);
      expect(snap.openedAt).not.toBeNull();
    });
  });

  describe('recovery to half-open', () => {
    it('stays open before recovery timeout elapses', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
        recoveryTimeoutMs: 1000,
      });
      breaker.recordFailure();
      const openedAt = breaker.snapshot().openedAt!;

      // 500ms later — still open
      expect(breaker.getState(openedAt + 500)).toBe('open');
    });

    it('transitions to half-open after recovery timeout', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
        recoveryTimeoutMs: 1000,
      });
      breaker.recordFailure();
      const openedAt = breaker.snapshot().openedAt!;

      expect(breaker.getState(openedAt + 1001)).toBe('halfOpen');
    });

    it('allows one probe in half-open (default halfOpenMaxProbes=1)', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
        recoveryTimeoutMs: 1000,
      });
      breaker.recordFailure();
      const openedAt = breaker.snapshot().openedAt!;

      // Force half-open
      breaker.getState(openedAt + 1001);

      // First probe is allowed
      expect(() => {
        breaker.acquire();
      }).not.toThrow();
      // Second concurrent probe is rejected
      expect(() => {
        breaker.acquire();
      }).toThrow(LlmCircuitOpenError);
    });

    it('reopens on a single failure in half-open', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
        recoveryTimeoutMs: 1000,
        halfOpenSuccessThreshold: 2,
      });
      breaker.recordFailure();
      const openedAt = breaker.snapshot().openedAt!;

      // Force half-open
      breaker.getState(openedAt + 1001);

      breaker.acquire();
      breaker.recordFailure();

      expect(breaker.snapshot().state).toBe('open');
    });
  });

  describe('closing from half-open', () => {
    it('closes after reaching halfOpenSuccessThreshold', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
        recoveryTimeoutMs: 1000,
        halfOpenSuccessThreshold: 2,
      });
      breaker.recordFailure();
      const openedAt = breaker.snapshot().openedAt!;

      // Force half-open
      breaker.getState(openedAt + 1001);

      breaker.acquire();
      breaker.recordSuccess();
      expect(breaker.snapshot().state).toBe('halfOpen');

      breaker.acquire();
      breaker.recordSuccess();
      expect(breaker.snapshot().state).toBe('closed');
    });

    it('closes after just one success when halfOpenSuccessThreshold=1', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
        recoveryTimeoutMs: 1000,
        halfOpenSuccessThreshold: 1,
      });
      breaker.recordFailure();
      const openedAt = breaker.snapshot().openedAt!;

      breaker.getState(openedAt + 1001);
      breaker.acquire();
      breaker.recordSuccess();

      expect(breaker.snapshot().state).toBe('closed');
    });
  });

  describe('snapshot', () => {
    it('returns a consistent snapshot', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 5,
      });
      breaker.recordFailure();
      breaker.recordFailure();

      const snap = breaker.snapshot();
      expect(snap.state).toBe('closed');
      expect(snap.consecutiveFailures).toBe(2);
      expect(snap.consecutiveSuccesses).toBe(0);
      expect(snap.openedAt).toBeNull();
    });

    it('returns openedAt after tripping', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 1,
      });
      breaker.recordFailure();
      const snap = breaker.snapshot();
      expect(snap.openedAt).not.toBeNull();
      expect(typeof snap.openedAt).toBe('number');
    });
  });

  describe('default options', () => {
    it('uses failureThreshold=5 by default', () => {
      const breaker = new LlmCircuitBreakerService();
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure();
      }
      expect(breaker.snapshot().state).toBe('closed');
      breaker.recordFailure();
      expect(breaker.snapshot().state).toBe('open');
    });

    it('uses halfOpenSuccessThreshold=2 by default', () => {
      const breaker = new LlmCircuitBreakerService();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordFailure();
      const openedAt = breaker.snapshot().openedAt!;

      breaker.getState(openedAt + 30_001);
      breaker.acquire();
      breaker.recordSuccess();
      expect(breaker.snapshot().state).toBe('halfOpen');

      breaker.acquire();
      breaker.recordSuccess();
      expect(breaker.snapshot().state).toBe('closed');
    });
  });

  describe('integration with acquire/recordSuccess/recordFailure cycle', () => {
    it('simulates a full outage and recovery cycle', () => {
      const breaker = new LlmCircuitBreakerService({
        failureThreshold: 3,
        recoveryTimeoutMs: 1000,
        halfOpenSuccessThreshold: 2,
      });

      // Normal operation
      expect(breaker.snapshot().state).toBe('closed');
      breaker.acquire();
      breaker.recordSuccess();
      expect(breaker.snapshot().state).toBe('closed');

      // Outage begins
      breaker.acquire();
      breaker.recordFailure();
      breaker.acquire();
      breaker.recordFailure();
      breaker.acquire();
      breaker.recordFailure();
      expect(breaker.snapshot().state).toBe('open');

      // Calls are now fast-failed
      expect(() => {
        breaker.acquire();
      }).toThrow(LlmCircuitOpenError);

      // Recovery window elapses
      const openedAt = breaker.snapshot().openedAt!;
      breaker.getState(openedAt + 1001);

      // First probe succeeds
      breaker.acquire();
      breaker.recordSuccess();
      expect(breaker.snapshot().state).toBe('halfOpen');

      // Second probe succeeds → breaker closes
      breaker.acquire();
      breaker.recordSuccess();
      expect(breaker.snapshot().state).toBe('closed');

      // Normal operation resumes
      breaker.acquire();
      breaker.recordSuccess();
    });
  });
});
