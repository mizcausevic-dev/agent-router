// Circuit breaker for LLM backends. Tracks rolling failure rate per
// backend and opens the circuit when the threshold is exceeded. Prevents
// the router from selecting backends that are currently failing.

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitConfig {
  failureThreshold: number; // failures within window to trip the breaker
  windowSizeMs: number;
  cooldownMs: number;
  halfOpenSampleCount: number; // successful samples needed to close again
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  windowSizeMs: 60_000,
  cooldownMs: 30_000,
  halfOpenSampleCount: 3,
};

export interface CircuitOutcome {
  modelId: string;
  ok: boolean;
  latencyMs?: number;
  errorCode?: string;
  at: number; // epoch ms
}

interface CircuitBreakerState {
  modelId: string;
  state: CircuitState;
  failures: CircuitOutcome[];
  successes: CircuitOutcome[];
  openedAt: number | null;
  config: CircuitConfig;
}

export class CircuitBreakerRegistry {
  private store = new Map<string, CircuitBreakerState>();
  private defaultConfig: CircuitConfig;

  constructor(defaultConfig: CircuitConfig = DEFAULT_CIRCUIT_CONFIG) {
    this.defaultConfig = defaultConfig;
  }

  getState(modelId: string, now: number = Date.now()): CircuitState {
    const s = this.store.get(modelId);
    if (!s) return 'closed';
    this.evaluate(s, now);
    return s.state;
  }

  isAvailable(modelId: string, now: number = Date.now()): boolean {
    const state = this.getState(modelId, now);
    return state !== 'open';
  }

  recordOutcome(outcome: CircuitOutcome, configOverride?: Partial<CircuitConfig>): CircuitState {
    const cfg = { ...this.defaultConfig, ...(configOverride ?? {}) };
    let s = this.store.get(outcome.modelId);
    if (!s) {
      s = {
        modelId: outcome.modelId,
        state: 'closed',
        failures: [],
        successes: [],
        openedAt: null,
        config: cfg,
      };
      this.store.set(outcome.modelId, s);
    } else {
      // Update config if explicit override provided
      if (configOverride) s.config = { ...s.config, ...configOverride };
    }

    if (outcome.ok) {
      s.successes.push(outcome);
    } else {
      s.failures.push(outcome);
    }

    this.evaluate(s, outcome.at);
    return s.state;
  }

  // Snapshot for telemetry / dashboard
  snapshot(now: number = Date.now()): Array<{
    modelId: string;
    state: CircuitState;
    failureCount: number;
    successCount: number;
    failureRate: number;
    msSinceOpened: number | null;
  }> {
    const out: ReturnType<CircuitBreakerRegistry['snapshot']> = [];
    for (const s of this.store.values()) {
      this.evaluate(s, now);
      const total = s.failures.length + s.successes.length;
      const failureRate = total === 0 ? 0 : Math.round((s.failures.length / total) * 1000) / 10;
      out.push({
        modelId: s.modelId,
        state: s.state,
        failureCount: s.failures.length,
        successCount: s.successes.length,
        failureRate,
        msSinceOpened: s.openedAt === null ? null : now - s.openedAt,
      });
    }
    return out;
  }

  reset(modelId: string): void {
    this.store.delete(modelId);
  }

  private evaluate(s: CircuitBreakerState, now: number): void {
    // Drop outcomes outside the rolling window
    const windowStart = now - s.config.windowSizeMs;
    s.failures = s.failures.filter((f) => f.at >= windowStart);
    s.successes = s.successes.filter((f) => f.at >= windowStart);

    if (s.state === 'open') {
      // Check if cooldown has elapsed → transition to half-open
      if (s.openedAt !== null && now - s.openedAt >= s.config.cooldownMs) {
        s.state = 'half-open';
        // Keep only outcomes recorded AFTER cooldown elapsed; those are
        // valid half-open samples. Drop the pre-trip failures.
        const transitionTime = s.openedAt + s.config.cooldownMs;
        s.failures = s.failures.filter((f) => f.at >= transitionTime);
        s.successes = s.successes.filter((sx) => sx.at >= transitionTime);
        // Fall through to half-open logic below
      } else {
        return;
      }
    }

    if (s.state === 'half-open') {
      // Any failure in half-open re-opens the circuit
      if (s.failures.length > 0) {
        s.state = 'open';
        s.openedAt = now;
        return;
      }
      // Enough successful samples → fully close
      if (s.successes.length >= s.config.halfOpenSampleCount) {
        s.state = 'closed';
        s.openedAt = null;
      }
      return;
    }

    // Closed → check if breaker should trip
    if (s.failures.length >= s.config.failureThreshold) {
      s.state = 'open';
      s.openedAt = now;
    }
  }
}
