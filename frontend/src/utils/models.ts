/**
 * Centralized model registry.
 *
 * At startup the frontend fetches the live model list from the backend
 * (which in turn queries the Anthropic Models API).  Until that list
 * arrives, FALLBACK_MODELS is used.  All public helpers read through
 * `getModels()` so consumers always see the freshest data.
 */

export interface ModelDef {
  id: string;
  label: string;
  group: "current" | "legacy";
  contextWindow: number;
  supports1M: boolean;
}

/** Hardcoded fallback used before the backend model list arrives. */
export const FALLBACK_MODELS: ModelDef[] = [
  // Current
  { id: "claude-opus-4-6",   label: "Opus 4.6",   group: "current", contextWindow: 200_000, supports1M: true },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", group: "current", contextWindow: 200_000, supports1M: true },
  { id: "claude-haiku-4-5",  label: "Haiku 4.5",  group: "current", contextWindow: 200_000, supports1M: false },
  // Legacy
  { id: "claude-opus-4-5",   label: "Opus 4.5",   group: "legacy", contextWindow: 200_000, supports1M: false },
  { id: "claude-opus-4-1",   label: "Opus 4.1",   group: "legacy", contextWindow: 200_000, supports1M: false },
  { id: "claude-opus-4-0",   label: "Opus 4",     group: "legacy", contextWindow: 200_000, supports1M: false },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", group: "legacy", contextWindow: 200_000, supports1M: true },
  { id: "claude-sonnet-4-0", label: "Sonnet 4",   group: "legacy", contextWindow: 200_000, supports1M: true },
];

/** Runtime model list set by the settings store once the backend responds. */
let _dynamicModels: ModelDef[] | null = null;

/** Called by settingsStore when the backend model list arrives. */
export function setDynamicModels(models: ModelDef[]): void {
  _dynamicModels = models.length > 0 ? models : null;
}

/** Return the best available model list (dynamic or fallback). */
export function getModels(): ModelDef[] {
  return _dynamicModels ?? FALLBACK_MODELS;
}

export const BETA_1M = "context-1m-2025-08-07";
export const DEFAULT_MODEL = "claude-opus-4-6";

export function getModelDef(id: string): ModelDef | undefined {
  return getModels().find((m) => m.id === id);
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
  for (const m of getModels()) {
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
