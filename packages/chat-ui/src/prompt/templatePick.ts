import type { Template } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ParsedTemplate } from "./slotSession";
import { parseTemplateSlots } from "./slotSession";
import { stripFrontmatter } from "./templateText";

export function shouldApplyTemplatePick(pick: {
	generation: number;
	latestGeneration: number;
	draftAtPick: string;
	currentDraft: string;
	contextAtPick: string;
	currentContext: string;
}): boolean {
	return (
		pick.generation === pick.latestGeneration &&
		pick.draftAtPick === pick.currentDraft &&
		pick.contextAtPick === pick.currentContext
	);
}

export interface TemplateCommandPicker {
	pick: (name: string) => Promise<void>;
	pending: boolean;
}

export function useTemplateCommandPicker({
	draft,
	contextKey,
	load,
	onApply,
}: {
	draft: string;
	contextKey: string;
	load: (name: string) => Promise<Template>;
	onApply: (template: ParsedTemplate) => void;
}): TemplateCommandPicker {
	const draftRef = useRef(draft);
	const contextRef = useRef(contextKey);
	const appliedContextRef = useRef(contextKey);
	const loadRef = useRef(load);
	const onApplyRef = useRef(onApply);
	const generationRef = useRef(0);
	const pendingRef = useRef<Promise<void> | null>(null);
	const [pending, setPending] = useState(false);
	draftRef.current = draft;
	contextRef.current = contextKey;
	loadRef.current = load;
	onApplyRef.current = onApply;

	useEffect(() => {
		if (appliedContextRef.current === contextKey) return;
		appliedContextRef.current = contextKey;
		generationRef.current += 1;
		pendingRef.current = null;
		setPending(false);
	}, [contextKey]);

	const pick = useCallback((name: string) => {
		const generation = ++generationRef.current;
		const draftAtPick = draftRef.current;
		const contextAtPick = contextRef.current;
		const task = loadRef
			.current(name)
			.then((template) => {
				if (
					!shouldApplyTemplatePick({
						generation,
						latestGeneration: generationRef.current,
						draftAtPick,
						currentDraft: draftRef.current,
						contextAtPick,
						currentContext: contextRef.current,
					})
				) {
					return;
				}
				onApplyRef.current(
					parseTemplateSlots(stripFrontmatter(template.content), template.argumentHint),
				);
			})
			.catch(() => {});
		pendingRef.current = task;
		setPending(true);
		void task.then(() => {
			if (pendingRef.current !== task) return;
			pendingRef.current = null;
			setPending(false);
		});
		return task;
	}, []);
	return { pending, pick };
}
