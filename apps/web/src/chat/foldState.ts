import { useState } from "react";

const foldState = new Map<string, boolean>();

export function useFold(id: string, fallback = false): [boolean, () => void] {
	const [override, setOverride] = useState<boolean | undefined>(() => foldState.get(id));
	const expanded = override ?? fallback;
	const toggle = () => {
		const next = !expanded;
		foldState.set(id, next);
		setOverride(next);
	};
	return [expanded, toggle];
}

const selectionState = new Map<string, string | null>();

export function useSelection(id: string): [string | null, (key: string) => void] {
	const [selected, setSelected] = useState<string | null>(() => selectionState.get(id) ?? null);
	const select = (key: string) => {
		const next = selected === key ? null : key;
		selectionState.set(id, next);
		setSelected(next);
	};
	return [selected, select];
}
