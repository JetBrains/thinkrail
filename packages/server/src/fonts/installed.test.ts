import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoundedRun } from "../subprocess";
import {
	INSTALLED_FONTS_FIXTURE_ENV,
	installedFontsQuery,
	listInstalledFonts,
	normalizeInstalledFamilies,
	parseFcList,
	parseMacFamilies,
	parseWindowsFamilies,
} from "./installed";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-installed-fonts-"));
	dirs.push(dir);
	const path = join(dir, "installed-fonts.json");
	writeFileSync(path, content);
	return path;
}

function ran(outcome: Partial<BoundedRun>): () => Promise<BoundedRun> {
	return async () => ({
		ok: true,
		out: "",
		err: "",
		timedOut: false,
		launchFailed: false,
		waitedMs: 1,
		...outcome,
	});
}

describe("parsers", () => {
	test("fc-list: one face per line, hinting monospace from fontconfig's mono and charcell spacing", () => {
		const stdout = [
			"DejaVu Sans Mono\t100",
			"DejaVu Sans\t",
			"Droid Sans\t90",
			"xos4 Terminus\t110",
			"No Tab Family",
			"",
		].join("\n");
		expect(parseFcList(stdout)).toEqual([
			{ name: "DejaVu Sans Mono", monospaceHint: true },
			{ name: "DejaVu Sans", monospaceHint: false },
			{ name: "Droid Sans", monospaceHint: false },
			{ name: "xos4 Terminus", monospaceHint: true },
			{ name: "No Tab Family", monospaceHint: false },
		]);
	});

	test("macOS: the JXA script's JSON list", () => {
		expect(
			parseMacFamilies('[{"name":"Menlo","monospaceHint":true},{"name":"Helvetica Neue"}]\n'),
		).toEqual([
			{ name: "Menlo", monospaceHint: true },
			{ name: "Helvetica Neue", monospaceHint: false },
		]);
		expect(() => parseMacFamilies('{"name":"Menlo"}')).toThrow();
		expect(() => parseMacFamilies("[1]")).toThrow();
	});

	test("Windows: ConvertTo-Json's list of names, no monospace hint", () => {
		expect(
			parseWindowsFamilies('["Consolas","Segoe UI","\\u30e1\\u30a4\\u30ea\\u30aa"]\r\n'),
		).toEqual([
			{ name: "Consolas", monospaceHint: false },
			{ name: "Segoe UI", monospaceHint: false },
			{ name: "メイリオ", monospaceHint: false },
		]);
		expect(() => parseWindowsFamilies('"Consolas"')).toThrow();
		expect(() => parseWindowsFamilies("")).toThrow();
	});

	test("normalization trims, drops hidden and unusable names, merges duplicates and sorts", () => {
		expect(
			normalizeInstalledFamilies([
				{ name: " zeta ", monospaceHint: false },
				{ name: ".SF NS", monospaceHint: false },
				{ name: "", monospaceHint: true },
				{ name: 'Bad"Name', monospaceHint: false },
				{ name: "Noto Color Emoji", monospaceHint: false },
				{ name: "Alpha", monospaceHint: false },
				{ name: "noto color emoji", monospaceHint: true },
				{ name: "beta", monospaceHint: false },
			]),
		).toEqual([
			{ name: "Alpha", monospaceHint: false },
			{ name: "beta", monospaceHint: false },
			{ name: "Noto Color Emoji", monospaceHint: true },
			{ name: "zeta", monospaceHint: false },
		]);
	});
});

describe("the per-platform query", () => {
	test("Linux asks fontconfig for each face's first family and spacing", () => {
		expect(installedFontsQuery("linux").argv).toEqual([
			"fc-list",
			"-f",
			"%{family[0]}\\t%{spacing}\\n",
		]);
	});

	test("macOS runs a JXA script over NSFontManager", () => {
		const { argv } = installedFontsQuery("darwin");
		expect(argv.slice(0, 4)).toEqual(["osascript", "-l", "JavaScript", "-e"]);
		expect(argv[4]).toContain("NSFontManager.sharedFontManager");
		expect(argv[4]).toContain("availableMembersOfFontFamily");
		expect(argv[4]).toContain("0x400");
	});

	test("Windows runs an encoded PowerShell script over the installed font collection", () => {
		const { argv } = installedFontsQuery("win32");
		expect(argv.slice(0, 4)).toEqual([
			"powershell.exe",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
		]);
		const script = Buffer.from(argv[4] ?? "", "base64").toString("utf16le");
		expect(script).toContain("[System.Drawing.Text.InstalledFontCollection]::new().Families");
		expect(script).toContain("ConvertTo-Json -InputObject $names");
		expect(script).toContain("[regex]::Replace($json, '[^\\x00-\\x7F]'");
	});
});

describe("listInstalledFonts", () => {
	test("normalizes what the OS font service printed", async () => {
		const result = await listInstalledFonts({
			platform: "linux",
			env: {},
			run: ran({ out: "Fira Code\t100\nArial\t\nFira Code\t\n" }),
		});
		expect(result).toEqual({
			families: [
				{ name: "Arial", monospaceHint: false },
				{ name: "Fira Code", monospaceHint: true },
			],
		});
	});

	test("a missing tool, a failed run, a timeout or unreadable output is a coded failure", async () => {
		const cases: [Partial<BoundedRun>, string][] = [
			[
				{ ok: false, launchFailed: true, err: "ENOENT: no such file" },
				"fc-list could not be started",
			],
			[
				{ ok: false, err: "Fontconfig error: cannot load config\n" },
				"fc-list failed: Fontconfig error",
			],
			[{ ok: false, timedOut: true }, "fc-list did not answer within 15 s"],
		];
		for (const [outcome, message] of cases) {
			const failure = listInstalledFonts({ platform: "linux", env: {}, run: ran(outcome) });
			await expect(failure).rejects.toMatchObject({ code: "INSTALLED_FONTS_UNAVAILABLE" });
			await expect(failure).rejects.toThrow(message);
		}
		const garbled = listInstalledFonts({ platform: "darwin", env: {}, run: ran({ out: "oops" }) });
		await expect(garbled).rejects.toMatchObject({ code: "INSTALLED_FONTS_UNAVAILABLE" });
		await expect(garbled).rejects.toThrow("osascript printed output that could not be read");
	});

	test(`${INSTALLED_FONTS_FIXTURE_ENV} replaces the native query and is re-read per call`, async () => {
		const path = fixture('[{"name":"Fixture Mono","monospaceHint":true},{"name":"Fixture Sans"}]');
		const env = { [INSTALLED_FONTS_FIXTURE_ENV]: path };
		const run = () => Promise.reject(new Error("the native query must not run"));
		expect(await listInstalledFonts({ platform: "linux", env, run })).toEqual({
			families: [
				{ name: "Fixture Mono", monospaceHint: true },
				{ name: "Fixture Sans", monospaceHint: false },
			],
		});
		writeFileSync(path, JSON.stringify({ error: "Font service unavailable" }));
		const failure = listInstalledFonts({ platform: "linux", env, run });
		await expect(failure).rejects.toMatchObject({ code: "INSTALLED_FONTS_UNAVAILABLE" });
		await expect(failure).rejects.toThrow("Font service unavailable");
		writeFileSync(path, "{ not json");
		await expect(listInstalledFonts({ platform: "linux", env, run })).rejects.toThrow(
			"The installed-font fixture could not be read",
		);
	});
});
