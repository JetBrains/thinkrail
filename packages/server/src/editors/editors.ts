import type { EditorInfo } from "@thinkrail/contracts";

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

export type WhichFn = (bin: string) => string | null;

export const defaultWhich: WhichFn = (bin) =>
	Bun.which(bin, { PATH: process.env.PATH ?? "" }) ?? null;

export type SpawnFn = (cmd: string[]) => void;

export const defaultSpawn: SpawnFn = (cmd) => {
	Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
};

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
