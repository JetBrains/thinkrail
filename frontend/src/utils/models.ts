/**
 * Frontend model registry. The settings store seeds it via
 * `setDynamicModels` once the `models/list` RPC returns. Until then
 * `getModels()` is empty; React pickers should subscribe to
 * `settingsStore.models` and keep their selected value visible while
 * the list is loading. `getContextWindowSize` falls through to a 200k
 * default for ids the registry doesn't know.
 */

export interface ModelDef {
  id: string;
  label: string;
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
}

export function buildModelOptions(models: ModelDef[] = getModels()): ModelOption[] {
  return models.map((m) => ({
    key: m.id,
    modelId: m.id,
    label: m.label,
  }));
}

export function currentModelOptionKey(model: string): string {
  return model;
}
