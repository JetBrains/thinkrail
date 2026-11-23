import type {
	ToolRegistrationOptions,
	ToolRenderer,
	WebExtension,
} from "@thinkrail/extension-api/web";
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
	shadowed?: readonly string[] | undefined;
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
	synced: Map<string, string>;
}

const state: LoaderState = import.meta.hot?.data.webExtensionLoader ?? {
	environment: browserLoaderEnvironment,
	stylesheets: new Map(),
	generations: new Map(),
	inflight: new Map(),
	results: new Map(),
	listeners: new Set(),
	synced: new Map(),
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

const REACT_COMPONENT_OBJECTS = new Set([
	Symbol.for("react.memo"),
	Symbol.for("react.forward_ref"),
	Symbol.for("react.lazy"),
]);

function isComponentType(value: unknown): boolean {
	if (typeof value === "function") return true;
	const kind = isObject(value) ? value.$$typeof : undefined;
	return typeof kind === "symbol" && REACT_COMPONENT_OBJECTS.has(kind);
}

type InstalledWebHalf = WebExtension & {
	toolRenderers: NonNullable<WebExtension["toolRenderers"]>;
};

const isFunction = (value: unknown) => typeof value === "function";
const isBoolean = (value: unknown) => typeof value === "boolean";
const oneOf =
	(...allowed: string[]) =>
	(value: unknown) =>
		typeof value === "string" && allowed.includes(value);

const REGISTRATION_OPTIONS: Record<keyof ToolRegistrationOptions, (value: unknown) => boolean> = {
	summary: isFunction,
	chrome: oneOf("card", "bare"),
	prominence: oneOf("routine", "primary"),
	width: oneOf("column", "content"),
	defaultExpanded: isBoolean,
	interactive: isBoolean,
	dock: isBoolean,
	composerSuggestions: isFunction,
};

function registrationOptionsOf(value: unknown): ToolRegistrationOptions | null {
	if (value === undefined) return {};
	if (!isObject(value)) return null;
	const options: Record<string, unknown> = {};
	for (const [key, accepts] of Object.entries(REGISTRATION_OPTIONS)) {
		const option = value[key];
		if (option === undefined) continue;
		if (!accepts(option)) return null;
		options[key] = option;
	}
	return options;
}

function webExtensionOf(module: unknown): InstalledWebHalf | null {
	const candidate = isObject(module) ? module.default : undefined;
	if (!isObject(candidate) || typeof candidate.name !== "string") return null;
	if (!isObject(candidate.toolRenderers)) return null;
	const toolRenderers: InstalledWebHalf["toolRenderers"] = {};
	for (const [tool, entry] of Object.entries(candidate.toolRenderers)) {
		if (!isObject(entry) || !isComponentType(entry.renderer)) return null;
		const options = registrationOptionsOf(entry.options);
		if (!options) return null;
		toolRenderers[tool] = { renderer: entry.renderer as ToolRenderer, options };
	}
	return { name: candidate.name, toolRenderers };
}

async function fetchExtension(
	descriptor: InstalledWebExtension,
	environment: LoaderEnvironment,
): Promise<{ extension: InstalledWebHalf; stylesheet: Stylesheet | undefined }> {
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
		const toolRenderers = Object.fromEntries(
			Object.entries(extension.toolRenderers).filter(
				([tool]) => !descriptor.shadowed?.includes(tool),
			),
		);
		setInstalledToolRenderers(name, toolRenderers);
		result = { name, status: "loaded", tools: Object.keys(toolRenderers) };
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

function descriptorKey(descriptor: InstalledWebExtension): string {
	return [descriptor.url, descriptor.styles ?? "", ...(descriptor.shadowed ?? [])].join("\0");
}

export function syncWebExtensions(
	descriptors: readonly InstalledWebExtension[],
): Promise<WebExtensionLoadResult[]> {
	const wanted = new Map(
		descriptors.map((descriptor) => [descriptor.name, descriptorKey(descriptor)]),
	);
	for (const name of [...state.synced.keys()]) {
		if (wanted.has(name)) continue;
		state.synced.delete(name);
		unloadWebExtension(name);
	}
	const changed = descriptors.filter(
		(descriptor) => state.synced.get(descriptor.name) !== descriptorKey(descriptor),
	);
	for (const descriptor of changed) state.synced.set(descriptor.name, descriptorKey(descriptor));
	return loadWebExtensions(changed);
}
