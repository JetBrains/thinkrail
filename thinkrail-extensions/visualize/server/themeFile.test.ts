import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THEME_CSS, THEME_FILE_NAME, writeThemeFile } from "./themeFile";

const SCRATCH = ".thinkrail/context/mockups/";
let cwd = "";

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "theme-file-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("writeThemeFile", () => {
	test("embeds the generated semantic tokens for light and dark", () => {
		expect(THEME_CSS).toContain("--text-default:");
		expect(THEME_CSS).toContain("--container-workspace-bg:");
		expect(THEME_CSS).toContain("@media (prefers-color-scheme: dark)");
	});

	test("creates the mockup directory inside the seeded context dir and writes the file", async () => {
		mkdirSync(join(cwd, ".thinkrail/context"), { recursive: true });
		expect(await writeThemeFile({ cwd, scratchDir: SCRATCH })).toBe("written");
		expect(readFileSync(join(cwd, SCRATCH, THEME_FILE_NAME), "utf8")).toBe(THEME_CSS);
	});

	test("skips a workspace whose context dir the host never seeded", async () => {
		expect(await writeThemeFile({ cwd, scratchDir: SCRATCH })).toBe("skipped");
		expect(existsSync(join(cwd, ".thinkrail"))).toBe(false);
	});

	test("leaves an identical file untouched and rewrites a stale one", async () => {
		mkdirSync(join(cwd, ".thinkrail/context"), { recursive: true });
		const path = join(cwd, SCRATCH, THEME_FILE_NAME);
		await writeThemeFile({ cwd, scratchDir: SCRATCH });
		utimesSync(path, new Date(0), new Date(0));
		expect(await writeThemeFile({ cwd, scratchDir: SCRATCH })).toBe("unchanged");
		expect(statSync(path).mtimeMs).toBe(0);
		writeFileSync(path, "/* edited */");
		expect(await writeThemeFile({ cwd, scratchDir: SCRATCH })).toBe("written");
		expect(readFileSync(path, "utf8")).toBe(THEME_CSS);
	});

	test("refuses a scratch directory that links outside the workspace", async () => {
		const outside = mkdtempSync(join(tmpdir(), "theme-outside-"));
		try {
			mkdirSync(join(cwd, ".thinkrail/context"), { recursive: true });
			symlinkSync(outside, join(cwd, ".thinkrail/context/mockups"));
			await expect(writeThemeFile({ cwd, scratchDir: SCRATCH })).rejects.toThrow(
				/not a real directory/,
			);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});

	test("creates nothing through a symlinked ancestor", async () => {
		const outside = mkdtempSync(join(tmpdir(), "theme-outside-"));
		try {
			mkdirSync(join(outside, "context"));
			symlinkSync(outside, join(cwd, ".thinkrail"));
			await expect(writeThemeFile({ cwd, scratchDir: SCRATCH })).rejects.toThrow(
				/not a real directory/,
			);
			expect(existsSync(join(outside, "context", "mockups"))).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
