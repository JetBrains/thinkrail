import { extChannelKey, extToolId } from "@thinkrail/contracts";
import { createContext, useCallback, useContext } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { selectSurface, surfaceTitle, useExtStore } from "./extStore";
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
	return useExtStore((state) => state.channels[extChannelKey(name, key)]) as T | undefined;
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
