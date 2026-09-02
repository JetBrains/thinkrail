import { randomUUID } from "node:crypto";
import type {
	TerminalDataPush,
	TerminalDetachedPush,
	TerminalExitPush,
	TerminalTabInfo,
} from "@thinkrail/contracts";
import { TERMINAL_REPLAY_KB, WS_CHANNELS } from "@thinkrail/contracts";
import { type IPty, spawn } from "bun-pty";
import {
	loadConfig,
	loadTerminalSessions,
	loadWorkspaces,
	type PersistedTerminalSessions,
	saveTerminalSessions,
} from "../persistence";
import { createTerminalCompletionQueue } from "./completionQueue";
import {
	createOutputBatcher,
	type OutputBatcher,
	type TerminalDeliveryResult,
} from "./outputBatcher";
import { createOutputRecorder, type OutputRecorder } from "./outputRecorder";
import { nudgePtyRedraw, type PtyGrid, resizePtyIfChanged } from "./ptyGrid";
import { terminalShell, terminalShellArgs } from "./shellArgs";
import { hasChildProcesses } from "./shellBusy";

type PushToClient = (clientKey: string, channel: string, data: unknown) => TerminalDeliveryResult;

interface TerminalEntry {
	pty: IPty;
	workspaceId: string;
	tabKey: string;
	attachedClient: string | null;
	output: OutputBatcher;
	recorder: OutputRecorder;
	grid: PtyGrid;
}

interface TabRecord {
	tabKey: string;
	title: string;
}

const OUTPUT_BATCH = {
	flushMs: 8,
	maxBatchChars: 32_768,
	maxPendingChars: 1_048_576,
} as const;
const MAX_TERMINAL_TABS_PER_WORKSPACE = 256;
const MAX_TERMINAL_TAB_KEY_LENGTH = 500;
const MAX_TERMINAL_TITLE_LENGTH = 1000;

const terminals = new Map<string, TerminalEntry>();
const ptyByTab = new Map<string, string>();
const tabsByWorkspace = new Map<string, TabRecord[]>();
const pendingReplay = new Map<string, string>();

const TAB_INDEX_SEP = "\u0000";

function tabIndex(workspaceId: string, tabKey: string): string {
	return `${workspaceId}${TAB_INDEX_SEP}${tabKey}`;
}

let pushToClient: PushToClient = () => "unavailable";
export function setTerminalPublisher(fn: PushToClient): void {
	pushToClient = fn;
}

let broadcastTabs: (workspaceId: string, tabs: TerminalTabInfo[]) => void = () => {};
export function setTerminalTabsPublisher(
	fn: (workspaceId: string, tabs: TerminalTabInfo[]) => void,
): void {
	broadcastTabs = fn;
}

function membershipChanged(workspaceId: string): void {
	broadcastTabs(workspaceId, listTerminals(workspaceId));
	persistTerminalSessions();
}

const completions = createTerminalCompletionQueue((clientKey, channel, data) =>
	pushToClient(clientKey, channel, data),
);

function ptyEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") env[key] = value;
	}
	env.TERM = "xterm-256color";
	env.COLORTERM = "truecolor";
	return env;
}

const DEFAULT_PTY_SIZE = { cols: 80, rows: 24 } as const;

function replayBudgetChars(): number {
	const configured = loadConfig().terminalReplayKb;
	const kb = Number.isFinite(configured)
		? Math.min(Math.max(Math.trunc(configured), TERMINAL_REPLAY_KB.min), TERMINAL_REPLAY_KB.max)
		: TERMINAL_REPLAY_KB.default;
	return kb * 1024;
}

function tabsFor(workspaceId: string): TabRecord[] {
	let tabs = tabsByWorkspace.get(workspaceId);
	if (!tabs) {
		tabs = [];
		tabsByWorkspace.set(workspaceId, tabs);
	}
	return tabs;
}

function isValidTerminalTabKey(value: unknown): value is string {
	return (
		typeof value === "string" && value.length > 0 && value.length <= MAX_TERMINAL_TAB_KEY_LENGTH
	);
}

function assertTerminalTabKey(tabKey: string): void {
	if (!isValidTerminalTabKey(tabKey)) throw new Error("Invalid terminal tab key");
}

function isValidTerminalTitle(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= MAX_TERMINAL_TITLE_LENGTH;
}

function assertTerminalTitle(title: string): void {
	if (!isValidTerminalTitle(title)) throw new Error("Invalid terminal title");
}

function assertTerminalCatalogCapacity(tabs: readonly TabRecord[]): void {
	if (tabs.length >= MAX_TERMINAL_TABS_PER_WORKSPACE) {
		throw new Error(
			`Terminal tabs are limited to ${MAX_TERMINAL_TABS_PER_WORKSPACE} per workspace`,
		);
	}
}

function spawnForTab(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	size: { cols?: number; rows?: number },
	revived: string | undefined,
): { id: string; entry: TerminalEntry } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const shell = terminalShell(process.platform, process.env);
	const grid = {
		cols: size.cols ?? DEFAULT_PTY_SIZE.cols,
		rows: size.rows ?? DEFAULT_PTY_SIZE.rows,
	};
	const pty = spawn(shell, terminalShellArgs(process.platform), {
		name: "xterm-256color",
		cwd: ws.worktreePath,
		...grid,
		env: ptyEnv(),
	});

	const id = randomUUID();
	const recorder = createOutputRecorder({ maxChars: replayBudgetChars() });
	if (revived !== undefined) recorder.restore(revived);
	const output = createOutputBatcher({
		...OUTPUT_BATCH,
		onFlush: ({ data, truncated }) => {
			const entry = terminals.get(id);
			if (!entry?.attachedClient) return "unavailable";
			const push: TerminalDataPush = { id, data, truncated };
			return pushToClient(entry.attachedClient, WS_CHANNELS.terminalData, push);
		},
	});
	const entry: TerminalEntry = {
		pty,
		workspaceId,
		tabKey,
		attachedClient: clientKey,
		output,
		recorder,
		grid,
	};
	terminals.set(id, entry);
	ptyByTab.set(tabIndex(workspaceId, tabKey), id);

	pty.onData((data) => {
		recorder.push(data);
		output.push(data);
	});
	pty.onExit(({ exitCode }) => {
		if (terminals.get(id) !== entry) return;
		terminals.delete(id);
		const index = tabIndex(entry.workspaceId, entry.tabKey);
		ptyByTab.delete(index);
		const finalScreen = recorder.snapshot();
		if (finalScreen) pendingReplay.set(index, finalScreen);
		recorder.dispose();
		const finalBatch = output.finish();
		const data: TerminalDataPush | undefined = finalBatch
			? { id, data: finalBatch.data, truncated: finalBatch.truncated }
			: undefined;
		const exit: TerminalExitPush = { id, exitCode };
		if (entry.attachedClient) {
			completions.enqueue(entry.attachedClient, { ...(data ? { data } : {}), exit });
		}
	});
	return { id, entry };
}

export function reserveTerminal(
	workspaceId: string,
	tabKey: string,
	title: string,
): TerminalTabInfo {
	assertTerminalTabKey(tabKey);
	assertTerminalTitle(title);
	const tabs = tabsFor(workspaceId);
	const existing = tabs.find((tab) => tab.tabKey === tabKey);
	if (existing) return { tabKey: existing.tabKey, title: existing.title };
	assertTerminalCatalogCapacity(tabs);
	const tab = { tabKey, title };
	tabs.push(tab);
	try {
		persistTerminalSessions();
	} catch (error) {
		tabs.pop();
		if (tabs.length === 0) tabsByWorkspace.delete(workspaceId);
		throw error;
	}
	broadcastTabs(workspaceId, listTerminals(workspaceId));
	return tab;
}

export interface AttachResult {
	id: string;
	created: boolean;
	replay?: string;
}

export function attachTerminal(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	options: { title?: string; cols?: number; rows?: number } = {},
): AttachResult {
	assertTerminalTabKey(tabKey);
	if (options.title !== undefined) assertTerminalTitle(options.title);
	const tabs = tabsFor(workspaceId);
	const isNewTab = !tabs.some((tab) => tab.tabKey === tabKey);
	if (isNewTab) {
		assertTerminalCatalogCapacity(tabs);
		tabs.push({ tabKey, title: options.title ?? `Terminal ${tabs.length + 1}` });
	}

	const index = tabIndex(workspaceId, tabKey);
	const existingId = ptyByTab.get(index);
	const existing = existingId === undefined ? undefined : terminals.get(existingId);

	if (existing && existingId) {
		if (existing.attachedClient && existing.attachedClient !== clientKey) {
			const push: TerminalDetachedPush = { workspaceId, tabKey };
			pushToClient(existing.attachedClient, WS_CHANNELS.terminalDetached, push);
		}
		existing.attachedClient = clientKey;
		const resized =
			options.cols !== undefined && options.rows !== undefined
				? resizePtyIfChanged(existing.pty, existing.grid, {
						cols: options.cols,
						rows: options.rows,
					})
				: false;
		if (!resized) {
			nudgePtyRedraw(existing.pty, existing.grid, {
				isStillLive: () => terminals.get(existingId) === existing,
			});
		}
		const replay = existing.recorder.snapshot();
		existing.output.reset();
		return { id: existingId, created: false, ...(replay ? { replay } : {}) };
	}

	const revived = pendingReplay.get(index);
	pendingReplay.delete(index);
	const { id, entry } = spawnForTab(workspaceId, tabKey, clientKey, options, revived);
	if (isNewTab) membershipChanged(workspaceId);
	const replay = entry.recorder.snapshot();
	return { id, created: true, ...(replay ? { replay } : {}) };
}

export function listTerminals(workspaceId: string): TerminalTabInfo[] {
	return tabsFor(workspaceId).map(({ tabKey, title }) => ({ tabKey, title }));
}

function attachedEntry(id: string, caller: string): TerminalEntry | undefined {
	const entry = terminals.get(id);
	return entry?.attachedClient === caller ? entry : undefined;
}

function announceDisplaced(id: string, caller: string): void {
	const entry = terminals.get(id);
	if (!entry || entry.attachedClient === caller) return;
	const push: TerminalDetachedPush = { workspaceId: entry.workspaceId, tabKey: entry.tabKey };
	pushToClient(caller, WS_CHANNELS.terminalDetached, push);
}

export function writeTerminal(id: string, data: string, caller: string): void {
	const entry = attachedEntry(id, caller);
	if (!entry) {
		announceDisplaced(id, caller);
		return;
	}
	entry.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number, caller: string): void {
	const entry = attachedEntry(id, caller);
	if (!entry) {
		announceDisplaced(id, caller);
		return;
	}
	resizePtyIfChanged(entry.pty, entry.grid, { cols, rows });
}

function disposeTerminalEntry(id: string, entry: TerminalEntry): void {
	terminals.delete(id);
	ptyByTab.delete(tabIndex(entry.workspaceId, entry.tabKey));
	entry.output.dispose();
	entry.recorder.dispose();
	entry.pty.kill();
}

export interface CloseTabResult {
	closed: boolean;
	busy: boolean;
}

export function closeTerminalTab(
	workspaceId: string,
	tabKey: string,
	force = false,
): CloseTabResult {
	const tabs = tabsFor(workspaceId);
	const position = tabs.findIndex((tab) => tab.tabKey === tabKey);
	if (position === -1) return { closed: false, busy: false };

	const index = tabIndex(workspaceId, tabKey);
	const id = ptyByTab.get(index);
	const entry = id === undefined ? undefined : terminals.get(id);
	if (entry && !force && hasChildProcesses(entry.pty.pid)) return { closed: false, busy: true };

	tabs.splice(position, 1);
	pendingReplay.delete(index);
	if (entry && id) disposeTerminalEntry(id, entry);
	membershipChanged(workspaceId);
	return { closed: true, busy: false };
}

export function resumeClientTerminals(clientKey: string): void {
	for (const entry of terminals.values()) {
		if (entry.attachedClient === clientKey) entry.output.resume();
	}
	completions.resume(clientKey);
}

export function closeWorkspaceTerminals(workspaceId: string): void {
	for (const [id, entry] of terminals) {
		if (entry.workspaceId === workspaceId) disposeTerminalEntry(id, entry);
	}
	tabsByWorkspace.delete(workspaceId);
	for (const key of pendingReplay.keys()) {
		if (key.startsWith(`${workspaceId}${TAB_INDEX_SEP}`)) pendingReplay.delete(key);
	}
	membershipChanged(workspaceId);
}

export function closeAllTerminals(): void {
	for (const [id, entry] of terminals) disposeTerminalEntry(id, entry);
	completions.clear();
}

export function persistTerminalSessions(): void {
	const sessions: PersistedTerminalSessions = {};
	for (const [workspaceId, tabs] of tabsByWorkspace) {
		if (tabs.length === 0) continue;
		sessions[workspaceId] = tabs.map(({ tabKey, title }) => {
			const index = tabIndex(workspaceId, tabKey);
			const id = ptyByTab.get(index);
			const entry = id === undefined ? undefined : terminals.get(id);
			const recorded = entry ? entry.recorder.snapshot() : pendingReplay.get(index);
			return { tabKey, title, ...(recorded ? { recorded } : {}) };
		});
	}
	saveTerminalSessions(sessions);
}

export function reviveTerminalSessions(): void {
	for (const [workspaceId, tabs] of Object.entries(loadTerminalSessions())) {
		if (!Array.isArray(tabs)) continue;
		const restored: TabRecord[] = [];
		for (const tab of tabs.slice(0, MAX_TERMINAL_TABS_PER_WORKSPACE)) {
			if (!isValidTerminalTabKey(tab?.tabKey)) continue;
			const title = isValidTerminalTitle(tab.title) ? tab.title : "Terminal";
			restored.push({ tabKey: tab.tabKey, title });
			if (typeof tab.recorded === "string" && tab.recorded !== "") {
				pendingReplay.set(tabIndex(workspaceId, tab.tabKey), tab.recorded);
			}
		}
		if (restored.length > 0) tabsByWorkspace.set(workspaceId, restored);
	}
}

export function resetTerminalState(): void {
	closeAllTerminals();
	terminals.clear();
	ptyByTab.clear();
	tabsByWorkspace.clear();
	pendingReplay.clear();
}
