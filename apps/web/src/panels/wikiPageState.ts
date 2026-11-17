import { create } from "zustand";
import { STORAGE_PREFIX } from "@/constants/branding";

const BUILD_PREFERENCE_KEY = `${STORAGE_PREFIX}wiki-build`;

export interface WikiBuildPreference {
	model: { provider: string; id: string } | null;
	codeOnly: boolean;
}

const DEFAULT_BUILD_PREFERENCE: WikiBuildPreference = { model: null, codeOnly: true };

export function readBuildPreference(): WikiBuildPreference {
	try {
		const raw = globalThis.localStorage?.getItem(BUILD_PREFERENCE_KEY);
		if (!raw) return DEFAULT_BUILD_PREFERENCE;
		const parsed = JSON.parse(raw) as Partial<WikiBuildPreference> | null;
		const model = parsed?.model;
		return {
			model:
				model && typeof model.provider === "string" && typeof model.id === "string"
					? { provider: model.provider, id: model.id }
					: null,
			codeOnly: parsed?.codeOnly !== false,
		};
	} catch {
		return DEFAULT_BUILD_PREFERENCE;
	}
}

export function writeBuildPreference(preference: WikiBuildPreference): void {
	try {
		globalThis.localStorage?.setItem(BUILD_PREFERENCE_KEY, JSON.stringify(preference));
	} catch {}
}

interface WikiPageState {
	/** The workspace whose wiki page is showing; the page covers that workspace's workbench. */
	openFor: string | null;
	open: (workspaceId: string) => void;
	close: () => void;
	toggle: (workspaceId: string) => void;
}

export const useWikiPageState = create<WikiPageState>((set) => ({
	openFor: null,
	open: (workspaceId) => set({ openFor: workspaceId }),
	close: () => set({ openFor: null }),
	toggle: (workspaceId) =>
		set((state) => ({ openFor: state.openFor === workspaceId ? null : workspaceId })),
}));
