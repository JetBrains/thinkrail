import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_LOCALE_FILE_BYTES, readLocalLocales, watchLocalLocales } from "./locales";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-locales-"));
	dirs.push(dir);
	return dir;
}

test("a missing folder reads as no files", () => {
	expect(readLocalLocales(join(tempDir(), "absent"))).toEqual({
		dir: expect.stringContaining("absent"),
		files: [],
	});
});

test("valid files report their strings; broken files report a code without blocking others", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "de.json"), JSON.stringify({ "desktop.menu.edit": "Bearbeiten" }));
	writeFileSync(join(dir, "fr.json"), "{ not json");
	writeFileSync(join(dir, "ja.json"), "[]");
	writeFileSync(join(dir, "my notes.json"), "{}");
	writeFileSync(join(dir, "README.md"), "ignored");
	writeFileSync(join(dir, ".hidden.json"), "{}");
	const { files } = readLocalLocales(dir);
	expect(files.map((file) => file.fileName)).toEqual([
		"de.json",
		"fr.json",
		"ja.json",
		"my notes.json",
	]);
	expect(files[0]).toEqual({
		fileName: "de.json",
		tag: "de",
		ok: true,
		strings: { "desktop.menu.edit": "Bearbeiten" },
	});
	expect(files[1]).toMatchObject({ tag: "fr", ok: false, error: "invalid-json" });
	expect(files[1]?.ok === false && files[1].detail).toBeTruthy();
	expect(files[2]).toMatchObject({ tag: "ja", ok: false, error: "not-object" });
	expect(files[3]).toMatchObject({ tag: null, ok: false, error: "invalid-name" });
});

test("oversize files and duplicate tags are reported", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "he.json"), "{}");
	writeFileSync(join(dir, "iw.json"), "{}");
	writeFileSync(join(dir, "it.json"), `{"a":"${"x".repeat(MAX_LOCALE_FILE_BYTES)}"}`);
	const { files } = readLocalLocales(dir);
	const byName = Object.fromEntries(files.map((file) => [file.fileName, file]));
	expect(byName["he.json"]).toMatchObject({ ok: true, tag: "he" });
	expect(byName["iw.json"]).toMatchObject({ ok: false, tag: "he", error: "duplicate" });
	expect(byName["it.json"]).toMatchObject({ ok: false, error: "too-large" });
});

const POLL = 50;

test("the watcher creates the folder and nudges once per burst", async () => {
	const dir = join(tempDir(), "locales");
	let nudges = 0;
	const stop = watchLocalLocales({ dir, onChange: () => nudges++, intervalMs: POLL });
	try {
		expect(existsSync(dir)).toBe(true);
		await Bun.sleep(POLL * 2);
		expect(nudges).toBe(0);
		writeFileSync(join(dir, "de.json"), "{}");
		writeFileSync(join(dir, "de.json"), '{"a":"b"}');
		await Bun.sleep(POLL * 4);
		expect(nudges).toBe(1);
		writeFileSync(join(dir, "de.json"), '{"a":"c"}');
		await Bun.sleep(POLL * 4);
		expect(nudges).toBe(2);
	} finally {
		stop();
	}
});

test("prototype-named keys stay data and never break a neighboring file", () => {
	const dir = tempDir();
	writeFileSync(
		join(dir, "de.json"),
		'{"constructor":"x","__proto__":"y","desktop.menu.edit":"Bearbeiten"}',
	);
	writeFileSync(join(dir, "fr.json"), '{"desktop.menu.edit":"Modifier"}');
	const { files } = readLocalLocales(dir);
	expect(files.map((file) => [file.fileName, file.ok])).toEqual([
		["de.json", true],
		["fr.json", true],
	]);
	const de = files[0];
	expect(de?.ok && de.strings["desktop.menu.edit"]).toBe("Bearbeiten");
	expect(Reflect.get(JSON.parse(JSON.stringify(de)).strings, "__proto__")).toBe("y");
});

test("the watcher survives the folder being deleted and recreated, without recreating it itself", async () => {
	const dir = join(tempDir(), "locales");
	let nudges = 0;
	const stop = watchLocalLocales({ dir, onChange: () => nudges++, intervalMs: POLL });
	try {
		writeFileSync(join(dir, "de.json"), "{}");
		await Bun.sleep(POLL * 4);
		const beforeDelete = nudges;
		rmSync(dir, { recursive: true, force: true });
		await Bun.sleep(POLL * 4);
		expect(existsSync(dir)).toBe(false);
		expect(nudges).toBeGreaterThan(beforeDelete);
		const afterDelete = nudges;
		mkdirSync(dir);
		writeFileSync(join(dir, "de.json"), '{"a":"1"}');
		await Bun.sleep(POLL * 4);
		expect(nudges).toBeGreaterThan(afterDelete);
	} finally {
		stop();
	}
});

test("the watcher survives its whole data folder being replaced while another watcher holds that path", async () => {
	const root = join(tempDir(), "data");
	const dir = join(root, "locales");
	let nudges = 0;
	const stop = watchLocalLocales({ dir, onChange: () => nudges++, intervalMs: POLL });
	const neighbor = watch(root, { persistent: false }, () => {});
	neighbor.on("error", () => {});
	try {
		await Bun.sleep(POLL * 2);
		rmSync(root, { recursive: true, force: true });
		mkdirSync(root);
		await Bun.sleep(1_500);
		mkdirSync(dir);
		writeFileSync(join(dir, "de.json"), '{"a":"1"}');
		await Bun.sleep(POLL * 4);
		const afterCreate = nudges;
		writeFileSync(join(dir, "de.json"), '{"a":"22"}');
		await Bun.sleep(POLL * 4);
		expect(nudges).toBeGreaterThan(afterCreate);
	} finally {
		neighbor.close();
		stop();
	}
});
