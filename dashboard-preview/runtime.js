(async () => {
  const ui = window.evidenceUi;
  try {
    const [summary, decision] = await Promise.all([
      ui.fetchJson('/api/dashboard/summary'),
      ui.fetchJson('/api/route/decide', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: {
          requiredCapabilities: ['chat', 'function-calling'], estimatedInputTokens: 1000,
          estimatedOutputTokens: 500, optimization: 'balanced',
        }, maxChainLength: 3, requireProviderDiversity: true }),
      }),
    ]);
    ui.metric('Fixture backends', summary.catalog.size, 'Seeded model registry');
    ui.metric('Sample decisions', summary.telemetry.totalDecisions, 'Seeded telemetry, no provider calls');
    ui.metric('Qualified now', decision.qualifiedCandidates, `${decision.totalCandidates} models considered`);
    ui.metric('Fallback attempts', decision.fallbackChain.totalAttempts, 'Simulation, no dispatch');
    ui.table(['Model', 'Provider', 'P95 latency', 'Status'], summary.catalog.models.map((model) => [
      model.modelId, model.provider, `${model.observedP95LatencyMs}ms`, model.preferred ? 'preferred' : 'eligible',
    ]).slice(0, 9));
    decision.fallbackChain.attempts.forEach((attempt) => ui.item(
      `${attempt.rank}. ${attempt.modelId}`, `${attempt.provider} · ${attempt.role} · estimated $${attempt.estimatedCostUsd.toFixed(4)}`,
    ));
    ui.state('LOCAL FIXTURE API · score and catalog responded');
  } catch (error) {
    ui.state(`API unavailable: ${error.message}`, true);
  }
})();
