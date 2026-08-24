import type { WireModel } from "@thinkrail/contracts";
import { useCallback, useEffect } from "react";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

export function useModelCatalog(active = true): {
	models: WireModel[];
	refreshing: boolean;
	refresh: (force: boolean) => void;
	fresh: boolean;
} {
	const models = useAppStore((s) => s.models);
	const refreshing = useAppStore((s) => s.modelsRefreshing);
	const fresh = useAppStore((s) => s.modelsFresh);

	useEffect(() => {
		if (!active) return;
		const state = useAppStore.getState();
		state.dropModelsFreshness();
		if (state.models.length === 0) void readModels();
	}, [active]);

	const refresh = useCallback((force: boolean) => {
		if (!force) {
			void readModels();
			return;
		}
		const state = useAppStore.getState();
		if (state.modelsRefreshing) return;
		const providerVersion = state.beginModelsRefresh();
		getTransport()
			.request("model.refresh", { force: true })
			.then((r) => useAppStore.getState().finishModelsRefresh(providerVersion, r))
			.catch(() => useAppStore.getState().finishModelsRefresh(providerVersion, null));
	}, []);

	return { models, refreshing, refresh, fresh };
}

function readModels(): Promise<void> {
	const providerVersion = useAppStore.getState().providerVersion;
	return getTransport()
		.request("model.list", {})
		.then((models) => useAppStore.getState().setModelsForProviderVersion(providerVersion, models))
		.catch(() => {});
}
