import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ATTENTION_LEDGER_VERSION,
	loadAttentionLedger,
	quarantineAttentionLedger,
	saveAttentionLedger,
} from "./persistence";

let directory: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-attention-ledger-"));
	process.env.THINKRAIL_DATA_DIR = directory;
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("attention ledger distinguishes missing state", () => {
	expect(loadAttentionLedger()).toEqual({ status: "missing" });
});

test("attention ledger saves and reloads exact handled candidates", () => {
	saveAttentionLedger({
		version: ATTENTION_LEDGER_VERSION,
		migrationComplete: true,
		handledCandidateBySession: { s1: "candidate-1", s2: "candidate-2" },
	});

	expect(loadAttentionLedger()).toEqual({
		status: "ready",
		ledger: {
			version: ATTENTION_LEDGER_VERSION,
			migrationComplete: true,
			handledCandidateBySession: { s1: "candidate-1", s2: "candidate-2" },
		},
	});
	expect(readdirSync(directory)).toEqual(["attention.json"]);
	expect(readFileSync(join(directory, "attention.json"), "utf8")).toEndWith("\n");
});

test("attention ledger reports malformed state and preserves it when quarantined", () => {
	const file = join(directory, "attention.json");
	writeFileSync(file, "{ not json");

	const loaded = loadAttentionLedger();
	expect(loaded.status).toBe("invalid");
	const quarantined = quarantineAttentionLedger();
	expect(existsSync(file)).toBe(false);
	expect(readFileSync(quarantined, "utf8")).toBe("{ not json");
});

test("attention ledger rejects invalid writes without replacing valid state", () => {
	const valid = {
		version: ATTENTION_LEDGER_VERSION,
		migrationComplete: true as const,
		handledCandidateBySession: { s1: "candidate-1" },
	};
	saveAttentionLedger(valid);

	expect(() =>
		saveAttentionLedger({
			...valid,
			handledCandidateBySession: { s1: "" },
		}),
	).toThrow("Invalid attention ledger");
	expect(loadAttentionLedger()).toEqual({ status: "ready", ledger: valid });
});
