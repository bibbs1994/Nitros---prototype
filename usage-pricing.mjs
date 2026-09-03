// Server-side pricing configuration. Rates are USD per one million tokens.
// Source: official OpenAI GPT-5.6 Sol model page, verified 2026-09-03.
// Rates are standard Responses API rates; fast/priority and >272K-token tariffs
// intentionally remain unavailable until the request explicitly identifies them.
export const MODEL_PRICING = Object.freeze({
  'gpt-5.6-sol': Object.freeze({ input: 4, cachedInput: 0.4, output: 20, effectiveFrom: '2026-09-03', source: 'official-openai-gpt-5-6-sol-standard', standardContextOnly: true })
});

export function estimateCost({ model, inputTokens, cachedInputTokens, outputTokens, serviceTier, longContext } = {}) {
  const rate = MODEL_PRICING[String(model || '')];
  if (!rate || ![inputTokens, cachedInputTokens, outputTokens].some(Number.isFinite)) return null;
  if (![rate.input, rate.cachedInput, rate.output].some(Number.isFinite)) return null;
  if (serviceTier && !['default','standard','auto'].includes(String(serviceTier).toLowerCase())) return null;
  if (longContext === true) return null;
  const input = Math.max(0, Number(inputTokens) || 0), cached = Math.min(input, Math.max(0, Number(cachedInputTokens) || 0));
  return ((input - cached) * rate.input + cached * (rate.cachedInput ?? rate.input) + Math.max(0, Number(outputTokens) || 0) * rate.output) / 1_000_000;
}
