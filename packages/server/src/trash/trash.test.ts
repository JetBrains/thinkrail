import { expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type ClaimedEntry,
	claimAndTrashFile,
	setTrashImplementationForTests,
	type TrashImplementation,
	trashFile,
} from "./trash";

function validated(path: string): ClaimedEntry {
	const { dev, ino } = lstatSync(path, { bigint: true });
	return { parent: realpathSync(dirname(path)), dev, ino };
}

test("trashFile reports an OS-trash failure without permanently deleting the file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-trash-"));
	const path = join(dir, "session.jsonl");
	writeFileSync(path, "recoverable transcript");
	let receivedInput: string | readonly string[] | undefined;
	let receivedGlob: boolean | undefined;
	const failingTrash: TrashImplementation = async (input, options) => {
		receivedInput = input;
		receivedGlob = options?.glob;
		throw new Error("recycle bin unavailable");
	};

	try {
		await expect(trashFile(path, failingTrash)).rejects.toThrow("recycle bin unavailable");
		expect(receivedInput).toBe(path);
		expect(receivedGlob).toBe(false);
		expect(readFileSync(path, "utf8")).toBe("recoverable transcript");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("claimAndTrashFile trashes the claim, so a recreated path is never the object trashed", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-claim-"));
	const path = join(dir, "notes.txt");
	writeFileSync(path, "original");
	const trashed: string[] = [];
	setTrashImplementationForTests(async (input) => {
		writeFileSync(path, "recreated");
		trashed.push(String(input));
		rmSync(String(input));
	});
	try {
		await claimAndTrashFile(path, join(dir, ".claim"), join(dir, ".recovery"), validated(path));
		expect(trashed).toEqual([join(dir, ".claim")]);
		expect(readFileSync(path, "utf8")).toBe("recreated");
		expect(readdirSync(dir)).toEqual(["notes.txt"]);
	} finally {
		setTrashImplementationForTests(undefined);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("claimAndTrashFile restores a file, link or folder when the trash fails", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-claim-"));
	mkdirSync(join(dir, "folder"));
	writeFileSync(join(dir, "folder", "inner.txt"), "inner");
	writeFileSync(join(dir, "file.txt"), "file");
	symlinkSync("file.txt", join(dir, "link"));
	setTrashImplementationForTests(async () => {
		throw new Error("recycle bin unavailable");
	});
	try {
		for (const name of ["file.txt", "link", "folder"]) {
			await expect(
				claimAndTrashFile(
					join(dir, name),
					join(dir, ".claim"),
					join(dir, ".recovery"),
					validated(join(dir, name)),
				),
			).rejects.toThrow("recycle bin unavailable");
		}
		expect(readdirSync(dir).sort()).toEqual(["file.txt", "folder", "link"]);
		expect(readlinkSync(join(dir, "link"))).toBe("file.txt");
		expect(readFileSync(join(dir, "folder", "inner.txt"), "utf8")).toBe("inner");
	} finally {
		setTrashImplementationForTests(undefined);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("claimAndTrashFile preserves the claim when a concurrent recreation wins", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-claim-"));
	for (const name of ["file.txt", "folder"]) {
		const path = join(dir, name);
		if (name === "folder") mkdirSync(path);
		else writeFileSync(path, "claimed");
		setTrashImplementationForTests(async () => {
			if (name === "folder") {
				mkdirSync(path);
				writeFileSync(join(path, "new.txt"), "new");
			} else writeFileSync(path, "recreated");
			throw new Error("recycle bin unavailable");
		});
		const recovery = join(dir, `.recovery-${name}`);
		const failure = await claimAndTrashFile(
			path,
			join(dir, ".claim"),
			recovery,
			validated(path),
		).catch((error: unknown) => error);
		expect((failure as Error).message).toContain(recovery);
		expect(existsSync(recovery)).toBe(true);
		expect(existsSync(join(dir, ".claim"))).toBe(false);
	}
	setTrashImplementationForTests(undefined);
	expect(readFileSync(join(dir, "file.txt"), "utf8")).toBe("recreated");
	expect(readFileSync(join(dir, ".recovery-file.txt"), "utf8")).toBe("claimed");
	expect(readdirSync(join(dir, "folder"))).toEqual(["new.txt"]);
	rmSync(dir, { recursive: true, force: true });
});

test("claimAndTrashFile puts back an entry it was not asked to trash and trashes nothing", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-claim-"));
	const path = join(dir, "notes.txt");
	writeFileSync(path, "validated");
	const expected = validated(path);
	writeFileSync(join(dir, "next.txt"), "replacement");
	renameSync(join(dir, "next.txt"), path);
	const trashed: string[] = [];
	setTrashImplementationForTests(async (input) => {
		trashed.push(String(input));
	});
	try {
		await expect(
			claimAndTrashFile(path, join(dir, ".claim"), join(dir, ".recovery"), expected),
		).rejects.toMatchObject({ code: "ENTRY_CHANGED" });
		await expect(
			claimAndTrashFile(path, join(dir, ".claim"), join(dir, ".recovery"), {
				...validated(path),
				parent: tmpdir(),
			}),
		).rejects.toMatchObject({ code: "ENTRY_CHANGED" });
		expect(trashed).toEqual([]);
		expect(readdirSync(dir)).toEqual(["notes.txt"]);
		expect(readFileSync(path, "utf8")).toBe("replacement");
	} finally {
		setTrashImplementationForTests(undefined);
		rmSync(dir, { recursive: true, force: true });
	}
});
