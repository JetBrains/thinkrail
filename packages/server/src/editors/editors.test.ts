import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
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
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-reveal-"));
	const revealCalls: { cmd: string[]; options: { windowsHide?: boolean } | undefined }[] = [];
	const recordingReveal: SpawnFn = (cmd, options) => {
		revealCalls.push({ cmd, options });
	};
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("macOS: open", () => {
		revealCalls.length = 0;
		revealInFileManager(dir, recordingReveal, "darwin");
		expect(revealCalls.map((call) => call.cmd)).toEqual([["open", dir]]);
	});

	test("Windows: explorer, given backslash separators it can parse", () => {
		revealCalls.length = 0;
		revealInFileManager(dir.replaceAll("\\", "/"), recordingReveal, "win32");
		expect(revealCalls.map((call) => call.cmd)).toEqual([["explorer", win32.normalize(dir)]]);
		expect(revealCalls[0]?.cmd[1]).not.toContain("/");
	});

	test("Linux (and every other platform): xdg-open, the desktop's default handler", () => {
		revealCalls.length = 0;
		revealInFileManager(dir, recordingReveal, "linux");
		expect(revealCalls.map((call) => call.cmd)).toEqual([["xdg-open", dir]]);
	});

	test("launches the file manager with a visible window on every platform", () => {
		for (const platform of ["darwin", "win32", "linux"] as const) {
			revealCalls.length = 0;
			revealInFileManager(dir, recordingReveal, platform);
			expect(revealCalls[0]?.options).toEqual({ windowsHide: false });
		}
	});

	test("rejects a missing folder before launching anything", () => {
		revealCalls.length = 0;
		const missing = join(dir, "gone");
		expect(() => revealInFileManager(missing, recordingReveal, "win32")).toThrow(
			/Folder not found/,
		);
		expect(revealCalls).toEqual([]);
	});

	test("names the platform when no file manager launcher is available", () => {
		const throwingSpawn: SpawnFn = () => {
			throw new Error("ENOENT");
		};
		expect(() => revealInFileManager(dir, throwingSpawn, "linux")).toThrow(/linux/);
	});
});
