import { type ExtAssetKind, type ExtSurfaceProps, extAssetPath } from "@thinkrail/contracts";
import type { ComponentType } from "react";
import { getTransport } from "../transport";

export type SurfaceComponent = ComponentType<ExtSurfaceProps>;

export interface SurfaceAsset {
	name: string;
	build: string;
	surfaceId: string;
}

let runtimeReady: Promise<void> | undefined;

const ensureRuntime = () => {
	runtimeReady ??= import("./runtime").then(({ installRuntime }) => installRuntime());
	return runtimeReady;
};

export const surfaceAssetUrl = (asset: SurfaceAsset, kind: ExtAssetKind) =>
	getTransport().hostUrl(extAssetPath({ ...asset, kind }));

const isComponent = (value: unknown): value is SurfaceComponent =>
	typeof value === "function" || (typeof value === "object" && value !== null);

const modules = new Map<string, Promise<SurfaceComponent>>();

export const loadSurfaceModule = (asset: SurfaceAsset) => {
	const url = surfaceAssetUrl(asset, "js");
	let pending = modules.get(url);
	if (!pending) {
		pending = ensureRuntime()
			.then(() => import(/* @vite-ignore */ url))
			.then((module: { default?: unknown }) => {
				if (!isComponent(module.default))
					throw new Error(`${asset.surfaceId}.tsx has no default-export component`);
				return module.default;
			});
		pending.catch(() => modules.delete(url));
		modules.set(url, pending);
	}
	return pending;
};

const stylesheets = new Map<string, { link: HTMLLinkElement; users: number }>();

export const retainStylesheet = (url: string) => {
	const existing = stylesheets.get(url);
	if (existing) existing.users += 1;
	else {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = url;
		link.dataset.extStylesheet = "";
		document.head.append(link);
		stylesheets.set(url, { link, users: 1 });
	}
	return () => {
		const entry = stylesheets.get(url);
		if (!entry) return;
		entry.users -= 1;
		if (entry.users > 0) return;
		entry.link.remove();
		stylesheets.delete(url);
	};
};
