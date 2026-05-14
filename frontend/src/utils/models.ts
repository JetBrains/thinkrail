/**
 * Centralized model registry.
 *
 * At startup the frontend fetches the live model list from the backend
 * (which owns the fallback when the Anthropic Models API is unreachable).
 * Until that list arrives `getModels()` returns an empty list; React
 * pickers should subscribe to settingsStore.models and keep their
 * selected value visible while loading. `getContextWindowSize` falls
 * through to its own 200k default.
 *
 * Context window sizes come directly from the API's `max_input_tokens`.
 */

export interface ModelDef {
  id: string;
  label: string;
  group: "current" | "legacy";
  contextWindow: number;
}

/** Runtime model list set by the settings store once the backend responds. */
let _dynamicModels: ModelDef[] | null = null;

/** Called by settingsStore when the backend model list arrives. */
export function setDynamicModels(models: ModelDef[]): void {
  _dynamicModels = models.length > 0 ? models : null;
}

/** Return the backend-supplied model list, or an empty list while we wait. */
export function getModels(): ModelDef[] {
  return _dynamicModels ?? [];
}

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

export function buildModelOptions(models: ModelDef[] = getModels()): ModelOption[] {
  return models.map((m) => ({
    key: m.id,
    modelId: m.id,
    label: m.label,
    group: m.group,
  }));
}

export function currentModelOptionKey(model: string): string {
  return model;
}
