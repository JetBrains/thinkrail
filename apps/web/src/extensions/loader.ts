import type { WebExtension } from "@thinkrail/extension-api/web";
import { useSyncExternalStore } from "react";
import {
	removeInstalledToolRenderers,
	reserveInstalledOwner,
	setInstalledToolRenderers,
} from "../chat/toolRegistry";
import { clientErrorReport, getTransport, reportClientError } from "../transport";

export interface InstalledWebExtension {
	name: string;
	url: string;
	styles?: string | undefined;
}

export type WebExtensionLoadFailure = "import" | "export" | "styles";

export type WebExtensionLoadResult =
	| { name: string; status: "loading" }
	| { name: string; status: "loaded"; tools: string[] }
	| { name: string; status: "failed"; reason: WebExtensionLoadFailure; message: string }
	| { name: string; status: "unloaded" };

export const PRE_RENDER_WAIT_MS = 1000;

export interface Stylesheet {
	ready: Promise<void>;
	remove(): void;
}

export interface LoaderEnvironment {
	baseUrl(): string;
	importModule(url: string): Promise<unknown>;
	linkStylesheet(url: string): Stylesheet;
	report(error: unknown, reason: WebExtensionLoadFailure): void;
}

function linkStylesheet(url: string): Stylesheet {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = url;
	link.dataset.thinkrailExtension = url;
	const ready = new Promise<void>((resolve, reject) => {
		link.onload = () => resolve();
		link.onerror = () => reject(new Error("extension stylesheet failed to load"));
	});
	document.head.append(link);
	return { ready, remove: () => link.remove() };
}

export const browserLoaderEnvironment: LoaderEnvironment = {
	baseUrl: () => getTransport().httpBase(),
	importModule: (url) => import(/* @vite-ignore */ url),
	linkStylesheet,
	report: (error, reason) =>
		reportClientError(clientErrorReport("rejection", error, `extension-load:${reason}`)),
};

interface LoaderState {
	environment: LoaderEnvironment;
	stylesheets: Map<string, Stylesheet>;
	generations: Map<string, number>;
	inflight: Map<string, Promise<WebExtensionLoadResult>>;
	results: ReadonlyMap<string, WebExtensionLoadResult>;
	listeners: Set<() => void>;
}

const state: LoaderState = import.meta.hot?.data.webExtensionLoader ?? {
	environment: browserLoaderEnvironment,
	stylesheets: new Map(),
	generations: new Map(),
	inflight: new Map(),
	results: new Map(),
	listeners: new Set(),
};
if (import.meta.hot) import.meta.hot.data.webExtensionLoader = state;

export function setLoaderEnvironment(environment: LoaderEnvironment): void {
	state.environment = environment;
}

function setResult(name: string, result: WebExtensionLoadResult | undefined): void {
	const results = new Map(state.results);
	if (result) results.set(name, result);
	else results.delete(name);
	state.results = results;
	for (const listener of state.listeners) listener();
}

export function webExtensionLoads(): ReadonlyMap<string, WebExtensionLoadResult> {
	return state.results;
}

export function subscribeWebExtensionLoads(listener: () => void): () => void {
	state.listeners.add(listener);
	return () => {
		state.listeners.delete(listener);
	};
}

export function useWebExtensionLoads(): ReadonlyMap<string, WebExtensionLoadResult> {
	return useSyncExternalStore(subscribeWebExtensionLoads, webExtensionLoads, webExtensionLoads);
}

class LoadError extends Error {
	readonly reason: WebExtensionLoadFailure;

	constructor(reason: WebExtensionLoadFailure, cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.reason = reason;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function webExtensionOf(module: unknown): WebExtension | null {
	const candidate = isObject(module) ? module.default : undefined;
	if (!isObject(candidate) || typeof candidate.name !== "string") return null;
	const toolRenderers = candidate.toolRenderers;
	if (!isObject(toolRenderers)) return null;
	for (const entry of Object.values(toolRenderers)) {
		if (!isObject(entry) || typeof entry.renderer !== "function") return null;
		const options = entry.options;
		if (options === undefined) continue;
		if (!isObject(options)) return null;
		if (options.summary !== undefined && typeof options.summary !== "function") return null;
	}
	return candidate as unknown as WebExtension;
}

async function fetchExtension(
	descriptor: InstalledWebExtension,
	environment: LoaderEnvironment,
): Promise<{ extension: WebExtension; stylesheet: Stylesheet | undefined }> {
	const base = environment.baseUrl();
	const stylesheet = descriptor.styles
		? environment.linkStylesheet(new URL(descriptor.styles, base).href)
		: undefined;
	const imported = environment
		.importModule(new URL(descriptor.url, base).href)
		.catch((error: unknown) => Promise.reject(new LoadError("import", error)));
	const styled = (stylesheet?.ready ?? Promise.resolve()).catch((error: unknown) =>
		Promise.reject(new LoadError("styles", error)),
	);
	try {
		const [module] = await Promise.all([imported, styled]);
		const extension = webExtensionOf(module);
		if (!extension)
			throw new LoadError("export", new Error("default export is not a WebExtension"));
		return { extension, stylesheet };
	} catch (error) {
		stylesheet?.remove();
		throw error;
	}
}

function superseded(name: string): Promise<WebExtensionLoadResult> | WebExtensionLoadResult {
	return state.inflight.get(name) ?? state.results.get(name) ?? { name, status: "unloaded" };
}

async function runLoad(
	descriptor: InstalledWebExtension,
	generation: number,
): Promise<WebExtensionLoadResult> {
	const { name } = descriptor;
	const current = () => state.generations.get(name) === generation;
	const environment = state.environment;
	let result: WebExtensionLoadResult;
	try {
		const { extension, stylesheet } = await fetchExtension(descriptor, environment);
		if (!current()) {
			stylesheet?.remove();
			return superseded(name);
		}
		state.stylesheets.get(name)?.remove();
		if (stylesheet) state.stylesheets.set(name, stylesheet);
		else state.stylesheets.delete(name);
		setInstalledToolRenderers(name, extension.toolRenderers);
		result = { name, status: "loaded", tools: Object.keys(extension.toolRenderers) };
	} catch (error) {
		if (!current()) return superseded(name);
		const failure = error instanceof LoadError ? error : new LoadError("import", error);
		environment.report(failure.cause, failure.reason);
		state.stylesheets.get(name)?.remove();
		state.stylesheets.delete(name);
		setInstalledToolRenderers(name, {});
		result = { name, status: "failed", reason: failure.reason, message: failure.message };
	}
	setResult(name, result);
	return result;
}

function loadOne(descriptor: InstalledWebExtension): Promise<WebExtensionLoadResult> {
	const { name } = descriptor;
	const generation = (state.generations.get(name) ?? 0) + 1;
	state.generations.set(name, generation);
	reserveInstalledOwner(name);
	setResult(name, { name, status: "loading" });
	const load = runLoad(descriptor, generation);
	state.inflight.set(name, load);
	void load.finally(() => {
		if (state.inflight.get(name) === load) state.inflight.delete(name);
	});
	return load;
}

export function loadWebExtensions(
	descriptors: readonly InstalledWebExtension[],
): Promise<WebExtensionLoadResult[]> {
	return Promise.all(descriptors.map(loadOne));
}

export async function loadWebExtensionsBeforeRender(
	descriptors: readonly InstalledWebExtension[],
	waitMs: number = PRE_RENDER_WAIT_MS,
): Promise<void> {
	if (descriptors.length === 0) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, waitMs);
	});
	await Promise.race([loadWebExtensions(descriptors).then(() => undefined), deadline]);
	clearTimeout(timer);
}

export function unloadWebExtension(name: string): boolean {
	const known = state.results.has(name);
	state.generations.set(name, (state.generations.get(name) ?? 0) + 1);
	state.inflight.delete(name);
	state.stylesheets.get(name)?.remove();
	state.stylesheets.delete(name);
	const removed = removeInstalledToolRenderers(name);
	setResult(name, undefined);
	return known || removed;
}
