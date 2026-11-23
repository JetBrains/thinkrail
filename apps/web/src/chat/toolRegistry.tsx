import {
	parseToolResultContent,
	type ToolChrome,
	type ToolProminence,
	type ToolRegistrationOptions,
	type ToolRenderer,
	type ToolRenderProps,
	type ToolWidth,
	toolValueText,
	type WebExtension,
} from "@thinkrail/extension-api/web";
import type { Translator } from "@thinkrail/locales/react";
import { type ReactNode, useSyncExternalStore } from "react";
import { reportToolPresentationError } from "./ToolRendererBoundary";

interface ToolRegistration extends ToolRegistrationOptions {
	renderer: ToolRenderer;
	extension?: string | undefined;
}

export interface ToolRegistry {
	readonly revision: number;
	readonly exact: ReadonlyMap<string, ToolRegistration>;
	readonly prefixes: ReadonlyMap<string, ToolRegistration>;
}

interface RegistryState {
	builtIn: Map<string, ToolRegistration>;
	prefixes: Map<string, ToolRegistration>;
	installed: Map<string, Map<string, ToolRegistration>>;
	listeners: Set<() => void>;
	current: ToolRegistry;
}

function createState(): RegistryState {
	return {
		builtIn: new Map(),
		prefixes: new Map(),
		installed: new Map(),
		listeners: new Set(),
		current: { revision: 0, exact: new Map(), prefixes: new Map() },
	};
}

const state: RegistryState = import.meta.hot?.data.toolRegistry ?? createState();
if (import.meta.hot) import.meta.hot.data.toolRegistry = state;

function publish(): void {
	const exact = new Map<string, ToolRegistration>();
	const prefixed = (name: string) =>
		[...state.prefixes.keys()].some((prefix) => prefix !== "" && name.startsWith(prefix));
	for (const owned of state.installed.values()) {
		for (const [name, registration] of owned) {
			if (!exact.has(name) && !prefixed(name)) exact.set(name, registration);
		}
	}
	for (const [name, registration] of state.builtIn) exact.set(name, registration);
	state.current = Object.freeze({
		revision: state.current.revision + 1,
		exact,
		prefixes: new Map(state.prefixes),
	});
	for (const listener of state.listeners) listener();
}

export function registerToolRenderer(
	toolName: string,
	renderer: ToolRenderer,
	options: ToolRegistrationOptions = {},
	extension?: string,
): void {
	state.builtIn.set(toolName, { renderer, ...options, extension });
	publish();
}

export function registerToolRendererPrefix(
	prefix: string,
	renderer: ToolRenderer,
	options: ToolRegistrationOptions = {},
): void {
	state.prefixes.set(prefix, { renderer, ...options });
	publish();
}

export function setInstalledToolRenderers(
	owner: string,
	toolRenderers: NonNullable<WebExtension["toolRenderers"]>,
): void {
	const owned = new Map<string, ToolRegistration>();
	for (const [name, { renderer, options }] of Object.entries(toolRenderers)) {
		owned.set(name, { renderer, ...options, extension: owner });
	}
	state.installed.set(owner, owned);
	publish();
}

export function reserveInstalledOwner(owner: string): void {
	if (!state.installed.has(owner)) state.installed.set(owner, new Map());
}

export function removeInstalledToolRenderers(owner: string): boolean {
	if (!state.installed.delete(owner)) return false;
	publish();
	return true;
}

export function currentToolRegistry(): ToolRegistry {
	return state.current;
}

export function subscribeToolRegistry(listener: () => void): () => void {
	state.listeners.add(listener);
	return () => {
		state.listeners.delete(listener);
	};
}

export function useToolRegistry(): ToolRegistry {
	return useSyncExternalStore(subscribeToolRegistry, currentToolRegistry, currentToolRegistry);
}

export function useToolRegistryRevision(): number {
	return useToolRegistry().revision;
}

export function useToolRenderer(toolName: string): ToolRenderer {
	const read = () => getToolRenderer(toolName);
	return useSyncExternalStore(subscribeToolRegistry, read, read);
}

function resolveRegistration(
	toolName: string,
	registry: ToolRegistry,
): ToolRegistration | undefined {
	const exact = registry.exact.get(toolName);
	if (exact) return exact;
	let match: ToolRegistration | undefined;
	let matchLength = 0;
	for (const [prefix, registration] of registry.prefixes) {
		if (prefix.length > matchLength && toolName.startsWith(prefix)) {
			match = registration;
			matchLength = prefix.length;
		}
	}
	return match;
}

export function getToolRenderer(
	toolName: string,
	registry: ToolRegistry = state.current,
): ToolRenderer {
	return resolveRegistration(toolName, registry)?.renderer ?? DefaultToolRenderer;
}

export function getToolSummary(
	t: Translator,
	toolName: string,
	props: ToolRenderProps,
	registry: ToolRegistry = state.current,
): string {
	const summary = resolveRegistration(toolName, registry)?.summary;
	if (!summary) return "";
	try {
		return summary(props, t);
	} catch (error) {
		reportToolPresentationError(summary, error, "tool-summary");
		return "";
	}
}

export function isInteractiveTool(
	toolName: string,
	registry: ToolRegistry = state.current,
): boolean {
	return resolveRegistration(toolName, registry)?.interactive === true;
}

export function isDockedTool(toolName: string, registry: ToolRegistry = state.current): boolean {
	const registration = resolveRegistration(toolName, registry);
	return registration?.interactive === true && registration.dock === true;
}

export function carriesComposerSuggestions(
	toolName: string,
	registry: ToolRegistry = state.current,
): boolean {
	return resolveRegistration(toolName, registry)?.composerSuggestions !== undefined;
}

export function readComposerSuggestions(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
	disabledExtensions: readonly string[] = [],
	registry: ToolRegistry = state.current,
): readonly string[] | null {
	const registration = resolveRegistration(toolName, registry);
	const reader = registration?.composerSuggestions;
	if (!reader) return null;
	if (registration.extension && disabledExtensions.includes(registration.extension)) return null;
	try {
		return reader(args, result);
	} catch (error) {
		reportToolPresentationError(reader, error, "tool-composer-suggestions");
		return null;
	}
}

export function getToolChrome(
	toolName: string,
	registry: ToolRegistry = state.current,
): ToolChrome {
	return resolveRegistration(toolName, registry)?.chrome ?? "card";
}

export function getToolWidth(toolName: string, registry: ToolRegistry = state.current): ToolWidth {
	return resolveRegistration(toolName, registry)?.width ?? "column";
}

export interface ResolvedProminence {
	prominence: ToolProminence;
	defaultExpanded: boolean;
}

export function resolveProminence(
	toolName: string,
	registry: ToolRegistry = state.current,
): ResolvedProminence {
	const reg = resolveRegistration(toolName, registry);
	const prominence = reg?.chrome === "bare" ? "primary" : (reg?.prominence ?? "routine");
	return { prominence, defaultExpanded: reg?.defaultExpanded ?? false };
}

export function DefaultToolRenderer({ args, result, status }: ToolRenderProps): ReactNode {
	const argsText = toolValueText(args);
	const resultText = parseToolResultContent(result).text;
	return (
		<div className="flex flex-col gap-4">
			{argsText && argsText !== "{}" ? (
				<pre className="overflow-auto tr-code-text text-text-muted">{argsText}</pre>
			) : null}
			{status !== "running" && resultText ? (
				<pre className="overflow-auto tr-code-text text-text-default">{resultText}</pre>
			) : null}
		</div>
	);
}
