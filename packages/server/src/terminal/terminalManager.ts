import { randomUUID } from "node:crypto";
import type {
	TerminalDataPush,
	TerminalDetachedPush,
	TerminalExitPush,
	TerminalTabInfo,
	TerminalTabKind,
} from "@thinkrail/contracts";
import { COMMAND_TAB_KEY_PREFIX, TERMINAL_REPLAY_KB, WS_CHANNELS } from "@thinkrail/contracts";
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
import { terminalPtyEnv } from "./ptyEnv";
import { nudgePtyRedraw, type PtyGrid, resizePtyIfChanged } from "./ptyGrid";
import { terminalShell, terminalShellArgs, terminalShellStartFailure } from "./shellArgs";
import { hasChildProcesses } from "./shellBusy";

type PushToClient = (clientKey: string, channel: string, data: unknown) => TerminalDeliveryResult;

interface TerminalEntry {
	pty: IPty;
	workspaceId: string;
	tabKey: string;
	kind: TerminalTabKind;
	attachedClient: string | null;
	output: OutputBatcher;
	recorder: OutputRecorder;
	grid: PtyGrid;
	/** Command tabs only: a stop was requested, so whatever end follows was asked for. */
	stopRequested: boolean;
	escalation: ReturnType<typeof setTimeout> | null;
}

export type CommandTabEndReason = "exit" | "stopped" | "closed" | "workspace-closed" | "host-stop";

export interface CommandTabEnd {
	workspaceId: string;
	tabKey: string;
	reason: CommandTabEndReason;
	exitCode: number | null;
}

export interface CommandTabSpec {
	/** POSIX sh source, run as `/bin/sh -c <script>` in the worktree root. */
	script: string;
	/** Overlaid on the filtered PTY environment, so the terminal filter cannot strip it. */
	env: Record<string, string>;
}

const COMMAND_TAB_SHELL = "/bin/sh";
const COMMAND_TAB_RECORDING_FLOOR_CHARS = 64 * 1024;
const COMMAND_TAB_STOP_GRACE_MS = 5_000;

interface TabRecord {
	tabKey: string;
	title: string;
	kind: TerminalTabKind;
}

function tabInfo({ tabKey, title, kind }: TabRecord): TerminalTabInfo {
	return { tabKey, title, kind };
}

export function isCommandTabKey(tabKey: string): boolean {
	return tabKey.startsWith(COMMAND_TAB_KEY_PREFIX);
}

function assertShellTabKey(tabKey: string): void {
	if (isCommandTabKey(tabKey)) throw new Error("Reserved terminal tab key");
}

function endedCommandTabId(tabKey: string): string {
	return `${tabKey}#ended`;
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

const DEFAULT_PTY_SIZE = { cols: 80, rows: 24 } as const;

const commandTabEndedListeners = new Set<(end: CommandTabEnd) => void>();

export function onCommandTabEnded(listener: (end: CommandTabEnd) => void): () => void {
	commandTabEndedListeners.add(listener);
	return () => {
		commandTabEndedListeners.delete(listener);
	};
}

function announceCommandTabEnd(end: CommandTabEnd): void {
	for (const listener of commandTabEndedListeners) listener(end);
}

function signalProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone: the exit path reports it.
		}
	}
}

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

const TERMINAL_GRID_DIMENSION = { min: 1, max: 32_767 } as const;

function assertTerminalGridDimension(value: unknown): void {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < TERMINAL_GRID_DIMENSION.min ||
		value > TERMINAL_GRID_DIMENSION.max
	) {
		throw new Error("Invalid terminal size");
	}
}

function assertTerminalData(data: unknown): void {
	if (typeof data !== "string") throw new Error("Invalid terminal input");
}

function assertTerminalCatalogCapacity(tabs: readonly TabRecord[]): void {
	if (tabs.length >= MAX_TERMINAL_TABS_PER_WORKSPACE) {
		throw new Error(
			`Terminal tabs are limited to ${MAX_TERMINAL_TABS_PER_WORKSPACE} per workspace`,
		);
	}
}

function worktreePathOf(workspaceId: string): string {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws.worktreePath;
}

function spawnForTab(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	size: { cols?: number; rows?: number },
	revived: string | undefined,
): { id: string; entry: TerminalEntry } {
	const cwd = worktreePathOf(workspaceId);
	const preference = loadConfig().terminalWindowsShell;
	const shell = terminalShell(process.platform, process.env, preference);
	const grid = {
		cols: size.cols ?? DEFAULT_PTY_SIZE.cols,
		rows: size.rows ?? DEFAULT_PTY_SIZE.rows,
	};
	let pty: IPty;
	try {
		pty = spawn(shell, terminalShellArgs(process.platform), {
			name: "xterm-256color",
			cwd,
			...grid,
			env: terminalPtyEnv(process.platform, process.env),
		});
	} catch (cause) {
		throw new Error(terminalShellStartFailure(process.platform, process.env, preference), {
			cause,
		});
	}
	return registerPty({
		pty,
		workspaceId,
		tabKey,
		kind: "shell",
		clientKey,
		grid,
		recorder: createOutputRecorder({ maxChars: replayBudgetChars() }),
		revived,
	});
}

function spawnCommandTab(
	workspaceId: string,
	tabKey: string,
	spec: CommandTabSpec,
): { id: string; entry: TerminalEntry } {
	const cwd = worktreePathOf(workspaceId);
	const grid = { ...DEFAULT_PTY_SIZE };
	const pty = spawn(COMMAND_TAB_SHELL, ["-c", spec.script], {
		name: "xterm-256color",
		cwd,
		...grid,
		env: { ...terminalPtyEnv(process.platform, process.env), ...spec.env },
	});
	return registerPty({
		pty,
		workspaceId,
		tabKey,
		kind: "command",
		clientKey: null,
		grid,
		recorder: createOutputRecorder({
			maxChars: Math.max(replayBudgetChars(), COMMAND_TAB_RECORDING_FLOOR_CHARS),
		}),
		revived: undefined,
	});
}

function registerPty(args: {
	pty: IPty;
	workspaceId: string;
	tabKey: string;
	kind: TerminalTabKind;
	clientKey: string | null;
	grid: PtyGrid;
	recorder: OutputRecorder;
	revived: string | undefined;
}): { id: string; entry: TerminalEntry } {
	const { pty, workspaceId, tabKey, kind, clientKey, grid, recorder, revived } = args;
	const id = randomUUID();
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
		kind,
		attachedClient: clientKey,
		output,
		recorder,
		grid,
		stopRequested: false,
		escalation: null,
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
		clearEscalation(entry);
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
		if (entry.kind === "command") {
			announceCommandTabEnd({
				workspaceId: entry.workspaceId,
				tabKey: entry.tabKey,
				reason: entry.stopRequested ? "stopped" : "exit",
				exitCode,
			});
		}
	});
	return { id, entry };
}

function clearEscalation(entry: TerminalEntry): void {
	if (entry.escalation) clearTimeout(entry.escalation);
	entry.escalation = null;
}

export function startCommandTab(
	workspaceId: string,
	tabKey: string,
	title: string,
	spec: CommandTabSpec,
): { pid: number } {
	if (process.platform === "win32") throw new Error("Command tabs are not supported on Windows");
	assertTerminalTabKey(tabKey);
	if (!isCommandTabKey(tabKey))
		throw new Error("Command tabs live in the command-tab key namespace");
	assertTerminalTitle(title);
	const tabs = tabsFor(workspaceId);
	const existing = tabs.find((tab) => tab.tabKey === tabKey);
	if (existing && existing.kind !== "command") throw new Error("Tab is a shell tab");
	const index = tabIndex(workspaceId, tabKey);
	if (ptyByTab.has(index)) throw new Error("Command tab is already running");
	if (!existing) {
		assertTerminalCatalogCapacity(tabs);
		tabs.push({ tabKey, title, kind: "command" });
	} else {
		existing.title = title;
	}
	let spawned: { id: string; entry: TerminalEntry };
	try {
		spawned = spawnCommandTab(workspaceId, tabKey, spec);
	} catch (error) {
		if (!existing) {
			tabs.splice(
				tabs.findIndex((tab) => tab.tabKey === tabKey),
				1,
			);
			if (tabs.length === 0) tabsByWorkspace.delete(workspaceId);
		}
		throw error;
	}
	pendingReplay.delete(index);
	membershipChanged(workspaceId);
	return { pid: spawned.entry.pty.pid };
}

export function stopCommandTab(
	workspaceId: string,
	tabKey: string,
	options: { force?: boolean } = {},
): boolean {
	const id = ptyByTab.get(tabIndex(workspaceId, tabKey));
	if (id === undefined) return false;
	const entry = terminals.get(id);
	if (entry?.kind !== "command") return false;
	entry.stopRequested = true;
	if (options.force) {
		clearEscalation(entry);
		signalProcessGroup(entry.pty.pid, "SIGKILL");
		return true;
	}
	if (entry.escalation) return true;
	signalProcessGroup(entry.pty.pid, "SIGTERM");
	entry.escalation = setTimeout(() => {
		entry.escalation = null;
		if (terminals.get(id) === entry) signalProcessGroup(entry.pty.pid, "SIGKILL");
	}, COMMAND_TAB_STOP_GRACE_MS);
	return true;
}

export function readTerminalRecording(
	workspaceId: string,
	tabKey: string,
	maxChars: number,
): string | null {
	const index = tabIndex(workspaceId, tabKey);
	const id = ptyByTab.get(index);
	const entry = id === undefined ? undefined : terminals.get(id);
	const recording = entry ? entry.recorder.snapshot() : pendingReplay.get(index);
	if (!recording) return null;
	return recording.length > maxChars ? recording.slice(recording.length - maxChars) : recording;
}

export function reserveTerminal(
	workspaceId: string,
	tabKey: string,
	title: string,
): TerminalTabInfo {
	assertTerminalTabKey(tabKey);
	assertShellTabKey(tabKey);
	assertTerminalTitle(title);
	const tabs = tabsFor(workspaceId);
	const existing = tabs.find((tab) => tab.tabKey === tabKey);
	if (existing) return tabInfo(existing);
	assertTerminalCatalogCapacity(tabs);
	const tab: TabRecord = { tabKey, title, kind: "shell" };
	tabs.push(tab);
	try {
		persistTerminalSessions();
	} catch (error) {
		tabs.pop();
		if (tabs.length === 0) tabsByWorkspace.delete(workspaceId);
		throw error;
	}
	broadcastTabs(workspaceId, listTerminals(workspaceId));
	return tabInfo(tab);
}

export interface AttachResult {
	id: string;
	created: boolean;
	replay?: string;
	exited?: true;
}

export function attachTerminal(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	options: { title?: string; cols?: number; rows?: number } = {},
): AttachResult {
	assertTerminalTabKey(tabKey);
	if (options.title !== undefined) assertTerminalTitle(options.title);
	if (options.cols !== undefined) assertTerminalGridDimension(options.cols);
	if (options.rows !== undefined) assertTerminalGridDimension(options.rows);
	const tabs = tabsFor(workspaceId);
	const tab = tabs.find((candidate) => candidate.tabKey === tabKey);
	const isNewTab = tab === undefined;
	if (isNewTab) {
		assertShellTabKey(tabKey);
		assertTerminalCatalogCapacity(tabs);
		tabs.push({ tabKey, title: options.title ?? `Terminal ${tabs.length + 1}`, kind: "shell" });
	}

	const index = tabIndex(workspaceId, tabKey);
	const existingId = ptyByTab.get(index);
	const existing = existingId === undefined ? undefined : terminals.get(existingId);

	if (tab?.kind === "command" && !existing) {
		const replay = pendingReplay.get(index);
		return {
			id: endedCommandTabId(tabKey),
			created: false,
			...(replay ? { replay } : {}),
			exited: true,
		};
	}

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
	const { id, entry } = spawnForTab(workspaceId, tabKey, clientKey, options, revived);
	pendingReplay.delete(index);
	if (isNewTab) membershipChanged(workspaceId);
	const replay = entry.recorder.snapshot();
	return { id, created: true, ...(replay ? { replay } : {}) };
}

export function listTerminals(workspaceId: string): TerminalTabInfo[] {
	return tabsFor(workspaceId).map(tabInfo);
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

export function writeTerminal(id: string, data: string, caller: string): string | null {
	assertTerminalData(data);
	const entry = attachedEntry(id, caller);
	if (!entry) {
		announceDisplaced(id, caller);
		return null;
	}
	entry.pty.write(data);
	return entry.workspaceId;
}

export function resizeTerminal(id: string, cols: number, rows: number, caller: string): void {
	assertTerminalGridDimension(cols);
	assertTerminalGridDimension(rows);
	const entry = attachedEntry(id, caller);
	if (!entry) {
		announceDisplaced(id, caller);
		return;
	}
	resizePtyIfChanged(entry.pty, entry.grid, { cols, rows });
}

function disposeTerminalEntry(
	id: string,
	entry: TerminalEntry,
	reason: Exclude<CommandTabEndReason, "exit" | "stopped">,
): void {
	terminals.delete(id);
	clearEscalation(entry);
	const index = tabIndex(entry.workspaceId, entry.tabKey);
	ptyByTab.delete(index);
	entry.output.dispose();
	if (entry.kind === "command") {
		const finalScreen = entry.recorder.snapshot();
		if (finalScreen) pendingReplay.set(index, finalScreen);
		signalProcessGroup(entry.pty.pid, "SIGKILL");
	}
	entry.recorder.dispose();
	entry.pty.kill();
	if (entry.kind === "command") {
		announceCommandTabEnd({
			workspaceId: entry.workspaceId,
			tabKey: entry.tabKey,
			reason,
			exitCode: null,
		});
	}
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
	if (entry && !force) {
		const busy = entry.kind === "command" || hasChildProcesses(entry.pty.pid);
		if (busy) return { closed: false, busy: true };
	}

	tabs.splice(position, 1);
	if (entry && id) disposeTerminalEntry(id, entry, "closed");
	pendingReplay.delete(index);
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
		if (entry.workspaceId === workspaceId) disposeTerminalEntry(id, entry, "workspace-closed");
	}
	tabsByWorkspace.delete(workspaceId);
	for (const key of pendingReplay.keys()) {
		if (key.startsWith(`${workspaceId}${TAB_INDEX_SEP}`)) pendingReplay.delete(key);
	}
	membershipChanged(workspaceId);
}

export function closeAllTerminals(): void {
	for (const [id, entry] of terminals) disposeTerminalEntry(id, entry, "host-stop");
	completions.clear();
}

export function persistTerminalSessions(): void {
	const sessions: PersistedTerminalSessions = {};
	for (const [workspaceId, tabs] of tabsByWorkspace) {
		if (tabs.length === 0) continue;
		sessions[workspaceId] = tabs.map(({ tabKey, title, kind }) => {
			const index = tabIndex(workspaceId, tabKey);
			const id = ptyByTab.get(index);
			const entry = id === undefined ? undefined : terminals.get(id);
			const recorded = entry ? entry.recorder.snapshot() : pendingReplay.get(index);
			return {
				tabKey,
				title,
				...(kind === "command" ? { kind } : {}),
				...(recorded ? { recorded } : {}),
			};
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
			const kind: TerminalTabKind = tab.kind === "command" ? "command" : "shell";
			restored.push({ tabKey: tab.tabKey, title, kind });
			if (typeof tab.recorded === "string" && tab.recorded !== "") {
				pendingReplay.set(tabIndex(workspaceId, tab.tabKey), tab.recorded);
			}
		}
		if (restored.length > 0) tabsByWorkspace.set(workspaceId, restored);
	}
}

export function clearTerminalClient(clientKey: string): void {
	completions.clearClient(clientKey);
}

export function resetTerminalState(): void {
	closeAllTerminals();
	terminals.clear();
	ptyByTab.clear();
	tabsByWorkspace.clear();
	pendingReplay.clear();
	commandTabEndedListeners.clear();
}
