import { randomUUID } from "node:crypto";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { type IPty, spawn } from "bun-pty";
import { loadWorkspaces } from "../persistence";

type Publish = (channel: string, data: unknown) => void;

interface TerminalEntry {
	pty: IPty;
	workspaceId: string;
}

const terminals = new Map<string, TerminalEntry>();

/** Push terminal output to subscribed clients. Set by `createServer` once the WS server exists. */
let publish: Publish = () => {};
export function setTerminalPublisher(fn: Publish): void {
	publish = fn;
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
	terminals.set(id, { pty, workspaceId });
	pty.onData((data) => publish(WS_CHANNELS.terminalData, { id, data }));
	pty.onExit(() => terminals.delete(id));
	return { id };
}

export function writeTerminal(id: string, data: string): void {
	terminals.get(id)?.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
	terminals.get(id)?.pty.resize(cols, rows);
}

export function closeTerminal(id: string): void {
	const entry = terminals.get(id);
	if (!entry) return;
	entry.pty.kill();
	terminals.delete(id);
}

/** Kill every live PTY — called on host shutdown so no shell processes orphan. */
export function closeAllTerminals(): void {
	for (const { pty } of terminals.values()) pty.kill();
	terminals.clear();
}

/**
 * Kill every PTY rooted in a workspace — called when the workspace is archived so no shell process
 * orphans on a now-deleted worktree dir.
 */
export function closeWorkspaceTerminals(workspaceId: string): void {
	for (const [id, entry] of terminals) {
		if (entry.workspaceId !== workspaceId) continue;
		entry.pty.kill();
		terminals.delete(id);
	}
}
