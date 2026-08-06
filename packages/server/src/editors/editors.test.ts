import { describe, expect, test } from "bun:test";
import {
	listAvailableEditors,
	openEditor,
	revealInFileManager,
	type SpawnFn,
	type WhichFn,
} from "./editors";

const spawnCalls: string[][] = [];
const recordingSpawn: SpawnFn = (cmd) => {
	spawnCalls.push(cmd);
};

/** A fake `which`: resolves exactly the given bin names to themselves-as-a-path, everything else absent. */
function whichOnly(...installed: string[]): WhichFn {
	return (bin) => (installed.includes(bin) ? `/usr/bin/${bin}` : null);
}

describe("listAvailableEditors", () => {
	test("nothing installed → empty list", () => {
		expect(listAvailableEditors(whichOnly())).toEqual([]);
	});

	test("names only what's actually on PATH, in candidate order", () => {
		const editors = listAvailableEditors(whichOnly("code", "vim"));
		expect(editors).toEqual([
			{ id: "vscode", label: "VS Code", kind: "gui" },
			{ id: "vim", label: "Vim", kind: "terminal" },
		]);
	});

	test("JetBrains: no single binary — the first installed launcher in priority order wins, labeled for its product", () => {
		expect(listAvailableEditors(whichOnly("pycharm", "goland"))).toEqual([
			{ id: "jetbrains", label: "PyCharm", kind: "gui" },
		]);
	});

	test("JetBrains: idea outranks webstorm when both are installed", () => {
		expect(listAvailableEditors(whichOnly("webstorm", "idea"))).toEqual([
			{ id: "jetbrains", label: "IntelliJ IDEA", kind: "gui" },
		]);
	});
});

describe("openEditor", () => {
	test("throws for an unknown id", () => {
		expect(() => openEditor("nonexistent", "/tmp/wt", whichOnly(), recordingSpawn)).toThrow();
	});

	test("throws for the terminal-kind Vim — the client must run it in an embedded terminal instead", () => {
		expect(() => openEditor("vim", "/tmp/wt", whichOnly("vim"), recordingSpawn)).toThrow();
	});

	test("throws when the editor is no longer on PATH (uninstalled after the list was fetched)", () => {
		expect(() => openEditor("vscode", "/tmp/wt", whichOnly(), recordingSpawn)).toThrow();
	});

	test("resolves jetbrains to whichever product is actually installed, not a fixed binary, and launches it at the worktree path", () => {
		spawnCalls.length = 0;
		openEditor("jetbrains", "/tmp/wt", whichOnly("clion"), recordingSpawn);
		expect(spawnCalls).toEqual([["/usr/bin/clion", "/tmp/wt"]]);
	});
});

describe("revealInFileManager", () => {
	test("macOS: open", () => {
		spawnCalls.length = 0;
		revealInFileManager("/tmp/wt", recordingSpawn, "darwin");
		expect(spawnCalls).toEqual([["open", "/tmp/wt"]]);
	});

	test("Windows: explorer", () => {
		spawnCalls.length = 0;
		revealInFileManager("/tmp/wt", recordingSpawn, "win32");
		expect(spawnCalls).toEqual([["explorer", "/tmp/wt"]]);
	});

	test("Linux (and every other platform): xdg-open, the desktop's default handler", () => {
		spawnCalls.length = 0;
		revealInFileManager("/tmp/wt", recordingSpawn, "linux");
		expect(spawnCalls).toEqual([["xdg-open", "/tmp/wt"]]);
	});

	test("names the platform when no file manager launcher is available", () => {
		const throwingSpawn: SpawnFn = () => {
			throw new Error("ENOENT");
		};
		expect(() => revealInFileManager("/tmp/wt", throwingSpawn, "linux")).toThrow(/linux/);
	});
});
