import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, win32 } from "node:path";
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

	test("waits on async directory reads, at most eight at a time, before settling", async () => {
		const releases: (() => void)[] = [];
		const listDir = (dir: string) =>
			new Promise<string[]>((resolve) => {
				releases.push(() => resolve(dir === second ? ["code"] : []));
			});
		const dirs = [...Array.from({ length: 11 }, (_, i) => join(root, `pending-${i}`)), second];
		const turn = () => new Promise((resolve) => setImmediate(resolve));
		let settled = false;
		const scan = pathWhich(["code"], dirs.join(delimiter), listDir).then((which) => {
			settled = true;
			return which;
		});

		await turn();
		expect(releases).toHaveLength(8);
		expect(settled).toBe(false);

		for (const release of releases.splice(0)) release();
		await turn();
		expect(releases).toHaveLength(4);
		expect(settled).toBe(false);

		for (const release of releases.splice(0)) release();
		await turn();
		expect(settled).toBe(true);
		const which = await scan;
		expect(which("code")).not.toBeNull();
		expect(which("code")).toBe(Bun.which("code", { PATH: second }) ?? null);
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
