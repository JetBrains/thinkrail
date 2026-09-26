import {
	type ExtThemeOverlay,
	type ExtThemePreviewResult,
	type ExtViewTheme,
	extChannelKey,
	extThemeKey,
	extToolId,
} from "@thinkrail/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { channelDemand } from "./demand";
import { selectSurface, surfaceTitle, useExtStore } from "./extStore";
import { findTheme, lastThemeFailure, previewKey } from "./extThemes";
import { readActionContext } from "./hostContext";

interface SurfaceIdentity {
	name: string;
	surfaceId: string;
}

export const SurfaceContext = createContext<SurfaceIdentity | null>(null);

const useSurfaceIdentity = (hook: string) => {
	const identity = useContext(SurfaceContext);
	if (!identity) throw new Error(`${hook} must be called inside an extension surface`);
	return identity;
};

export const useChannel = <T>(key: string) => {
	const { name } = useSurfaceIdentity("useChannel");
	const channelKey = extChannelKey(name, key);
	useEffect(() => (key === "" ? undefined : channelDemand.retain(channelKey)), [key, channelKey]);
	return useExtStore((state) => state.channels[channelKey]) as T | undefined;
};

export const useAction = (id: string) => {
	const { name } = useSurfaceIdentity("useAction");
	return useCallback(
		(payload?: unknown) =>
			getTransport().request("ext.action", {
				ext: name,
				id,
				payload,
				ctx: readActionContext(),
			}),
		[id, name],
	);
};

export const openSurface = (
	name: string,
	surfaceId: string,
	params?: Record<string, string>,
	targetGroupId?: string,
) => {
	const placed = selectSurface(useExtStore.getState().extensions, name, surfaceId);
	const app = useAppStore.getState();
	const workspaceId = app.activeWorkspaceId;
	if (!placed || !workspaceId) return false;
	if (params) useExtStore.getState().setParams(name, surfaceId, params);
	const title = surfaceTitle(placed);
	if (placed.surface.slot === "tab") {
		app.enqueueLayoutIntent({
			kind: "open-extension",
			workspaceId,
			extension: name,
			surface: surfaceId,
			name: title,
			...(targetGroupId ? { targetGroupId } : {}),
		});
		return true;
	}
	if (placed.surface.slot === "panel") {
		app.enqueueLayoutIntent({
			kind: "reveal-tool",
			workspaceId,
			tool: extToolId({ name, surfaceId }),
			name: title,
		});
		return true;
	}
	return false;
};

const previewTheme = (name: string, overlay: ExtThemeOverlay | null): ExtThemePreviewResult => {
	const store = useExtStore.getState();
	if (overlay === null) {
		if (store.themePreview?.name === name) store.setThemePreview(null);
		return { ok: true };
	}
	if (typeof overlay.tokens !== "object" || overlay.tokens === null)
		return { ok: false, errors: ["tokens must be an object"] };
	store.setThemePreview({ name, overlay: { mode: overlay.mode, tokens: { ...overlay.tokens } } });
	if (useExtStore.getState().themePreview?.name === name) return { ok: true };
	const failure = lastThemeFailure();
	return {
		ok: false,
		errors: failure?.key === previewKey(name) ? failure.errors : ["preview was not applied"],
	};
};

const splitThemeKey = (key: string) => {
	const slash = key.indexOf("/");
	return slash < 0 ? null : { name: key.slice(0, slash), id: key.slice(slash + 1) };
};

export const useTheme = (): ExtViewTheme => {
	const { name } = useSurfaceIdentity("useTheme");
	const selection = useExtStore((state) => state.themeSelection);
	const available = useExtStore(
		(state) => findTheme(state.extensions, state.themeSelection) !== undefined,
	);
	const previewing = useExtStore((state) => state.themePreview?.name === name);
	return useMemo(
		() => ({
			active: available && selection ? splitThemeKey(selection) : null,
			previewing,
			select: (themeId: string | null) => {
				const store = useExtStore.getState();
				if (themeId !== null) store.selectTheme(extThemeKey({ name, id: themeId }));
				else if (store.themeSelection?.startsWith(`${name}/`)) store.selectTheme(null);
			},
			preview: (overlay: ExtThemeOverlay | null) => previewTheme(name, overlay),
		}),
		[available, selection, previewing, name],
	);
};
