// Server-side pricing configuration. Rates are USD per one million tokens.
// Null is deliberate: an unlisted model must never receive an invented cost.
export const MODEL_PRICING = Object.freeze({
  'gpt-5.6-sol': Object.freeze({ input: null, cachedInput: null, output: null, effectiveFrom: 'unconfigured' })
});

export function estimateCost({ model, inputTokens, cachedInputTokens, outputTokens } = {}) {
  const rate = MODEL_PRICING[String(model || '')];
  if (!rate || ![inputTokens, cachedInputTokens, outputTokens].some(Number.isFinite)) return null;
  if (![rate.input, rate.cachedInput, rate.output].some(Number.isFinite)) return null;
  const input = Math.max(0, Number(inputTokens) || 0), cached = Math.min(input, Math.max(0, Number(cachedInputTokens) || 0));
  return ((input - cached) * rate.input + cached * (rate.cachedInput ?? rate.input) + Math.max(0, Number(outputTokens) || 0) * rate.output) / 1_000_000;
}
