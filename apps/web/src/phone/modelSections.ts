import { groupByProvider, type ProviderGroup } from "@thinkrail/chat-ui/modelPicker";
import { modelKeywords, rowValue, searchScore } from "@thinkrail/chat-ui/pickerGroups";
import type { WireModel } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";

/** Below this many models the sheet needs no search field — the list fits a phone screen or two. */
export const SEARCH_THRESHOLD = 8;

/**
 * The phone model sheet's list: the IDE picker's provider groups narrowed by its search, with the current model's
 * provider first so the selection is on screen when the sheet opens.
 */
export function modelSections(
	t: Translator,
	models: readonly WireModel[],
	current: WireModel | null,
	query: string,
): ProviderGroup[] {
	const search = query.trim();
	const matches = (model: WireModel): boolean =>
		search === "" || searchScore(rowValue("all", model), search, modelKeywords(model)) > 0;
	const sections = groupByProvider(t, models).flatMap((group) => {
		const shown = group.models.filter(matches);
		return shown.length > 0 ? [{ ...group, models: shown }] : [];
	});
	const first = current
		? sections.findIndex((section) => section.provider === current.provider)
		: -1;
	if (first <= 0) return sections;
	const [section] = sections.splice(first, 1);
	return section ? [section, ...sections] : sections;
}
