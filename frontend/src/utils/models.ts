/** Centralized model registry — single source of truth for all Claude models. */

export interface ModelDef {
  id: string;
  label: string;
  group: "current" | "legacy";
  contextWindow: number;
  supports1M: boolean;
}

export const MODELS: ModelDef[] = [
  { id: "claude-opus-4-6",            label: "Opus 4.6",   group: "current", contextWindow: 200_000, supports1M: true },
  { id: "claude-opus-4-5-20251101",   label: "Opus 4.5",   group: "legacy",  contextWindow: 200_000, supports1M: false },
  { id: "claude-sonnet-4-6",          label: "Sonnet 4.6", group: "current", contextWindow: 200_000, supports1M: true },
  { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", group: "legacy",  contextWindow: 200_000, supports1M: true },
  { id: "claude-sonnet-4-20250514",   label: "Sonnet 4.0", group: "legacy",  contextWindow: 200_000, supports1M: true },
  { id: "claude-haiku-4-5-20251001",  label: "Haiku 4.5",  group: "current", contextWindow: 200_000, supports1M: false },
  // claude-3-haiku-20240307 (scheduled retirement Apr 2026)
  { id: "claude-3-haiku-20240307",   label: "Haiku 3.5",  group: "legacy",  contextWindow: 200_000, supports1M: false },
];

export const BETA_1M = "context-1m-2025-08-07";
export const DEFAULT_MODEL = "claude-opus-4-6";

export function getModelDef(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getContextWindowSize(model: string, use1M?: boolean): number {
  const def = getModelDef(model);
  if (use1M && def?.supports1M) return 1_000_000;
  return def?.contextWindow ?? 200_000;
}

export function displayModelLabel(model: string): string {
  return getModelDef(model)?.label ?? model;
}

export interface ModelOption {
  key: string;
  modelId: string;
  label: string;
  group: "current" | "legacy";
  betas: string[];
}

export function buildModelOptions(): ModelOption[] {
  const options: ModelOption[] = [];
  for (const m of MODELS) {
    options.push({ key: m.id, modelId: m.id, label: m.label, group: m.group, betas: [] });
    if (m.supports1M) {
      options.push({ key: `${m.id}:1m`, modelId: m.id, label: `${m.label} (1M)`, group: m.group, betas: [BETA_1M] });
    }
  }
  return options;
}

export function currentModelOptionKey(model: string, betas: string[]): string {
  if (betas.includes(BETA_1M) && getModelDef(model)?.supports1M) return `${model}:1m`;
  return model;
}
