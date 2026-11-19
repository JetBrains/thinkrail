import type { ExtensionCatalogEntry, ExtensionQueryParams } from "@thinkrail/contracts";
import type {
	PanelHost,
	PanelHostScope,
	PanelPeekEntry,
	PanelToolCall,
	PanelWorkspaceTarget,
} from "@thinkrail/extension-api/web";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { extensionPanels, findExtensionPanel, type RegisteredPanel } from "../extensions";
import { extensionParamsKey, tupleKey } from "../lib";
import { enterDefaultWorkspace } from "../panels/defaultWorkspace";
import {
	type ChatLocationRequest,
	type PeekEntry,
	selectContextRepoProject,
	useAppStore,
} from "../store";
import {
	getTransport,
	RequestError,
	supportsExtensionEvents,
	supportsExtensionQuery,
} from "../transport";
import { paletteNavigator } from "./paletteNavigation";

export interface PanelHostDeps {
	readonly extension: string;
	readonly request: (params: ExtensionQueryParams) => Promise<unknown>;
	readonly navigate: (workspace: { id: string; projectId: string }, sessionId: string) => void;
	/** Enters the location's workspace and asks its chat to reveal the location. */
	readonly locate: (location: ChatLocationRequest) => void;
	readonly openPanel: (
		panel: string,
		params: Readonly<Record<string, string>>,
		title: string | undefined,
	) => void;
	readonly renderToolCall: (call: PanelToolCall) => ReactNode;
	/** Enters the workspace when it is another one, then opens the file (at `line` when given). */
	readonly openFile: (workspaceId: string, path: string, line: number | undefined) => void;
	/** Reveals the Artifacts tool of the panel's workspace. */
	readonly openArtifacts: () => void;
	readonly openWorkspace: (target: PanelWorkspaceTarget) => void;
	/** Shows a Peek entry in the panel's workspace. */
	readonly peek: (entry: PeekEntry) => void;
	/** Listens to the `extension.event` channel, which never replays its last push. */
	readonly subscribe: (listener: (push: unknown) => void) => () => void;
	/** The extension is switched off now. */
	readonly disabled: () => boolean;
	readonly scope: PanelHostScope;
	readonly hostProtocol: number | null;
	readonly hostApiVersion: number | undefined;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("The extension query was aborted", "AbortError");
}

/** The store's Peek entry for a panel's `peek`: an extension entry only for the caller's own, declared panel. */
export function panelPeekEntry(extension: string, entry: PanelPeekEntry): PeekEntry | null {
	switch (entry.kind) {
		case "extension": {
			const target = findExtensionPanel(extension, entry.panel);
			if (!target) return null;
			return {
				kind: "extension",
				extension,
				panel: entry.panel,
				params: { ...entry.params },
				titleKey: target.declaration.title,
				...(entry.title ? { name: entry.title } : {}),
			};
		}
		case "file":
			return {
				kind: "file",
				path: entry.path,
				...(entry.line === undefined ? {} : { line: entry.line }),
			};
		case "compare":
			return { kind: "compare", before: entry.before, after: entry.after };
	}
}

function eventPush(push: unknown): { extension: unknown; type: unknown; payload: unknown } | null {
	return typeof push === "object" && push !== null
		? (push as { extension: unknown; type: unknown; payload: unknown })
		: null;
}

export function createPanelHost(deps: PanelHostDeps): PanelHost {
	return {
		query(method, params, signal) {
			if (signal?.aborted) return Promise.reject(abortReason(signal));
			if (!supportsExtensionQuery(deps.hostProtocol)) {
				return Promise.reject(
					new RequestError("UNKNOWN_EXTENSION_QUERY", "The host predates extension queries"),
				);
			}
			const sent = deps.request({
				extension: deps.extension,
				method,
				...(params === undefined ? {} : { params }),
			});
			if (!signal) return sent;
			return new Promise((resolve, reject) => {
				const abort = () => reject(abortReason(signal));
				signal.addEventListener("abort", abort, { once: true });
				void sent.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
			});
		},
		openChat(target) {
			const { at } = target;
			if (!at) {
				deps.navigate({ id: target.workspaceId, projectId: target.projectId }, target.sessionId);
				return;
			}
			deps.locate({
				workspaceId: target.workspaceId,
				projectId: target.projectId,
				sessionId: target.sessionId,
				messageIndex: at.messageIndex,
				anchorText: at.anchorText,
				...(at.toolCallId ? { toolCallId: at.toolCallId } : {}),
				...(at.approximate ? { approximate: true } : {}),
			});
		},
		openPanel(panel, params = {}, title) {
			deps.openPanel(panel, params, title);
		},
		renderToolCall: (call) => deps.renderToolCall(call),
		openFile(workspaceId, path, line) {
			deps.openFile(workspaceId, path, line);
		},
		openArtifacts() {
			deps.openArtifacts();
		},
		openWorkspace(target) {
			deps.openWorkspace(target);
		},
		peek(entry) {
			const peeked = panelPeekEntry(deps.extension, entry);
			if (peeked) deps.peek(peeked);
		},
		onEvent(type, listener) {
			if (!supportsExtensionEvents(deps.hostProtocol)) return () => {};
			return deps.subscribe((raw) => {
				const push = eventPush(raw);
				if (push?.extension !== deps.extension || push.type !== type || deps.disabled()) return;
				listener(push.payload);
			});
		},
		scope: deps.scope,
		hostProtocol: deps.hostProtocol,
		hostApiVersion: deps.hostApiVersion,
	};
}

interface CatalogRead {
	readonly generation: number;
	readonly entries: Promise<readonly ExtensionCatalogEntry[]>;
	value?: readonly ExtensionCatalogEntry[];
}

let catalogRead: CatalogRead | null = null;

export function readExtensionCatalog(
	generation: number,
	list: () => Promise<readonly ExtensionCatalogEntry[]> = () =>
		getTransport().request("extension.list", {}),
): Promise<readonly ExtensionCatalogEntry[]> {
	if (catalogRead?.generation === generation) return catalogRead.entries;
	const read: CatalogRead = { generation, entries: list() };
	catalogRead = read;
	read.entries.then(
		(value) => {
			read.value = value;
		},
		() => {
			if (catalogRead === read) catalogRead = null;
		},
	);
	return read.entries;
}

export function cachedExtensionCatalog(
	generation: number,
): readonly ExtensionCatalogEntry[] | undefined {
	return catalogRead?.generation === generation ? catalogRead.value : undefined;
}

export type ExtensionCatalogRead = readonly ExtensionCatalogEntry[] | "loading" | "failed";

/** The host's extension catalog, read once per connection generation while `enabled`. */
export function useExtensionCatalog(enabled: boolean): {
	read: ExtensionCatalogRead;
	retry: () => void;
} {
	const status = useAppStore((state) => state.status);
	const generation = useAppStore((state) => state.connectionGeneration);
	const [attempt, setAttempt] = useState(0);
	const [result, setResult] = useState<{
		generation: number;
		attempt: number;
		value: readonly ExtensionCatalogEntry[] | "failed";
	} | null>(null);
	useEffect(() => {
		if (!enabled || status !== "connected" || generation === 0) return;
		let current = true;
		readExtensionCatalog(generation).then(
			(entries) => {
				if (current) setResult({ generation, attempt, value: entries });
			},
			() => {
				if (current) setResult({ generation, attempt, value: "failed" });
			},
		);
		return () => {
			current = false;
		};
	}, [attempt, enabled, generation, status]);
	const read =
		result && result.generation === generation && result.attempt === attempt
			? result.value
			: (cachedExtensionCatalog(generation) ?? "loading");
	return { read, retry: () => setAttempt((value) => value + 1) };
}

/**
 * The panels an entry point may offer: declared, their extension not switched off, on a host that
 * answers `extension.query` and — once its catalog is read — lists the extension.
 */
export function openableExtensionPanels(input: {
	disabled: readonly string[];
	protocolVersion: number | null;
	catalog: ExtensionCatalogRead;
	panels?: readonly RegisteredPanel[];
}): readonly RegisteredPanel[] {
	return openableContributions({ ...input, items: input.panels ?? extensionPanels() });
}

/** `openableExtensionPanels`' rule for any extension contribution: a panel, a side tool. */
export function openableContributions<T extends { extension: string }>(input: {
	disabled: readonly string[];
	protocolVersion: number | null;
	catalog: ExtensionCatalogRead;
	items: readonly T[];
}): readonly T[] {
	if (!supportsExtensionQuery(input.protocolVersion)) return [];
	const listed = Array.isArray(input.catalog)
		? new Set(input.catalog.map((entry) => entry.name))
		: null;
	return input.items.filter(
		(item) =>
			!input.disabled.includes(item.extension) && (listed === null || listed.has(item.extension)),
	);
}

export function useOpenableExtensionPanels(): readonly RegisteredPanel[] {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const { read } = useExtensionCatalog(supportsExtensionQuery(protocolVersion));
	return useMemo(
		() => openableExtensionPanels({ disabled, protocolVersion, catalog: read }),
		[disabled, protocolVersion, read],
	);
}

export function currentOpenableExtensionPanels(): readonly RegisteredPanel[] {
	const { disabledExtensions, protocolVersion, connectionGeneration } = useAppStore.getState();
	return openableExtensionPanels({
		disabled: disabledExtensions,
		protocolVersion,
		catalog: cachedExtensionCatalog(connectionGeneration) ?? "loading",
	});
}

export function openExtensionPanelHere(panel: RegisteredPanel): void {
	const state = useAppStore.getState();
	if (state.activeWorkspaceId) {
		openExtensionPanel(state.activeWorkspaceId, panel);
		return;
	}
	const project = selectContextRepoProject(state);
	if (project) void openExtensionPanelInProject(project.id, panel);
}

/** A rail command's panel: `undefined` when `id` is no panel's rail command, `null` while that panel is not openable. */
export function railCommandPanel(
	extension: string,
	id: string,
	openable: () => readonly RegisteredPanel[] = currentOpenableExtensionPanels,
	panels: readonly RegisteredPanel[] = extensionPanels(),
): RegisteredPanel | null | undefined {
	const panel = panels.find(
		(candidate) => candidate.extension === extension && candidate.declaration.rail?.command === id,
	);
	if (!panel) return undefined;
	return openable().includes(panel) ? panel : null;
}

/** From a project without an active workspace: enters its Default workspace, then opens the panel there. */
export async function openExtensionPanelInProject(
	projectId: string,
	panel: RegisteredPanel,
	stillWanted: () => boolean = paletteNavigator.beginPick(),
): Promise<void> {
	const workspace = await enterDefaultWorkspace(projectId, stillWanted);
	if (workspace) openExtensionPanel(workspace.id, panel);
}

export interface ExtensionPanelTarget {
	readonly extension: string;
	readonly panel: string;
	readonly titleKey: string;
}

export function openExtensionTab(
	workspaceId: string,
	target: ExtensionPanelTarget,
	params: Readonly<Record<string, string>> = {},
	title = "",
): void {
	useAppStore.getState().openDoc({
		kind: "extension",
		id: tupleKey(
			"extension",
			workspaceId,
			target.extension,
			target.panel,
			extensionParamsKey(params),
		),
		workspaceId,
		name: title,
		extension: target.extension,
		panel: target.panel,
		titleKey: target.titleKey,
		params: { ...params },
	});
}

export function openExtensionPanel(
	workspaceId: string,
	panel: RegisteredPanel,
	params: Readonly<Record<string, string>> = {},
	title = "",
): void {
	openExtensionTab(
		workspaceId,
		{ extension: panel.extension, panel: panel.panel, titleKey: panel.declaration.title },
		params,
		title,
	);
}
