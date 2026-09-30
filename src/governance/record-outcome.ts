import { findBackend } from './model-registry';
import { CircuitBreakerRegistry, type CircuitOutcome, type CircuitState } from './circuit-breaker';

export function recordKnownModelOutcome(
  breakers: CircuitBreakerRegistry,
  outcome: Omit<CircuitOutcome, 'at'>
): CircuitState | null {
  if (!findBackend(outcome.modelId)) return null;
  return breakers.recordOutcome({ ...outcome, at: Date.now() });
}
