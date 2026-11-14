export function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

export function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

export function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive. Legacy Claude rows may have
  // stored prompt cache-exclusive; fall back to cache when it's larger so old
  // rows don't under-report input.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

export function getOutputTokens(tokens) {
  const completion = tokens?.completion_tokens || tokens?.output_tokens || 0;
  // Nested reasoning is already included in completion_tokens. Flat reasoning
  // comes from Gemini and must be added because candidatesTokenCount excludes it.
  if (tokens?.completion_tokens_details?.reasoning_tokens !== undefined) return completion;
  return completion + (tokens?.reasoning_tokens || 0);
}
