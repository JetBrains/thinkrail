import type { WireModel } from "@thinkrail/contracts";
import { useCallback } from "react";
import { useAppStore } from "@/store";

/**
 * Initialize model visibility preferences from localStorage.
 * Should be called once on app startup.
 */
export function initModelVisibility(): void {
	useAppStore.getState().loadHiddenModels();
}

export interface ModelVisibility {
	/** Models that are currently hidden. */
	hiddenModels: readonly { provider: string; id: string }[];
	/** Check if a model is visible. */
	isVisible: (model: Pick<WireModel, "provider" | "id">) => boolean;
	/** Toggle visibility of a model. */
	toggleVisibility: (model: Pick<WireModel, "provider" | "id">) => void;
	/** Set visibility of a model. */
	setVisible: (model: Pick<WireModel, "provider" | "id">, visible: boolean) => void;
	/** Filter models to only visible ones. */
	filterVisible: <T extends Pick<WireModel, "provider" | "id">>(models: readonly T[]) => T[];
}

/**
 * Hook for managing model visibility preferences.
 * Hidden models are stored in localStorage (via appStore) and persist across sessions.
 * New models are visible by default.
 *
 * This hook connects to the shared Zustand store so visibility changes
 * are immediately reflected across all model pickers.
 */
export function useModelVisibility(): ModelVisibility {
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const setModelVisibility = useAppStore((s) => s.setModelVisibility);
	const toggleModelVisibility = useAppStore((s) => s.toggleModelVisibility);

	const isVisible = useCallback(
		(model: Pick<WireModel, "provider" | "id">) =>
			!hiddenModels.some((hidden) => hidden.provider === model.provider && hidden.id === model.id),
		[hiddenModels],
	);

	const toggleVisibility = useCallback(
		(model: Pick<WireModel, "provider" | "id">) => {
			toggleModelVisibility({ provider: model.provider, id: model.id });
		},
		[toggleModelVisibility],
	);

	const setVisible = useCallback(
		(model: Pick<WireModel, "provider" | "id">, visible: boolean) => {
			setModelVisibility({ provider: model.provider, id: model.id }, visible);
		},
		[setModelVisibility],
	);

	const filterVisible = useCallback(
		<T extends Pick<WireModel, "provider" | "id">>(models: readonly T[]): T[] =>
			models.filter((model) => isVisible(model)),
		[isVisible],
	);

	return {
		hiddenModels,
		isVisible,
		toggleVisibility,
		setVisible,
		filterVisible,
	};
}
