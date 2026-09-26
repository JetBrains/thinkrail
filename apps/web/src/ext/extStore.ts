import {
	blockedExtensionKey,
	type ExtensionInfo,
	type ExtensionSurface,
	type ExtRemovedPush,
	type ExtThemeOverlay,
	extensionKey,
	isOwnChannelKey,
	removedExtensionKey,
	type SurfaceSlot,
} from "@thinkrail/contracts";
import { create } from "zustand";
import { readThemeOverlayHint } from "../themes";

type ExtHydration = "idle" | "ready" | "failed" | "unsupported";

export interface ThemePreview {
	name: string;
	overlay: ExtThemeOverlay;
}

export interface ExtState {
	hydration: ExtHydration;
	extensions: Record<string, ExtensionInfo>;
	channels: Record<string, unknown>;
	params: Record<string, Record<string, string>>;
	themeSelection: string | null;
	themePreview: ThemePreview | null;
	install: (list: readonly ExtensionInfo[], snapshot: Record<string, unknown>) => void;
	markUnsupported: () => void;
	markFailed: () => void;
	applyChanged: (info: ExtensionInfo) => void;
	applyRemoved: (removed: ExtRemovedPush) => void;
	applyChannel: (key: string, value: unknown) => void;
	dropChannels: (keys: readonly string[]) => void;
	setParams: (name: string, surfaceId: string, params: Record<string, string>) => void;
	selectTheme: (key: string | null) => void;
	setThemePreview: (preview: ThemePreview | null) => void;
}

export const surfaceKey = (name: string, surfaceId: string) => `${name}:${surfaceId}`;

const withoutKeys = <T>(record: Record<string, T>, keys: Iterable<string>) => {
	const next = { ...record };
	for (const key of keys) delete next[key];
	return next;
};

const ownedKeys = (channels: Record<string, unknown>, name: string) =>
	Object.keys(channels).filter((key) => isOwnChannelKey(name, key));

const previewSurvives = (
	preview: ThemePreview | null,
	before: Record<string, ExtensionInfo>,
	after: Record<string, ExtensionInfo>,
) => {
	if (!preview) return null;
	const previous = before[preview.name];
	const next = after[preview.name];
	return next && next.status !== "blocked" && next.generation === previous?.generation
		? preview
		: null;
};

export const useExtStore = create<ExtState>((set) => ({
	hydration: "idle",
	extensions: {},
	channels: {},
	params: {},
	themeSelection: readThemeOverlayHint().selected,
	themePreview: null,
	install: (list, snapshot) =>
		set((state) => {
			const extensions = Object.fromEntries(list.map((info) => [extensionKey(info), info]));
			return {
				hydration: "ready",
				extensions,
				channels: { ...snapshot },
				themePreview: previewSurvives(state.themePreview, state.extensions, extensions),
			};
		}),
	markUnsupported: () =>
		set({ hydration: "unsupported", extensions: {}, channels: {}, themePreview: null }),
	markFailed: () => set({ hydration: "failed" }),
	applyChanged: (info) =>
		set((state) => {
			const extensions = { ...state.extensions, [extensionKey(info)]: info };
			return {
				extensions,
				themePreview: previewSurvives(state.themePreview, state.extensions, extensions),
			};
		}),
	applyRemoved: (removed) =>
		set((state) => {
			const extensions = withoutKeys(state.extensions, [removedExtensionKey(removed)]);
			return {
				extensions,
				channels:
					removed.blockedProjectId === undefined
						? withoutKeys(state.channels, ownedKeys(state.channels, removed.name))
						: state.channels,
				themePreview: previewSurvives(state.themePreview, state.extensions, extensions),
			};
		}),
	applyChannel: (key, value) => set((state) => ({ channels: { ...state.channels, [key]: value } })),
	dropChannels: (keys) => set((state) => ({ channels: withoutKeys(state.channels, keys) })),
	setParams: (name, surfaceId, params) =>
		set((state) => ({ params: { ...state.params, [surfaceKey(name, surfaceId)]: params } })),
	selectTheme: (key) => set({ themeSelection: key }),
	setThemePreview: (preview) => set({ themePreview: preview }),
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

export const selectBlocked = (extensions: Record<string, ExtensionInfo>, projectId: string) =>
	Object.values(extensions)
		.filter((extension) => extension.status === "blocked" && extension.projectId === projectId)
		.sort((a, b) => a.name.localeCompare(b.name));

export const blockedTitlesByProject = (extensions: Record<string, ExtensionInfo>) => {
	const projects = new Set(
		Object.values(extensions).flatMap((extension) =>
			extension.status === "blocked" && extension.projectId !== undefined
				? [extension.projectId]
				: [],
		),
	);
	return Object.fromEntries(
		[...projects].map((projectId) => [
			projectId,
			selectBlocked(extensions, projectId).map((extension) => extension.title),
		]),
	);
};

export const selectExtension = (
	extensions: Record<string, ExtensionInfo>,
	name: string,
	projectId: string | undefined,
) =>
	extensions[name] ??
	(projectId === undefined ? undefined : extensions[blockedExtensionKey(projectId, name)]);

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
