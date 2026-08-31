import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delegationSessionDir, deriveChildSessionFile } from "./storage";

test("the lineage layout is <root>/<scope>/<parentSessionId>", () => {
	expect(delegationSessionDir("/root", "ws-1", "parent-1")).toBe(join("/root", "ws-1", "parent-1"));
});

test("deriveChildSessionFile finds the child transcript by id suffix, without an index", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-delegation-storage-"));
	try {
		const dir = delegationSessionDir(root, "ws-1", "parent-1");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "2026-08-25T10-00-00_child-aaa.jsonl"), "");
		writeFileSync(join(dir, "2026-08-25T10-00-01_child-bbb.jsonl"), "");

		expect(deriveChildSessionFile(root, "ws-1", "parent-1", "child-bbb")).toBe(
			join(dir, "2026-08-25T10-00-01_child-bbb.jsonl"),
		);
		expect(deriveChildSessionFile(root, "ws-1", "parent-1", "child-zzz")).toBeUndefined();
		expect(deriveChildSessionFile(root, "ws-1", "gone-parent", "child-aaa")).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
