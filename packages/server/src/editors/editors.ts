// Host-installed editor/IDE integration for the workspace row's "Open in" menu: detect what's actually on
// PATH (so the menu never offers a dead entry), launch a GUI one detached at a worktree, or reveal a
// worktree in the host's file manager. Vim has no GUI window of its own — the client runs it in that
// workspace's embedded terminal instead of asking this module to launch it (see `EditorInfo.kind`).

import type { EditorInfo } from "@thinkrail/contracts";

/** A candidate binary this module knows how to detect + launch. */
interface GuiCandidate {
	id: string;
	label: string;
	bin: string;
}

const GUI_CANDIDATES: GuiCandidate[] = [
	{ id: "vscode", label: "VS Code", bin: "code" },
	{ id: "emacs", label: "Emacs", bin: "emacs" },
];

/**
 * JetBrains ships one launcher shim per product (Toolbox creates `idea`/`webstorm`/… on PATH) — there is
 * no single "jetbrains" binary. Checked in this priority order; the first one found on the host becomes
 * the menu's single "jetbrains" entry, labeled for whichever product it actually is.
 */
const JETBRAINS_CANDIDATES: { label: string; bin: string }[] = [
	{ label: "IntelliJ IDEA", bin: "idea" },
	{ label: "WebStorm", bin: "webstorm" },
	{ label: "PyCharm", bin: "pycharm" },
	{ label: "GoLand", bin: "goland" },
	{ label: "Rider", bin: "rider" },
	{ label: "CLion", bin: "clion" },
	{ label: "PhpStorm", bin: "phpstorm" },
	{ label: "RubyMine", bin: "rubymine" },
];

const JETBRAINS_ID = "jetbrains";

/** Vim needs a TTY — no GUI window to spawn detached, so it's `kind: "terminal"` (see `EditorInfo`). */
const TERMINAL_CANDIDATE = { id: "vim", label: "Vim", bin: "vim" };

/** A `Bun.which` lookup, injectable so tests can fake which binaries "exist" without touching real PATH. */
export type WhichFn = (bin: string) => string | null;

// `Bun.which(bin)` with no options reads the PATH snapshotted at process start, not the live
// `process.env.PATH` — `resolveShellEnv()` re-resolves PATH at boot, so an unqualified call would miss it.
export const defaultWhich: WhichFn = (bin) =>
	Bun.which(bin, { PATH: process.env.PATH ?? "" }) ?? null;

/** A detached-launch primitive, injectable so tests can assert a launch without actually spawning. */
export type SpawnFn = (cmd: string[]) => void;

export const defaultSpawn: SpawnFn = (cmd) => {
	Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
};

/** The editors this host actually has installed, for the "Open in" menu. */
export function listAvailableEditors(which: WhichFn = defaultWhich): EditorInfo[] {
	const editors: EditorInfo[] = [];
	for (const c of GUI_CANDIDATES) {
		if (which(c.bin)) editors.push({ id: c.id, label: c.label, kind: "gui" });
	}
	const jetbrains = JETBRAINS_CANDIDATES.find((c) => which(c.bin));
	if (jetbrains) editors.push({ id: JETBRAINS_ID, label: jetbrains.label, kind: "gui" });
	if (which(TERMINAL_CANDIDATE.bin)) {
		editors.push({ id: TERMINAL_CANDIDATE.id, label: TERMINAL_CANDIDATE.label, kind: "terminal" });
	}
	return editors;
}

/** Resolve a GUI `EditorInfo.id` to its actual binary, re-checking PATH (a race with an uninstall/list is
 * cheap insurance, not the common case). `null` when unknown or no longer installed. */
function resolveGuiBin(editorId: string, which: WhichFn): string | null {
	const simple = GUI_CANDIDATES.find((c) => c.id === editorId);
	if (simple) return which(simple.bin);
	if (editorId === JETBRAINS_ID) {
		for (const c of JETBRAINS_CANDIDATES) {
			const bin = which(c.bin);
			if (bin) return bin;
		}
		return null;
	}
	return null;
}

/**
 * Launch a GUI editor (an `EditorInfo.id` with `kind: "gui"`) detached at `worktreePath`. Throws when the
 * id is unknown, is the `"terminal"`-kind Vim (the client must not call this for it), or is no longer on
 * PATH — the caller surfaces that as an error toast, same as every other host action.
 */
export function openEditor(
	editorId: string,
	worktreePath: string,
	which: WhichFn = defaultWhich,
	spawn: SpawnFn = defaultSpawn,
): void {
	const bin = resolveGuiBin(editorId, which);
	if (!bin) throw new Error(`"${editorId}" isn't installed on this host`);
	spawn([bin, worktreePath]);
}

/** Open the host's file manager at `worktreePath` — Finder (macOS), Explorer (Windows), or the Linux
 * desktop's default handler via `xdg-open`. */
export function revealInFileManager(
	worktreePath: string,
	spawn: SpawnFn = defaultSpawn,
	platform: NodeJS.Platform = process.platform,
): void {
	const cmd =
		platform === "darwin"
			? ["open", worktreePath]
			: platform === "win32"
				? ["explorer", worktreePath]
				: ["xdg-open", worktreePath];
	try {
		spawn(cmd);
	} catch {
		throw new Error(`No file manager launcher available on this host (${platform}).`);
	}
}
