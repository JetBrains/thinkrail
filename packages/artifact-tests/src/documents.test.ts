import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettledJson, waitForDocument } from "./documents";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixturePath(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-artifact-documents-test-"));
	roots.push(root);
	return join(root, "desktop.ready.json");
}

function hostReady(document: unknown): { origin: string } | undefined {
	if (typeof document !== "object" || document === null) return undefined;
	const { origin, mode } = document as { origin?: unknown; mode?: unknown };
	return typeof origin === "string" && mode === "host" ? { origin } : undefined;
}

test("readSettledJson treats a missing, empty or torn document as not yet written", () => {
	const path = fixturePath();
	expect(readSettledJson(path)).toBeUndefined();
	writeFileSync(path, "");
	expect(readSettledJson(path)).toBeUndefined();
	writeFileSync(path, '{"origin":"http://127.0.0.1:1');
	expect(readSettledJson(path)).toBeUndefined();
	writeFileSync(path, '{"origin":"x"}');
	expect(readSettledJson(path)).toEqual({ origin: "x" });
});

test("waitForDocument keeps polling through empty, partial and incomplete documents", async () => {
	const path = fixturePath();
	const stages = [
		"",
		'{"origin":"http://127.0.0.1:4',
		'{"origin":"http://127.0.0.1:4100"}',
		'{"origin":"http://127.0.0.1:4100","mode":"host"}',
	];
	let stage = 0;
	writeFileSync(path, stages[0] ?? "");
	const advance = setInterval(() => {
		stage += 1;
		if (stage < stages.length) writeFileSync(path, stages[stage] ?? "");
	}, 15);
	try {
		const ready = await waitForDocument(path, hostReady, {
			timeoutMs: 2_000,
			intervalMs: 5,
			what: "fixture ready",
		});
		expect(ready).toEqual({ origin: "http://127.0.0.1:4100" });
		expect(stage).toBeGreaterThanOrEqual(stages.length - 1);
	} finally {
		clearInterval(advance);
	}
});

test("waitForDocument names the raw document when it never becomes valid", async () => {
	const path = fixturePath();
	writeFileSync(path, '{"origin":7}');
	await expect(
		waitForDocument(path, hostReady, { timeoutMs: 30, intervalMs: 5, what: "fixture ready" }),
	).rejects.toThrow(
		`timed out after 30ms: fixture ready; ${path} contains ${JSON.stringify('{"origin":7}')}`,
	);
	rmSync(path);
	await expect(
		waitForDocument(path, hostReady, { timeoutMs: 20, intervalMs: 5, what: "fixture ready" }),
	).rejects.toThrow(`${path} does not exist`);
});
