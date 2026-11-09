import type { WireModel } from "@thinkrail/contracts";

export interface ModelSection {
	provider: string;
	models: WireModel[];
}

/** Below this many models the sheet needs no search field — the list fits a phone screen or two. */
export const SEARCH_THRESHOLD = 8;

/**
 * The phone model sheet's list: models grouped by provider in the host's order, the current model's provider
 * first so the selection is on screen when the sheet opens, narrowed by a case-insensitive query over name,
 * id and provider.
 */
export function modelSections(
	models: readonly WireModel[],
	current: WireModel | null,
	query: string,
): ModelSection[] {
	const needle = query.trim().toLowerCase();
	const matches = (model: WireModel): boolean =>
		needle === "" ||
		[model.name, model.id, model.provider].some((field) => field.toLowerCase().includes(needle));
	const byProvider = new Map<string, WireModel[]>();
	for (const model of models) {
		if (!matches(model)) continue;
		const list = byProvider.get(model.provider);
		if (list) list.push(model);
		else byProvider.set(model.provider, [model]);
	}
	const sections = [...byProvider].map(([provider, list]) => ({ provider, models: list }));
	const first = current
		? sections.findIndex((section) => section.provider === current.provider)
		: -1;
	if (first > 0) {
		const [section] = sections.splice(first, 1);
		if (section) sections.unshift(section);
	}
	return sections;
}
