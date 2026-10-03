import { sameModel, type ThinkingLevel, type WireModel } from "@thinkrail/contracts";
import { useCallback, useMemo } from "react";
import { selectCatalogModel, selectSupportsModelPicker, toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

export interface ModelPreferences {
	/** False against a host older than the picker protocol: no favorites, recents, or metadata. */
	supported: boolean;
	/** Starred models in the user's order, re-pointed to the live catalog; vanished models are dropped. */
	favorites: WireModel[];
	/** Recently chosen models not already starred, newest first, re-pointed to the live catalog. */
	recents: WireModel[];
	defaultModel: WireModel | null;
	defaultEffort: ThinkingLevel | undefined;
	isFavorite: (model: Pick<WireModel, "provider" | "id">) => boolean;
	toggleFavorite: (model: WireModel) => void;
	isDefault: (model: Pick<WireModel, "provider" | "id"> | null, level: ThinkingLevel) => boolean;
	setDefault: (model: WireModel, level: ThinkingLevel) => void;
}

export function resolveAgainstCatalog(
	models: readonly WireModel[],
	refs: readonly Pick<WireModel, "provider" | "id">[],
): WireModel[] {
	return refs.flatMap((ref) => {
		const live = selectCatalogModel(models, ref);
		return live ? [live] : [];
	});
}

export function useModelPreferences(models: readonly WireModel[]): ModelPreferences {
	const supported = useAppStore(selectSupportsModelPicker);
	const favoriteModels = useAppStore((s) => s.favoriteModels);
	const recentModels = useAppStore((s) => s.recentModels);
	const defaultModelRef = useAppStore((s) => s.defaultModel);
	const defaultEffort = useAppStore((s) => s.defaultEffort);

	const favorites = useMemo(
		() => (supported ? resolveAgainstCatalog(models, favoriteModels) : []),
		[supported, models, favoriteModels],
	);
	const recents = useMemo(
		() =>
			supported
				? resolveAgainstCatalog(
						models,
						recentModels.filter((recent) => !favoriteModels.some((f) => sameModel(f, recent))),
					)
				: [],
		[supported, models, recentModels, favoriteModels],
	);
	const defaultModel = useMemo(
		() => selectCatalogModel(models, defaultModelRef ?? null),
		[models, defaultModelRef],
	);

	const isFavorite = useCallback(
		(model: Pick<WireModel, "provider" | "id">) => favoriteModels.some((f) => sameModel(f, model)),
		[favoriteModels],
	);

	const toggleFavorite = useCallback((model: WireModel) => {
		const current = useAppStore.getState().favoriteModels;
		const next = current.some((f) => sameModel(f, model))
			? current.filter((f) => !sameModel(f, model))
			: [...current, model];
		getTransport()
			.request("settings.update", { config: { favoriteModels: next } })
			.catch(() => toast.error("Couldn't update favorite models"));
	}, []);

	const isDefault = useCallback(
		(model: Pick<WireModel, "provider" | "id"> | null, level: ThinkingLevel) =>
			sameModel(defaultModelRef, model) && defaultEffort === level,
		[defaultModelRef, defaultEffort],
	);

	const setDefault = useCallback((model: WireModel, level: ThinkingLevel) => {
		getTransport()
			.request("settings.update", { config: { defaultModel: model, defaultEffort: level } })
			.catch(() => toast.error("Couldn't save the default model"));
	}, []);

	return {
		supported,
		favorites,
		recents,
		defaultModel,
		defaultEffort,
		isFavorite,
		toggleFavorite,
		isDefault,
		setDefault,
	};
}
