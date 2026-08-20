export function shouldApplyTemplatePick(pick: {
	generation: number;
	latestGeneration: number;
	draftAtPick: string;
	currentDraft: string;
}): boolean {
	return pick.generation === pick.latestGeneration && pick.draftAtPick === pick.currentDraft;
}
