import type { ThinkingLevel, WireModel } from "@thinkrail/contracts";

export interface ModelPreferences {
	/** False against a host older than the picker protocol: no favorites, recents, or metadata. */
	supported: boolean;
	/** Starred models in the user's order, re-pointed to the live catalog; vanished models are dropped. */
	favorites: WireModel[];
	/** Recently chosen models not already starred, newest first, re-pointed to the live catalog. */
	recents: WireModel[];
	defaultEffort: ThinkingLevel | undefined;
	isFavorite: (model: Pick<WireModel, "provider" | "id">) => boolean;
	toggleFavorite: (model: WireModel) => void;
	isDefault: (model: Pick<WireModel, "provider" | "id"> | null, level: ThinkingLevel) => boolean;
	setDefault: (model: WireModel, level: ThinkingLevel) => void;
}
