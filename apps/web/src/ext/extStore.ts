import {
	type ExtensionInfo,
	type ExtensionSurface,
	isOwnChannelKey,
	type SurfaceSlot,
} from "@thinkrail/contracts";
import { create } from "zustand";

type ExtHydration = "idle" | "ready" | "failed" | "unsupported";

export interface ExtState {
	hydration: ExtHydration;
	extensions: Record<string, ExtensionInfo>;
	channels: Record<string, unknown>;
	params: Record<string, Record<string, string>>;
	install: (list: readonly ExtensionInfo[], snapshot: Record<string, unknown>) => void;
	markUnsupported: () => void;
	markFailed: () => void;
	applyChanged: (info: ExtensionInfo) => void;
	applyRemoved: (name: string) => void;
	applyChannel: (key: string, value: unknown) => void;
	dropChannels: (keys: readonly string[]) => void;
	setParams: (name: string, surfaceId: string, params: Record<string, string>) => void;
}

export const surfaceKey = (name: string, surfaceId: string) => `${name}:${surfaceId}`;

const withoutKeys = <T>(record: Record<string, T>, keys: Iterable<string>) => {
	const next = { ...record };
	for (const key of keys) delete next[key];
	return next;
};

const ownedKeys = (channels: Record<string, unknown>, name: string) =>
	Object.keys(channels).filter((key) => isOwnChannelKey(name, key));

export const useExtStore = create<ExtState>((set) => ({
	hydration: "idle",
	extensions: {},
	channels: {},
	params: {},
	install: (list, snapshot) =>
		set({
			hydration: "ready",
			extensions: Object.fromEntries(list.map((info) => [info.name, info])),
			channels: { ...snapshot },
		}),
	markUnsupported: () => set({ hydration: "unsupported", extensions: {}, channels: {} }),
	markFailed: () => set({ hydration: "failed" }),
	applyChanged: (info) =>
		set((state) => ({ extensions: { ...state.extensions, [info.name]: info } })),
	applyRemoved: (name) =>
		set((state) => ({
			extensions: withoutKeys(state.extensions, [name]),
			channels: withoutKeys(state.channels, ownedKeys(state.channels, name)),
		})),
	applyChannel: (key, value) => set((state) => ({ channels: { ...state.channels, [key]: value } })),
	dropChannels: (keys) => set((state) => ({ channels: withoutKeys(state.channels, keys) })),
	setParams: (name, surfaceId, params) =>
		set((state) => ({ params: { ...state.params, [surfaceKey(name, surfaceId)]: params } })),
}));

interface PlacedSurface {
	extension: ExtensionInfo;
	surface: ExtensionSurface;
}

export const selectSurfaces = (
	extensions: Record<string, ExtensionInfo>,
	slots: readonly SurfaceSlot[],
): PlacedSurface[] =>
	Object.values(extensions)
		.filter((extension) => extension.build !== null)
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((extension) =>
			extension.surfaces
				.filter((surface) => slots.includes(surface.slot))
				.map((surface) => ({ extension, surface })),
		);

export const selectSurface = (
	extensions: Record<string, ExtensionInfo>,
	name: string,
	surfaceId: string,
) => {
	const extension = extensions[name];
	const surface = extension?.surfaces.find((candidate) => candidate.id === surfaceId);
	return extension && surface ? { extension, surface } : null;
};

export const surfaceTitle = ({ extension, surface }: PlacedSurface) =>
	surface.title ?? `${extension.title} ${surface.id}`;
