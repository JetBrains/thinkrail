import { existsSync, lstatSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { delimiter, dirname, win32 } from "node:path";
import { pathToFileURL } from "node:url";
import type { EditorInfo } from "@thinkrail/contracts";
import { spawnDetached } from "@thinkrail/shared/spawn";

interface GuiCandidate {
	id: string;
	label: string;
	bin: string;
}

const GUI_CANDIDATES: GuiCandidate[] = [
	{ id: "vscode", label: "VS Code", bin: "code" },
	{ id: "emacs", label: "Emacs", bin: "emacs" },
];

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

const TERMINAL_CANDIDATE = { id: "vim", label: "Vim", bin: "vim" };

const EDITOR_BINS = [...GUI_CANDIDATES, ...JETBRAINS_CANDIDATES, TERMINAL_CANDIDATE].map(
	(candidate) => candidate.bin,
);

const PATH_SCAN_CONCURRENCY = 8;

export type WhichFn = (bin: string) => string | null;

type ListDirFn = (dir: string) => Promise<string[]>;

const listDirEntries: ListDirFn = (dir) => readdir(dir);

async function binsListedIn(
	dir: string,
	bins: readonly string[],
	listDir: ListDirFn,
): Promise<Set<string> | null> {
	let entries: string[];
	try {
		entries = await listDir(dir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? new Set() : null;
	}
	const listed = new Set<string>();
	for (const entry of entries) {
		const name = entry.toLowerCase();
		for (const bin of bins) if (name === bin || name.startsWith(`${bin}.`)) listed.add(bin);
	}
	return listed;
}

export async function pathWhich(
	bins: readonly string[],
	searchPath: string = process.env.PATH ?? "",
	listDir: ListDirFn = listDirEntries,
): Promise<WhichFn> {
	const names = bins.map((bin) => bin.toLowerCase());
	const dirs = searchPath.split(delimiter).filter(Boolean);
	const listed: (Set<string> | null)[] = dirs.map(() => null);
	let next = 0;
	const scan = async () => {
		while (next < dirs.length) {
			const index = next++;
			listed[index] = await binsListedIn(dirs[index] ?? "", names, listDir);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PATH_SCAN_CONCURRENCY, dirs.length) }, scan));
	return (bin) => {
		const name = bin.toLowerCase();
		const candidates = dirs.filter((_, index) => listed[index]?.has(name) ?? true);
		if (candidates.length === 0) return null;
		return Bun.which(bin, { PATH: candidates.join(delimiter) }) ?? null;
	};
}

export type SpawnFn = (
	cmd: string[],
	options?: { windowsHide?: boolean; windowsVerbatimArguments?: boolean },
) => void;

export const defaultSpawn: SpawnFn = (cmd, options) => {
	if (!spawnDetached(cmd, options)) throw new Error("Failed to launch the requested application");
};

let discovery: Promise<EditorInfo[]> | null = null;

export function listAvailableEditors(which?: WhichFn): Promise<EditorInfo[]> {
	if (which) return Promise.resolve(editorsOnPath(which));
	discovery ??= pathWhich(EDITOR_BINS)
		.then(editorsOnPath)
		.finally(() => {
			discovery = null;
		});
	return discovery;
}

function editorsOnPath(which: WhichFn): EditorInfo[] {
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

export async function openEditor(
	editorId: string,
	worktreePath: string,
	which?: WhichFn,
	spawn: SpawnFn = defaultSpawn,
): Promise<void> {
	const bin = resolveGuiBin(editorId, which ?? (await pathWhich(EDITOR_BINS)));
	if (!bin) throw new Error(`"${editorId}" isn't installed on this host`);
	spawn([bin, worktreePath]);
}

export function revealInFileManager(
	worktreePath: string,
	spawn: SpawnFn = defaultSpawn,
	platform: NodeJS.Platform = process.platform,
): void {
	if (!existsSync(worktreePath)) throw new Error(`Folder not found: ${worktreePath}`);
	const cmd =
		platform === "darwin"
			? ["open", worktreePath]
			: platform === "win32"
				? ["explorer", win32.normalize(worktreePath)]
				: ["xdg-open", worktreePath];
	launchFileManager(cmd, spawn, platform);
}

// FileManager1.ShowItems selects the item in Nautilus, Dolphin, Nemo and others; a desktop without
// that D-Bus service gets the parent folder opened instead. The URI and the folder arrive as
// positional arguments, never spliced into the script.
const LINUX_SELECT_SCRIPT =
	'gdbus call --session --dest org.freedesktop.FileManager1 --object-path /org/freedesktop/FileManager1 --method org.freedesktop.FileManager1.ShowItems "[\'$1\']" "" >/dev/null 2>&1 || exec xdg-open "$2"';

/** Opens the folder holding `path` with `path` selected in it. A dangling symlink is still selectable. */
export function selectInFileManager(
	path: string,
	spawn: SpawnFn = defaultSpawn,
	platform: NodeJS.Platform = process.platform,
): void {
	if (!entryExists(path)) throw new Error(`Path not found: ${path}`);
	if (platform === "win32") {
		launchFileManager(explorerSelect(path), spawn, platform, { windowsVerbatimArguments: true });
		return;
	}
	const cmd =
		platform === "darwin"
			? ["open", "-R", path]
			: ["sh", "-c", LINUX_SELECT_SCRIPT, "sh", linuxItemUri(path), dirname(path)];
	launchFileManager(cmd, spawn, platform);
}

// Explorer splits its command line on commas, so `a,b.txt` unquoted would hand it a second object to
// open. The object is quoted here and passed verbatim (no runtime re-quoting), the documented
// `/select,"<path>"` form. A Windows path cannot contain `"`; one that does is refused, not escaped.
function explorerSelect(path: string): string[] {
	const target = win32.normalize(path);
	if (target.includes('"')) throw new Error(`Can't reveal a path containing a quote: ${path}`);
	return ["explorer", `/select,"${target}"`];
}

// A quote would end the GVariant string the URI sits in, and pathToFileURL leaves quotes as they are.
function linuxItemUri(path: string): string {
	return pathToFileURL(path).href.replaceAll("'", "%27");
}

function entryExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

function launchFileManager(
	cmd: string[],
	spawn: SpawnFn,
	platform: NodeJS.Platform,
	options: { windowsVerbatimArguments?: boolean } = {},
): void {
	try {
		spawn(cmd, { windowsHide: false, ...options });
	} catch {
		throw new Error(`No file manager launcher available on this host (${platform}).`);
	}
}
