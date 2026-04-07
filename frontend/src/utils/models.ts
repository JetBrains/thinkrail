/**
 * Centralized model registry.
 *
 * At startup the frontend fetches the live model list from the backend
 * (which in turn queries the Anthropic Models API).  Until that list
 * arrives, FALLBACK_MODELS is used.  All public helpers read through
 * `getModels()` so consumers always see the freshest data.
 *
 * Context window sizes come directly from the API's `max_input_tokens`.
 */

export interface ModelDef {
  id: string;
  label: string;
  group: "current" | "legacy";
  contextWindow: number;
}

/** Hardcoded fallback used before the backend model list arrives. */
export const FALLBACK_MODELS: ModelDef[] = [
  // Current
  { id: "claude-opus-4-6",   label: "Opus 4.6",   group: "current", contextWindow: 1_000_000 },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", group: "current", contextWindow: 1_000_000 },
  { id: "claude-haiku-4-5",  label: "Haiku 4.5",  group: "current", contextWindow: 200_000 },
  // Legacy
  { id: "claude-opus-4-5",   label: "Opus 4.5",   group: "legacy", contextWindow: 200_000 },
  { id: "claude-opus-4-1",   label: "Opus 4.1",   group: "legacy", contextWindow: 200_000 },
  { id: "claude-opus-4-0",   label: "Opus 4",     group: "legacy", contextWindow: 200_000 },
  { id: "claude-sonnet-4-5", label: "Sonnet 4.5", group: "legacy", contextWindow: 1_000_000 },
  { id: "claude-sonnet-4-0", label: "Sonnet 4",   group: "legacy", contextWindow: 1_000_000 },
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

export const DEFAULT_MODEL = "claude-opus-4-6";

export function getModelDef(id: string): ModelDef | undefined {
  return getModels().find((m) => m.id === id);
}

export function getContextWindowSize(model: string): number {
  return getModelDef(model)?.contextWindow ?? 200_000;
}

export function displayModelLabel(model: string): string {
  return getModelDef(model)?.label ?? model;
}

export interface ModelOption {
  key: string;
  modelId: string;
  label: string;
  group: "current" | "legacy";
}

export function buildModelOptions(): ModelOption[] {
  return getModels().map((m) => ({
    key: m.id,
    modelId: m.id,
    label: m.label,
    group: m.group,
  }));
}

export function currentModelOptionKey(model: string): string {
  return model;
}
