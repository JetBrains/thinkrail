import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claimBrowserAttributionAttemptIn,
	readAcquisitionIn,
	saveAcquisitionIn,
} from "./attribution";

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-attribution-store-"));
	const now = Date.now();
	const record = {
		first_touch: {
			source: "newsletter",
			referrer_class: "referral" as const,
			landing_content_key: "landing" as const,
			touched_at: now - 2,
			policy_version: 1 as const,
		},
		last_touch: {
			medium: "organic",
			referrer_class: "search" as const,
			landing_content_key: "blog/index" as const,
			touched_at: now - 1,
			policy_version: 1 as const,
		},
	};
	return { directory, now, record };
}

test("the first browser attempt is an exclusive marker and a successful record atomically replaces it", () => {
	const { directory, now, record } = fixture();
	try {
		expect(claimBrowserAttributionAttemptIn(directory)).toBe(true);
		expect(claimBrowserAttributionAttemptIn(directory)).toBe(false);
		expect(readAcquisitionIn(directory, now)).toBeUndefined();
		saveAcquisitionIn(directory, record);
		expect(readAcquisitionIn(directory, now)).toEqual(record);
		expect(JSON.parse(readFileSync(join(directory, "attribution.json"), "utf8"))).toEqual(record);
		expect(
			Array.from(new Bun.Glob(".attribution.json.*.tmp").scanSync({ cwd: directory })),
		).toEqual([]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("strict loading terminalizes unknown, malformed, and last-touch-expired campaign context", () => {
	const { directory, now, record } = fixture();
	const target = join(directory, "attribution.json");
	try {
		for (const value of [
			{ ...record, journey_id: "private" },
			{ ...record, first_touch: { ...record.first_touch, source: " x" } },
			{
				...record,
				first_touch: { ...record.first_touch, touched_at: now - 32 * 24 * 60 * 60 * 1000 },
				last_touch: { ...record.last_touch, touched_at: now - 31 * 24 * 60 * 60 * 1000 },
			},
		]) {
			writeFileSync(target, JSON.stringify(value));
			expect(readAcquisitionIn(directory, now)).toBeUndefined();
			expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
				browserClaimAttempted: true,
			});
			expect(
				Array.from(new Bun.Glob(".attribution.json.*.tmp").scanSync({ cwd: directory })),
			).toEqual([]);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("retention is measured from last touch rather than first touch", () => {
	const { directory, now, record } = fixture();
	try {
		const refreshed = {
			...record,
			first_touch: { ...record.first_touch, touched_at: now - 40 * 24 * 60 * 60 * 1000 },
		};
		writeFileSync(join(directory, "attribution.json"), JSON.stringify(refreshed));
		expect(readAcquisitionIn(directory, now)).toEqual(refreshed);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("failed atomic replacement leaves the terminal attempt marker and cleans its temporary file", () => {
	const { directory, record } = fixture();
	try {
		claimBrowserAttributionAttemptIn(directory);
		expect(() =>
			saveAcquisitionIn(directory, record, () => {
				throw new Error("replace failed");
			}),
		).toThrow("replace failed");
		expect(readFileSync(join(directory, "attribution.json"), "utf8")).toContain(
			'"browserClaimAttempted": true',
		);
		expect(
			Array.from(new Bun.Glob(".attribution.json.*.tmp").scanSync({ cwd: directory })),
		).toEqual([]);
		expect(existsSync(join(directory, "attribution.json"))).toBe(true);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
