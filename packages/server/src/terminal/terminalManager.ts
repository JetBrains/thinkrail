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
import { terminalShellArgs } from "./shellArgs";
import { hasChildProcesses } from "./shellBusy";

/** Push one addressed frame and report whether it was accepted and whether another may follow. */
type PushToClient = (clientKey: string, channel: string, data: unknown) => TerminalDeliveryResult;

interface TerminalEntry {
	pty: IPty;
	workspaceId: string;
	tabKey: string;
	/** The client currently receiving this terminal's output; null when nobody is looking. */
	attachedClient: string | null;
	/** Groups this PTY's reads into whole frames instead of one frame per read. */
	output: OutputBatcher;
	/** The rolling window replayed into a fresh xterm on attach. */
	recorder: OutputRecorder;
}

/** A tab, which exists whether or not a shell is currently running behind it. */
interface TabRecord {
	tabKey: string;
	title: string;
}

/**
 * Output batching bounds. `bun-pty` gives us no way to slow a shell down — its `IPty` has no `pause()`/
 * `resume()` and its read loop starts at spawn — so we cannot push back on `yes` or a huge `cat`. What we can
 * do is stop turning every read into its own WebSocket frame, and refuse to buffer without limit.
 */
const OUTPUT_BATCH = {
	/** ~one display frame: collapses a burst without making an echo feel laggy. */
	flushMs: 8,
	/** Flush early past this, so a flood streams steadily instead of in visible lumps. */
	maxBatchChars: 32_768,
	/** Held only while the attached client is away (mid-reconnect); past it the oldest output goes. */
	maxPendingChars: 1_048_576,
} as const;

/** Live PTYs by their per-run id. */
const terminals = new Map<string, TerminalEntry>();
/** `(workspaceId, tabKey)` → the PTY id currently behind that tab. */
const ptyByTab = new Map<string, string>();
/** The ordered tab list per workspace — host-owned state, and the authority on which terminals exist. */
const tabsByWorkspace = new Map<string, TabRecord[]>();
/**
 * The picture a tab is holding for its next shell, keyed like `ptyByTab`.
 *
 * Filled from disk at boot (`reviveTerminalSessions`) and when a shell exits naturally while its tab lives on —
 * both are cases where the tab outlives the process that painted it. Served once and dropped, so it can never
 * outlive the run it describes.
 */
const pendingReplay = new Map<string, string>();

/** Separator for the composite tab key. A NUL cannot occur in a workspace id or a tabKey, so the pair can
 * never collide — written as an escape rather than a literal so this file stays text to git and to tooling. */
const TAB_INDEX_SEP = "\u0000";

/** A tab's index key: the `(workspaceId, tabKey)` pair a shell is owned by. */
function tabIndex(workspaceId: string, tabKey: string): string {
	return `${workspaceId}${TAB_INDEX_SEP}${tabKey}`;
}

/**
 * Push terminal output to the client attached to it. Set by `createServer` once the WS server exists.
 *
 * Addressed rather than broadcast, deliberately: the host previously published every PTY's bytes to a single
 * topic that *every* socket subscribed to, leaving each browser to discard the ones that weren't its own. That
 * handed every connected client everything typed or printed in every terminal of every workspace — tokens,
 * keys, private paths — which matters all the more once the host is reachable from a phone over Tailscale.
 * Which client is attached can change (attach is exclusive with takeover); that a frame only ever goes to a
 * client that attached cannot.
 */
let pushToClient: PushToClient = () => "unavailable";
export function setTerminalPublisher(fn: PushToClient): void {
	pushToClient = fn;
}

/**
 * Fan a tab-list snapshot out to every client. Set by `createServer`.
 *
 * Which terminals exist is shared domain state (architecture #9), unlike their contents: without this, a tab
 * closed in one browser leaves another with a dead instance mounted and still accepting input.
 */
let broadcastTabs: (workspaceId: string, tabs: TerminalTabInfo[]) => void = () => {};
export function setTerminalTabsPublisher(
	fn: (workspaceId: string, tabs: TerminalTabInfo[]) => void,
): void {
	broadcastTabs = fn;
}

/**
 * React to a change in which tabs exist: tell every client, and write the new membership down.
 *
 * Persisting here rather than only at `stop()` is what makes the on-disk list authoritative *during* the run.
 * The host has no crash isolation by design (a fatal agent or provider fault takes it down, see
 * `architecture.md`), so an ungraceful exit is an ordinary path — and a file only written on graceful shutdown
 * would resurrect a tab the user had closed, spawning a shell for it and breaking the no-tab/no-shell rule.
 * Output snapshots stay best-effort: they ride along when they happen to exist, and `stop()` is still where a
 * full set is captured.
 */
function membershipChanged(workspaceId: string): void {
	broadcastTabs(workspaceId, listTerminals(workspaceId));
	persistTerminalSessions();
}

/** Natural exits retain final output and their death notice as one ordered, reconnect-safe unit. */
const completions = createTerminalCompletionQueue((clientKey, channel, data) =>
	pushToClient(clientKey, channel, data),
);

/** The host's full env (login PATH already resolved at boot) plus terminal-friendly vars. */
function ptyEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") env[key] = value;
	}
	env.TERM = "xterm-256color";
	env.COLORTERM = "truecolor";
	return env;
}

/** The size a PTY starts at when the client didn't measure one — a plain terminal's conventional default. */
const DEFAULT_PTY_SIZE = { cols: 80, rows: 24 } as const;

/**
 * How many characters of output to keep per terminal for replay, from `AppConfig.terminalReplayKb`.
 *
 * Clamped here rather than trusted: the value is persisted JSON a user can hand-edit, and it sizes a buffer
 * held per live terminal *and* written to disk. Read per spawn, so changing the setting applies to new shells
 * without disturbing running ones.
 */
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

/**
 * Spawn a PTY for a tab, rooted in the workspace's worktree.
 *
 * `size` is the client's measured grid. Honouring it at spawn time matters because the shell prints its first
 * prompt immediately: born at the wrong size, that prompt is laid out for the wrong width and then reflowed
 * when the real size arrives a round trip later, which can visibly garble it.
 */
function spawnForTab(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	size: { cols?: number; rows?: number },
	revived: string | undefined,
): { id: string; entry: TerminalEntry } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const shell = process.env.SHELL ?? "/bin/bash";
	const pty = spawn(shell, terminalShellArgs(process.platform), {
		name: "xterm-256color",
		cwd: ws.worktreePath,
		cols: size.cols ?? DEFAULT_PTY_SIZE.cols,
		rows: size.rows ?? DEFAULT_PTY_SIZE.rows,
		env: ptyEnv(),
	});

	const id = randomUUID();
	const recorder = createOutputRecorder({ maxChars: replayBudgetChars() });
	// Seed BEFORE the read loop is wired: the shell prints its prompt immediately, and restoring afterwards
	// would overwrite whatever had already arrived.
	if (revived !== undefined) recorder.restore(revived);
	// One frame per batch rather than per read, and output survives a brief reconnect: a batch the attached
	// client can't take is kept and retried (see `resumeClientTerminals`) instead of vanishing.
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
	};
	terminals.set(id, entry);
	ptyByTab.set(tabIndex(workspaceId, tabKey), id);

	pty.onData((data) => {
		// Record before batching: the recording must survive delivery being dropped or truncated, since its whole
		// job is to repaint a client that was not there.
		recorder.push(data);
		output.push(data);
	});
	// Tell the attached client the shell is gone. Without this the tab stays looking alive — cursor blinking,
	// keystrokes accepted — while every one of them is written to a dead id and silently dropped.
	pty.onExit(({ exitCode }) => {
		// An intentional teardown deletes the entry before kill(), so its eventual exit callback is silent.
		if (terminals.get(id) !== entry) return;
		terminals.delete(id);
		const index = tabIndex(entry.workspaceId, entry.tabKey);
		ptyByTab.delete(index);
		// The TAB survives its shell: the user still has to see it died and close it themselves. Hand its last
		// screen to the tab before the recorder goes with the entry — otherwise leaving the workspace (or a host
		// restart) after a crash loses exactly the output that would say what happened, and the next attach
		// opens a blank pane. A later attach on the same tab gets a fresh shell showing this.
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

export interface AttachResult {
	id: string;
	created: boolean;
	replay?: string;
}

/**
 * Give me this tab's shell — idempotent get-or-create, and the only way a PTY is ever born.
 *
 * **This function must stay synchronous.** Lookup and insert happen in one tick, which on Bun's single event
 * loop makes it atomic: two concurrent attaches for the same tab cannot both spawn. That is the per-session
 * mutex an idempotent attach needs, and it holds only while there is no `await` between the lookup and the
 * `terminals.set` inside `spawnForTab`. Pinned by `terminalManager.test.ts`.
 */
export function attachTerminal(
	workspaceId: string,
	tabKey: string,
	clientKey: string,
	options: { title?: string; cols?: number; rows?: number } = {},
): AttachResult {
	const tabs = tabsFor(workspaceId);
	const isNewTab = !tabs.some((tab) => tab.tabKey === tabKey);
	if (isNewTab) {
		tabs.push({ tabKey, title: options.title ?? `Terminal ${tabs.length + 1}` });
	}

	const index = tabIndex(workspaceId, tabKey);
	const existingId = ptyByTab.get(index);
	const existing = existingId === undefined ? undefined : terminals.get(existingId);

	if (existing && existingId) {
		// Exclusive attach: a PTY has one size, so the newcomer becomes the recipient and whoever held it is told
		// rather than silently reflowed out from under (tmux's smallest-client rule, its worst-liked behaviour).
		if (existing.attachedClient && existing.attachedClient !== clientKey) {
			const push: TerminalDetachedPush = { workspaceId, tabKey };
			pushToClient(existing.attachedClient, WS_CHANNELS.terminalDetached, push);
		}
		existing.attachedClient = clientKey;
		if (options.cols !== undefined && options.rows !== undefined) {
			existing.pty.resize(options.cols, options.rows);
		}
		const replay = existing.recorder.snapshot();
		// The replay already shows everything the batcher is holding, so delivering that afterwards would paint
		// the same bytes twice. Discard rather than resume.
		existing.output.reset();
		return { id: existingId, created: false, ...(replay ? { replay } : {}) };
	}

	// A revived tab paints what its predecessor left behind; the shell underneath is genuinely new.
	const revived = pendingReplay.get(index);
	pendingReplay.delete(index);
	const { id, entry } = spawnForTab(workspaceId, tabKey, clientKey, options, revived);
	// Only a membership change is worth announcing — re-attaching to an existing tab leaves the list identical,
	// and broadcasting on every mount would fan out a snapshot per Project Home round trip.
	if (isNewTab) membershipChanged(workspaceId);
	const replay = entry.recorder.snapshot();
	return { id, created: true, ...(replay ? { replay } : {}) };
}

/** This workspace's tabs, in order — what the rail renders instead of keeping a list of its own. */
export function listTerminals(workspaceId: string): TerminalTabInfo[] {
	return tabsFor(workspaceId).map(({ tabKey, title }) => ({ tabKey, title }));
}

/**
 * The entry for `id`, but only if `caller` is the client currently attached to it.
 *
 * Attach is exclusive, so a client that has been taken over must not go on driving the shell — and it can try
 * to: the transport replays unresolved requests across a reconnect, so a keystroke queued before the takeover
 * can arrive after it and would otherwise execute in whoever holds the tab now. Reclaiming is an explicit
 * gesture ("Take it back" → a fresh attach), exactly as `tmux attach -d` and VS Code's window handoff work;
 * typing into a stale tab must never silently steal it back.
 */
function attachedEntry(id: string, caller: string): TerminalEntry | undefined {
	const entry = terminals.get(id);
	return entry?.attachedClient === caller ? entry : undefined;
}

/**
 * Tell a caller that tried to drive a terminal it is not attached to.
 *
 * `terminal.detached` is fire-and-forget, so the original notice can simply be lost — most plainly when the
 * displaced client was mid-reconnect during the takeover, since a reconnect then replays its attach and the
 * host's replay cache hands back the *cached* success. Without this the tab looks live forever while every
 * keystroke silently goes nowhere. Re-announcing on the first thing it tries makes that self-healing.
 */
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
	entry.pty.resize(cols, rows);
}

function disposeTerminalEntry(id: string, entry: TerminalEntry): void {
	// Delete first: bun-pty may report exit synchronously or later, and either way the callback sees this was an
	// intentional teardown rather than manufacturing a natural-exit completion for a tab we deliberately shut.
	terminals.delete(id);
	ptyByTab.delete(tabIndex(entry.workspaceId, entry.tabKey));
	entry.output.dispose();
	entry.recorder.dispose();
	entry.pty.kill();
}

export interface CloseTabResult {
	closed: boolean;
	/** The shell had child processes and `force` was not set, so nothing was killed. */
	busy: boolean;
}

/**
 * Close a tab and kill its shell — the only client-driven kill there is.
 *
 * Refuses a shell with child processes unless the user has confirmed, and does the check and the kill in the
 * same synchronous pass so nothing can start in between. Asking separately would let a `npm run dev` launched
 * between question and answer die unannounced, which is the whole harm being guarded against.
 */
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

/**
 * Try again to deliver output held back while the attached client was unreachable — called when it reconnects,
 * so the gap in its scrollback closes instead of being lost for good.
 */
export function resumeClientTerminals(clientKey: string): void {
	for (const entry of terminals.values()) {
		if (entry.attachedClient === clientKey) entry.output.resume();
	}
	// Then ordered natural completions. If live output consumed the socket's remaining capacity, the publisher
	// reports unavailable and this queue simply waits for the next drain.
	completions.resume(clientKey);
}

/**
 * Kill every PTY rooted in a workspace and forget its tabs — called when the workspace is archived so no shell
 * process orphans on a now-deleted worktree dir.
 */
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

/** Kill every live PTY — called on host shutdown so no shell processes orphan. */
export function closeAllTerminals(): void {
	for (const [id, entry] of terminals) disposeTerminalEntry(id, entry);
	completions.clear();
}

/**
 * Write every workspace's tabs and their recorded output to disk, so a host restart can give the tabs back.
 *
 * Only the picture is saved. A host restart kills every shell — `pi` runs in-process and the kernel hangs up
 * each PTY regardless — so there is nothing to reattach to, and persisting a PTY id would invite attaching to
 * one that outlived its process (Theia's `Couldn't attach - can't find terminal with id`). This is VS Code's
 * *process revive*, not *process reconnection*.
 */
export function persistTerminalSessions(): void {
	const sessions: PersistedTerminalSessions = {};
	for (const [workspaceId, tabs] of tabsByWorkspace) {
		if (tabs.length === 0) continue;
		sessions[workspaceId] = tabs.map(({ tabKey, title }) => {
			const index = tabIndex(workspaceId, tabKey);
			const id = ptyByTab.get(index);
			const entry = id === undefined ? undefined : terminals.get(id);
			// A tab whose shell already exited keeps whatever it was revived with, so a restart does not blank a
			// terminal the user had not got round to closing.
			const recorded = entry ? entry.recorder.snapshot() : pendingReplay.get(index);
			return { tabKey, title, ...(recorded ? { recorded } : {}) };
		});
	}
	saveTerminalSessions(sessions);
}

/**
 * Restore the tab lists from disk at boot. Shells are not restored — each tab gets a fresh one on first attach,
 * showing its predecessor's recorded output so the screen is not simply blank.
 *
 * An unclean exit has nothing to read and restores nothing, which is the honest degradation rather than a
 * special case.
 */
export function reviveTerminalSessions(): void {
	for (const [workspaceId, tabs] of Object.entries(loadTerminalSessions())) {
		if (!Array.isArray(tabs)) continue;
		const restored: TabRecord[] = [];
		for (const tab of tabs) {
			if (typeof tab?.tabKey !== "string" || tab.tabKey === "") continue;
			restored.push({ tabKey: tab.tabKey, title: tab.title ?? "Terminal" });
			if (typeof tab.recorded === "string" && tab.recorded !== "") {
				pendingReplay.set(tabIndex(workspaceId, tab.tabKey), tab.recorded);
			}
		}
		if (restored.length > 0) tabsByWorkspace.set(workspaceId, restored);
	}
}

/** Drop all in-memory terminal state. Test seam — production tears down through `closeAllTerminals`. */
export function resetTerminalState(): void {
	closeAllTerminals();
	terminals.clear();
	ptyByTab.clear();
	tabsByWorkspace.clear();
	pendingReplay.clear();
}
