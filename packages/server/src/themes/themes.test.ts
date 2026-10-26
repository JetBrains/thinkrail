import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_THEME_FILE_BYTES, readUserThemes, watchUserThemes } from "./themes";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-themes-"));
	dirs.push(dir);
	return dir;
}

test("a missing folder reads as no files", () => {
	expect(readUserThemes(join(tempDir(), "absent")).files).toEqual([]);
});

test("theme files report their raw JSON; broken files report a code without blocking others", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "ocean.theme.json"), JSON.stringify({ id: "ocean" }));
	writeFileSync(join(dir, "broken.theme.json"), "{ not json");
	writeFileSync(join(dir, "huge.theme.json"), `"${"x".repeat(MAX_THEME_FILE_BYTES)}"`);
	writeFileSync(join(dir, "notes.json"), "{}");
	writeFileSync(join(dir, ".hidden.theme.json"), "{}");
	const { files } = readUserThemes(dir);
	expect(files.map((file) => file.fileName)).toEqual([
		"broken.theme.json",
		"huge.theme.json",
		"ocean.theme.json",
	]);
	expect(files[0]).toMatchObject({ ok: false, error: "invalid-json" });
	expect(files[0]?.ok === false && files[0].detail).toBeTruthy();
	expect(files[1]).toMatchObject({ ok: false, error: "too-large" });
	expect(files[2]).toEqual({ fileName: "ocean.theme.json", ok: true, manifest: { id: "ocean" } });
});

test("the watcher creates the folder and nudges once per burst", async () => {
	const poll = 50;
	const dir = join(tempDir(), "themes");
	let nudges = 0;
	const stop = watchUserThemes({ dir, onChange: () => nudges++, intervalMs: poll });
	try {
		expect(existsSync(dir)).toBe(true);
		await Bun.sleep(poll * 2);
		expect(nudges).toBe(0);
		writeFileSync(join(dir, "ocean.theme.json"), "{}");
		writeFileSync(join(dir, "ocean.theme.json"), '{"id":"ocean"}');
		await Bun.sleep(poll * 4);
		expect(nudges).toBe(1);
	} finally {
		stop();
	}
});
