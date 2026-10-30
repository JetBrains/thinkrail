import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTestCollection, buildTestFont } from "./testFonts";
import {
	MAX_FONT_FILE_BYTES,
	MAX_FONT_FILES,
	readUserFonts,
	saveUserFont,
	watchUserFonts,
} from "./userFonts";

const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-fonts-"));
	dirs.push(dir);
	return dir;
}

function body(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
	return new Response(bytes).body ?? new ReadableStream();
}

test("a missing folder reads as no files", () => {
	expect(readUserFonts(join(tempDir(), "absent")).files).toEqual([]);
});

test("font files report their face and a versioned URL; unusable files report a code", () => {
	const dir = tempDir();
	writeFileSync(
		join(dir, "Mono Bold.TTF"),
		buildTestFont("ttf", { family: "Mono", weightClass: 700, fixedPitch: true }),
	);
	writeFileSync(join(dir, "inter.woff2"), buildTestFont("woff2", { typographicFamily: "Inter" }));
	writeFileSync(join(dir, "family.ttc"), buildTestCollection());
	writeFileSync(join(dir, "disguised.ttf"), buildTestCollection());
	writeFileSync(join(dir, "broken.otf"), "not a font");
	writeFileSync(join(dir, "notes.txt"), "x");
	writeFileSync(join(dir, ".hidden.ttf"), buildTestFont("ttf"));
	writeFileSync(join(dir, "odd:name.ttf"), buildTestFont("ttf"));
	mkdirSync(join(dir, "folder.woff"));
	const { files } = readUserFonts(dir);
	expect(files.map((file) => file.fileName)).toEqual([
		"Mono Bold.TTF",
		"broken.otf",
		"disguised.ttf",
		"family.ttc",
		"folder.woff",
		"inter.woff2",
	]);
	expect(files[0]).toEqual({
		fileName: "Mono Bold.TTF",
		ok: true,
		url: expect.stringMatching(/^\/fonts\/Mono%20Bold\.TTF\?v=[\w-]{16}$/),
		face: { family: "Mono", style: "normal", weight: { min: 700, max: 700 }, monospace: true },
	});
	expect(files[1]).toMatchObject({ ok: false, error: "invalid-font" });
	expect(files[1]?.ok === false && files[1].detail).toContain("not a TrueType");
	expect(files[2]).toEqual({
		fileName: "disguised.ttf",
		ok: false,
		error: "unsupported-collection",
	});
	expect(files[3]).toEqual({ fileName: "family.ttc", ok: false, error: "unsupported-collection" });
	expect(files[4]).toMatchObject({ ok: false, error: "unreadable", detail: "not a file" });
	expect(files[5]).toMatchObject({ ok: true, face: { family: "Inter" } });
});

test("oversized files and files past the cap are reported without being parsed", () => {
	const dir = tempDir();
	writeFileSync(join(dir, "big.ttf"), "");
	truncateSync(join(dir, "big.ttf"), MAX_FONT_FILE_BYTES + 1);
	const font = buildTestFont("ttf");
	for (let index = 0; index < MAX_FONT_FILES; index++) {
		writeFileSync(join(dir, `f${String(index).padStart(3, "0")}.ttf`), font);
	}
	const { files } = readUserFonts(dir);
	expect(files).toHaveLength(MAX_FONT_FILES + 1);
	expect(files[0]).toEqual({ fileName: "big.ttf", ok: false, error: "too-large" });
	expect(files.slice(1, MAX_FONT_FILES).every((file) => file.ok)).toBe(true);
	expect(files[MAX_FONT_FILES]).toEqual({ fileName: "f127.ttf", ok: false, error: "too-many" });
});

test("the URL version changes with the file, and so does the face", () => {
	const dir = tempDir();
	const path = join(dir, "Face.otf");
	writeFileSync(path, buildTestFont("otf", { family: "First" }));
	const first = readUserFonts(dir).files[0];
	expect(readUserFonts(dir).files[0]).toEqual(first);
	writeFileSync(path, buildTestFont("otf", { family: "Second Family" }));
	const second = readUserFonts(dir).files[0];
	expect(first?.ok && first.face.family).toBe("First");
	expect(second?.ok && second.face.family).toBe("Second Family");
	expect(second?.ok && first?.ok && second.url !== first.url).toBe(true);
});

test("an upload is parsed, stored under its name and replaces a same-named file", async () => {
	const dir = join(tempDir(), "fonts");
	const first = await saveUserFont(
		"Inter.woff",
		body(buildTestFont("woff", { family: "Inter" })),
		dir,
	);
	expect(first).toMatchObject({ fileName: "Inter.woff", ok: true, face: { family: "Inter" } });
	expect(readUserFonts(dir).files).toEqual([first]);
	const replacement = buildTestFont("woff", { family: "Inter", weightClass: 600 });
	const second = await saveUserFont("Inter.woff", body(replacement), dir);
	expect(second).toMatchObject({ ok: true, face: { weight: { min: 600, max: 600 } } });
	expect(second.ok && first.ok && second.url !== first.url).toBe(true);
	expect(readUserFonts(dir).files).toEqual([second]);
	expect(readdirSync(dir)).toEqual(["Inter.woff"]);
	expect(new Uint8Array(readFileSync(join(dir, "Inter.woff")))).toEqual(replacement);
});

test("a rejected upload leaves the folder as it was", async () => {
	const dir = tempDir();
	const original = buildTestFont("ttf", { family: "Kept" });
	writeFileSync(join(dir, "Kept.ttf"), original);
	expect(await saveUserFont("Kept.ttf", body(new TextEncoder().encode("junk")), dir)).toMatchObject(
		{ fileName: "Kept.ttf", ok: false, error: "invalid-font" },
	);
	expect(await saveUserFont("Kept.ttf", body(buildTestCollection()), dir)).toEqual({
		fileName: "Kept.ttf",
		ok: false,
		error: "unsupported-collection",
	});
	expect(await saveUserFont("Set.ttc", body(buildTestCollection()), dir)).toEqual({
		fileName: "Set.ttc",
		ok: false,
		error: "unsupported-collection",
	});
	expect(await saveUserFont("Empty.ttf", null, dir)).toMatchObject({ error: "invalid-font" });
	expect(readdirSync(dir)).toEqual(["Kept.ttf"]);
	expect(new Uint8Array(readFileSync(join(dir, "Kept.ttf")))).toEqual(original);
	await expect(saveUserFont("../escape.ttf", null, dir)).rejects.toThrow("Not a font file name");
});

test("a full folder refuses a new name but still accepts a replacement", async () => {
	const dir = tempDir();
	const font = buildTestFont("ttf");
	for (let index = 0; index < MAX_FONT_FILES; index++) {
		writeFileSync(join(dir, `f${String(index).padStart(3, "0")}.ttf`), font);
	}
	expect(await saveUserFont("new.ttf", body(font), dir)).toEqual({
		fileName: "new.ttf",
		ok: false,
		error: "too-many",
	});
	expect(existsSync(join(dir, "new.ttf"))).toBe(false);
	expect(await saveUserFont("f000.ttf", body(font), dir)).toMatchObject({ ok: true });
});

test("the watcher creates the folder and nudges once per burst, ignoring upload temp files", async () => {
	const poll = 50;
	const dir = join(tempDir(), "fonts");
	let nudges = 0;
	const stop = watchUserFonts({ dir, onChange: () => nudges++, intervalMs: poll });
	try {
		expect(existsSync(dir)).toBe(true);
		writeFileSync(join(dir, ".upload-in-progress"), "partial");
		writeFileSync(join(dir, "readme.txt"), "x");
		await Bun.sleep(poll * 3);
		expect(nudges).toBe(0);
		writeFileSync(join(dir, "Face.ttf"), "a");
		writeFileSync(join(dir, "Face.ttf"), "ab");
		await Bun.sleep(poll * 4);
		expect(nudges).toBe(1);
	} finally {
		stop();
	}
});

test("starting the watcher sweeps upload temp files a crash left behind", () => {
	const dir = tempDir();
	writeFileSync(join(dir, ".upload-crashed"), "partial");
	writeFileSync(join(dir, "Face.ttf"), "kept");
	const stop = watchUserFonts({ dir, onChange: () => {}, intervalMs: 1000 });
	try {
		expect(existsSync(join(dir, ".upload-crashed"))).toBe(false);
		expect(existsSync(join(dir, "Face.ttf"))).toBe(true);
	} finally {
		stop();
	}
});
