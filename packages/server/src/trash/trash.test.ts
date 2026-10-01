import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TrashImplementation, trashFile } from "./trash";

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
