import { useSyncExternalStore } from "react";

const NONE: readonly string[] = [];
const listeners = new Set<() => void>();
let byProject: Readonly<Record<string, readonly string[]>> = {};

export const setBlockedExtensions = (next: Readonly<Record<string, readonly string[]>>) => {
	byProject = next;
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const useBlockedExtensions = (projectId: string) =>
	useSyncExternalStore(subscribe, () => byProject[projectId] ?? NONE);
