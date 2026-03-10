const MODEL_CONTEXT_SIZES: Record<string, number> = {
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5": 200_000,
};

export function getContextWindowSize(model: string): number {
  for (const [prefix, size] of Object.entries(MODEL_CONTEXT_SIZES))
    if (model.startsWith(prefix)) return size;
  return 200_000;
}
