// Model backend registry. Each entry describes a provider+model+region
// triple as seen by the router: capability tags, cost (per 1M tokens),
// observed p95 latency, max context, and preferred status.

export type Capability =
  | 'chat'
  | 'reasoning'
  | 'vision'
  | 'agent'
  | 'embedding'
  | 'voice'
  | 'image-gen'
  | 'function-calling'
  | 'long-context'
  | 'code';

export type Tier = 'frontier' | 'mainstream' | 'small' | 'embedding';

export interface ModelBackend {
  modelId: string;
  provider: string;
  displayName: string;
  region: string;
  tier: Tier;
  capabilities: Capability[];
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  observedP95LatencyMs: number;
  maxContextTokens: number;
  qualityScore: number; // 0-100, calibrated against eval suite
  weight: number; // load-balancing weight (default 1)
  preferred: boolean;
}

export const MODEL_REGISTRY: ModelBackend[] = [
  // Frontier
  { modelId: 'claude-opus-4.7', provider: 'Anthropic', displayName: 'Claude Opus 4.7', region: 'us-east', tier: 'frontier', capabilities: ['chat', 'reasoning', 'vision', 'agent', 'function-calling', 'long-context', 'code'], inputUsdPer1M: 15, outputUsdPer1M: 75, observedP95LatencyMs: 2400, maxContextTokens: 200000, qualityScore: 96, weight: 1, preferred: true },
  { modelId: 'gpt-5', provider: 'OpenAI', displayName: 'GPT-5', region: 'us-east', tier: 'frontier', capabilities: ['chat', 'reasoning', 'vision', 'agent', 'function-calling', 'long-context', 'code'], inputUsdPer1M: 12, outputUsdPer1M: 48, observedP95LatencyMs: 2100, maxContextTokens: 256000, qualityScore: 94, weight: 1, preferred: true },
  { modelId: 'gemini-2.5-pro', provider: 'Google', displayName: 'Gemini 2.5 Pro', region: 'us-central', tier: 'frontier', capabilities: ['chat', 'reasoning', 'vision', 'agent', 'function-calling', 'long-context'], inputUsdPer1M: 7, outputUsdPer1M: 28, observedP95LatencyMs: 1800, maxContextTokens: 1000000, qualityScore: 92, weight: 1, preferred: false },

  // Mainstream
  { modelId: 'claude-sonnet-4.6', provider: 'Anthropic', displayName: 'Claude Sonnet 4.6', region: 'us-east', tier: 'mainstream', capabilities: ['chat', 'reasoning', 'vision', 'function-calling', 'long-context', 'code'], inputUsdPer1M: 3, outputUsdPer1M: 15, observedP95LatencyMs: 1400, maxContextTokens: 200000, qualityScore: 88, weight: 2, preferred: true },
  { modelId: 'gpt-5-mini', provider: 'OpenAI', displayName: 'GPT-5 Mini', region: 'us-east', tier: 'mainstream', capabilities: ['chat', 'reasoning', 'function-calling'], inputUsdPer1M: 2.5, outputUsdPer1M: 10, observedP95LatencyMs: 1100, maxContextTokens: 128000, qualityScore: 84, weight: 2, preferred: true },
  { modelId: 'gemini-2.5-flash', provider: 'Google', displayName: 'Gemini 2.5 Flash', region: 'us-central', tier: 'mainstream', capabilities: ['chat', 'vision', 'long-context'], inputUsdPer1M: 0.3, outputUsdPer1M: 2.5, observedP95LatencyMs: 700, maxContextTokens: 1000000, qualityScore: 80, weight: 2, preferred: false },

  // Small / cheap
  { modelId: 'claude-haiku-4.5', provider: 'Anthropic', displayName: 'Claude Haiku 4.5', region: 'us-east', tier: 'small', capabilities: ['chat', 'vision', 'function-calling'], inputUsdPer1M: 0.8, outputUsdPer1M: 4, observedP95LatencyMs: 600, maxContextTokens: 200000, qualityScore: 76, weight: 3, preferred: true },
  { modelId: 'gpt-4o-mini', provider: 'OpenAI', displayName: 'GPT-4o Mini', region: 'us-east', tier: 'small', capabilities: ['chat', 'vision', 'function-calling'], inputUsdPer1M: 0.15, outputUsdPer1M: 0.6, observedP95LatencyMs: 500, maxContextTokens: 128000, qualityScore: 70, weight: 3, preferred: false },

  // Inference hosts (cheap, OSS)
  { modelId: 'groq-llama-3.3-70b', provider: 'Groq', displayName: 'Llama 3.3 70B (Groq)', region: 'us-west', tier: 'mainstream', capabilities: ['chat'], inputUsdPer1M: 0.59, outputUsdPer1M: 0.79, observedP95LatencyMs: 280, maxContextTokens: 128000, qualityScore: 78, weight: 2, preferred: false },
  { modelId: 'fireworks-deepseek-v3', provider: 'Fireworks', displayName: 'DeepSeek V3 (Fireworks)', region: 'us-west', tier: 'mainstream', capabilities: ['chat', 'reasoning', 'code'], inputUsdPer1M: 0.9, outputUsdPer1M: 0.9, observedP95LatencyMs: 1200, maxContextTokens: 128000, qualityScore: 82, weight: 1, preferred: false },

  // Embedding
  { modelId: 'text-embedding-3-large', provider: 'OpenAI', displayName: 'OpenAI Embedding 3 Large', region: 'us-east', tier: 'embedding', capabilities: ['embedding'], inputUsdPer1M: 0.13, outputUsdPer1M: 0, observedP95LatencyMs: 220, maxContextTokens: 8192, qualityScore: 90, weight: 3, preferred: true },
  { modelId: 'cohere-embed-v4', provider: 'Cohere', displayName: 'Cohere Embed v4', region: 'us-east', tier: 'embedding', capabilities: ['embedding'], inputUsdPer1M: 0.10, outputUsdPer1M: 0, observedP95LatencyMs: 250, maxContextTokens: 4096, qualityScore: 88, weight: 2, preferred: false },
];

export function findBackend(modelId: string): ModelBackend | undefined {
  return MODEL_REGISTRY.find((m) => m.modelId === modelId);
}
