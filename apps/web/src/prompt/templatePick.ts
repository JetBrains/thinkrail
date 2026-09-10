import type { Template } from "@thinkrail/contracts";
import { useCallback, useRef } from "react";
import type { ParsedTemplate } from "./slotSession";
import { parseTemplateSlots } from "./slotSession";
import { stripFrontmatter } from "./templateText";

export function shouldApplyTemplatePick(pick: {
	generation: number;
	latestGeneration: number;
	draftAtPick: string;
	currentDraft: string;
}): boolean {
	return pick.generation === pick.latestGeneration && pick.draftAtPick === pick.currentDraft;
}

export function useTemplateCommandPicker({
	draft,
	load,
	onApply,
}: {
	draft: string;
	load: (name: string) => Promise<Template>;
	onApply: (template: ParsedTemplate) => void;
}): (name: string) => void {
	const draftRef = useRef(draft);
	const loadRef = useRef(load);
	const onApplyRef = useRef(onApply);
	const generationRef = useRef(0);
	draftRef.current = draft;
	loadRef.current = load;
	onApplyRef.current = onApply;

	return useCallback((name: string) => {
		const generation = ++generationRef.current;
		const draftAtPick = draftRef.current;
		void loadRef
			.current(name)
			.then((template) => {
				if (
					!shouldApplyTemplatePick({
						generation,
						latestGeneration: generationRef.current,
						draftAtPick,
						currentDraft: draftRef.current,
					})
				) {
					return;
				}
				onApplyRef.current(
					parseTemplateSlots(stripFrontmatter(template.content), template.argumentHint),
				);
			})
			.catch(() => {});
	}, []);
}
