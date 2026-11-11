import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
	listAvailableEditors,
	openEditor,
	pathWhich,
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
	test("nothing installed → empty list", async () => {
		expect(await listAvailableEditors(whichOnly())).toEqual([]);
	});

	test("names only what's actually on PATH, in candidate order", async () => {
		const editors = await listAvailableEditors(whichOnly("code", "vim"));
		expect(editors).toEqual([
			{ id: "vscode", label: "VS Code", kind: "gui" },
			{ id: "vim", label: "Vim", kind: "terminal" },
		]);
	});

	test("JetBrains: no single binary — the first installed launcher in priority order wins, labeled for its product", async () => {
		expect(await listAvailableEditors(whichOnly("pycharm", "goland"))).toEqual([
			{ id: "jetbrains", label: "PyCharm", kind: "gui" },
		]);
	});

	test("JetBrains: idea outranks webstorm when both are installed", async () => {
		expect(await listAvailableEditors(whichOnly("webstorm", "idea"))).toEqual([
			{ id: "jetbrains", label: "IntelliJ IDEA", kind: "gui" },
		]);
	});
});

describe("openEditor", () => {
	test("throws for an unknown id", async () => {
		await expect(
			openEditor("nonexistent", "/tmp/wt", whichOnly(), recordingSpawn),
		).rejects.toThrow();
	});

	test("throws for the terminal-kind Vim — the client must run it in an embedded terminal instead", async () => {
		await expect(openEditor("vim", "/tmp/wt", whichOnly("vim"), recordingSpawn)).rejects.toThrow();
	});

	test("throws when the editor is no longer on PATH (uninstalled after the list was fetched)", async () => {
		await expect(openEditor("vscode", "/tmp/wt", whichOnly(), recordingSpawn)).rejects.toThrow();
	});

	test("resolves jetbrains to whichever product is actually installed, not a fixed binary, and launches it at the worktree path", async () => {
		spawnCalls.length = 0;
		await openEditor("jetbrains", "/tmp/wt", whichOnly("clion"), recordingSpawn);
		expect(spawnCalls).toEqual([["/usr/bin/clion", "/tmp/wt"]]);
	});
});

describe("pathWhich", () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-path-"));

	function dirWith(name: string, files: { name: string; executable?: boolean }[]): string {
		const dir = join(root, name);
		mkdirSync(dir, { recursive: true });
		for (const file of files) {
			const fileName = process.platform === "win32" ? `${file.name}.cmd` : file.name;
			writeFileSync(join(dir, fileName), "", { mode: file.executable === false ? 0o644 : 0o755 });
		}
		return dir;
	}

	const empty = dirWith("empty", []);
	const first = dirWith("first", [{ name: "code" }, { name: "emacs", executable: false }]);
	const second = dirWith("second", [{ name: "code" }, { name: "emacs" }, { name: "webstorm" }]);
	const lookalike = dirWith("lookalike", [{ name: "vimdiff" }, { name: "codex" }]);
	const unlistable = dirWith("unlistable", [{ name: "idea" }]);
	chmodSync(unlistable, 0o111);
	afterAll(() => {
		chmodSync(unlistable, 0o755);
		rmSync(root, { recursive: true, force: true });
	});
	const notADir = join(first, process.platform === "win32" ? "code.cmd" : "code");
	const searchPath = [
		empty,
		join(root, "missing"),
		notADir,
		"",
		first,
		lookalike,
		unlistable,
		second,
	].join(delimiter);

	test("resolves every candidate exactly as a full Bun.which PATH search would", async () => {
		const which = await pathWhich(["code", "emacs", "webstorm", "vim", "idea"], searchPath);
		for (const bin of ["code", "emacs", "webstorm", "vim", "idea"]) {
			expect(which(bin)).toBe(Bun.which(bin, { PATH: searchPath }) ?? null);
		}
		expect(which("code")).not.toBeNull();
		expect(which("webstorm")).not.toBeNull();
		expect(which("idea")).not.toBeNull();
	});

	test("reads PATH asynchronously, letting other work run before it settles", async () => {
		let otherWorkRan = false;
		setImmediate(() => {
			otherWorkRan = true;
		});
		await pathWhich(["code"], Array.from({ length: 32 }, () => second).join(delimiter));
		expect(otherWorkRan).toBe(true);
	});

	test("concurrent editor.list callers share one PATH scan of the live PATH", async () => {
		const savedPath = process.env.PATH;
		process.env.PATH = searchPath;
		try {
			const pending = listAvailableEditors();
			expect(listAvailableEditors()).toBe(pending);
			expect(await pending).toEqual([
				{ id: "vscode", label: "VS Code", kind: "gui" },
				{ id: "emacs", label: "Emacs", kind: "gui" },
				{ id: "jetbrains", label: "IntelliJ IDEA", kind: "gui" },
			]);
			const next = listAvailableEditors();
			expect(next).not.toBe(pending);
			await next;
		} finally {
			process.env.PATH = savedPath;
		}
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
