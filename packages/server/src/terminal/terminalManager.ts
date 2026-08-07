import { randomUUID } from "node:crypto";
import type { TerminalDataPush, TerminalExitPush } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { type IPty, spawn } from "bun-pty";
import { loadWorkspaces } from "../persistence";
import { createTerminalCompletionQueue } from "./completionQueue";
import {
	createOutputBatcher,
	type OutputBatcher,
	type TerminalDeliveryResult,
} from "./outputBatcher";

/** Push one addressed frame and report whether it was accepted and whether another may follow. */
type PushToClient = (clientKey: string, channel: string, data: unknown) => TerminalDeliveryResult;

interface TerminalEntry {
	pty: IPty;
	workspaceId: string;
	/** The client that owns this PTY — see `ownedEntry` for why a terminal is not shared. */
	clientKey: string;
	/** Groups this PTY's reads into whole frames instead of one frame per read. */
	output: OutputBatcher;
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
	/** Held only while the owner is away (mid-reconnect); past it the oldest output goes. */
	maxPendingChars: 1_048_576,
} as const;

const terminals = new Map<string, TerminalEntry>();

/**
 * Push terminal output to its owning client. Set by `createServer` once the WS server exists.
 *
 * Addressed rather than broadcast, deliberately: the host previously published every PTY's bytes to a single
 * topic that *every* socket subscribed to, leaving each browser to discard the ones that weren't its own. That
 * handed every connected client everything typed or printed in every terminal of every workspace — tokens,
 * keys, private paths — which matters all the more once the host is reachable from a phone over Tailscale.
 */
let pushToClient: PushToClient = () => "unavailable";
export function setTerminalPublisher(fn: PushToClient): void {
	pushToClient = fn;
}

/** Natural exits retain final output and their death notice as one ordered, reconnect-safe unit. */
const completions = createTerminalCompletionQueue((clientKey, channel, data) =>
	pushToClient(clientKey, channel, data),
);

/**
 * The entry for `id`, but only if `owner` may touch it. A PTY belongs to the client that created it: it holds
 * that client's shell, history and output, so another connection must not read it, write to it or kill it.
 *
 * An unknown id and someone else's id are deliberately indistinguishable, so a caller probing ids learns
 * nothing about which exist.
 */
function ownedEntry(id: string, owner: string): TerminalEntry | undefined {
	const entry = terminals.get(id);
	return entry?.clientKey === owner ? entry : undefined;
}

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
 * Spawn a PTY rooted in the workspace's worktree; its output streams on the `terminal.data` channel.
 *
 * `size` is the client's measured grid. Honouring it at spawn time matters because the shell prints its first
 * prompt immediately: born at the wrong size, that prompt is laid out for the wrong width and then reflowed
 * when the real size arrives a round trip later, which can visibly garble it.
 */
export function createTerminal(
	workspaceId: string,
	clientKey: string,
	size: { cols?: number; rows?: number } = {},
): { id: string } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const shell = process.env.SHELL ?? "/bin/bash";
	const pty = spawn(shell, [], {
		name: "xterm-256color",
		cwd: ws.worktreePath,
		cols: size.cols ?? DEFAULT_PTY_SIZE.cols,
		rows: size.rows ?? DEFAULT_PTY_SIZE.rows,
		env: ptyEnv(),
	});

	const id = randomUUID();
	// One frame per batch rather than per read, and output survives a brief reconnect: a batch the owner can't
	// take is kept and retried (see `resumeClientTerminals`) instead of vanishing.
	const output = createOutputBatcher({
		...OUTPUT_BATCH,
		onFlush: ({ data, truncated }) => {
			const push: TerminalDataPush = { id, data, truncated };
			return pushToClient(clientKey, WS_CHANNELS.terminalData, push);
		},
	});
	const entry: TerminalEntry = { pty, workspaceId, clientKey, output };
	terminals.set(id, entry);
	pty.onData((data) => output.push(data));
	// Tell the owner the shell is gone. Without this the tab stays looking alive — cursor blinking, keystrokes
	// accepted — while every one of them is written to a dead id and silently dropped.
	pty.onExit(({ exitCode }) => {
		// An intentional teardown deletes the entry before kill(), so its eventual exit callback is silent.
		if (terminals.get(id) !== entry) return;
		terminals.delete(id);
		const finalBatch = output.finish();
		const data: TerminalDataPush | undefined = finalBatch
			? { id, data: finalBatch.data, truncated: finalBatch.truncated }
			: undefined;
		const exit: TerminalExitPush = { id, exitCode };
		completions.enqueue(clientKey, { ...(data ? { data } : {}), exit });
	});
	return { id };
}

export function writeTerminal(id: string, data: string, owner: string): void {
	ownedEntry(id, owner)?.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number, owner: string): void {
	ownedEntry(id, owner)?.pty.resize(cols, rows);
}

/**
 * Whether `id` is a live PTY this client owns — what a re-attaching tab asks before presenting a detached shell
 * as still working. An id that died, or was never the caller's, answers the same: false.
 */
export function isTerminalAlive(id: string, owner: string): boolean {
	return ownedEntry(id, owner) !== undefined;
}

function disposeTerminalEntry(id: string, entry: TerminalEntry): void {
	// Delete first: bun-pty may report exit synchronously or later, and either way the callback sees this was an
	// intentional teardown rather than manufacturing a natural-exit completion for a tab we deliberately shut.
	terminals.delete(id);
	entry.output.dispose();
	entry.pty.kill();
}

export function closeTerminal(id: string, owner: string): void {
	const entry = ownedEntry(id, owner);
	if (entry) disposeTerminalEntry(id, entry);
}

/**
 * Try again to deliver output held back while a client was unreachable — called when it reconnects, so the gap
 * in its scrollback closes instead of being lost for good.
 */
export function resumeClientTerminals(clientKey: string): void {
	for (const entry of terminals.values()) {
		if (entry.clientKey === clientKey) entry.output.resume();
	}
	// Then ordered natural completions. If live output consumed the socket's remaining capacity, the publisher
	// reports unavailable and this queue simply waits for the next drain.
	completions.resume(clientKey);
}

/**
 * Kill every PTY owned by a client — called once its connection has been gone long enough to count as
 * abandoned (see `server.ts`), so a closed laptop or a killed tab doesn't leave shells running forever.
 *
 * Deliberately *not* called the moment a socket drops: the client reconnects on its own, and a shell holding
 * real work must survive a network hiccup. That is the whole reason ownership is keyed to a client id rather
 * than to a socket.
 */
export function closeClientTerminals(clientKey: string): void {
	// The client is gone for good, so there is nobody left to receive live output or natural completions.
	completions.clearClient(clientKey);
	for (const [id, entry] of terminals) {
		if (entry.clientKey === clientKey) disposeTerminalEntry(id, entry);
	}
}

/** Kill every live PTY — called on host shutdown so no shell processes orphan. */
export function closeAllTerminals(): void {
	for (const [id, entry] of terminals) disposeTerminalEntry(id, entry);
	completions.clear();
}

/**
 * Kill every PTY rooted in a workspace — called when the workspace is archived so no shell process
 * orphans on a now-deleted worktree dir.
 */
export function closeWorkspaceTerminals(workspaceId: string): void {
	for (const [id, entry] of terminals) {
		if (entry.workspaceId === workspaceId) disposeTerminalEntry(id, entry);
	}
}
