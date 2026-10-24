import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdateJournalStore, parseUpdateJournal, type UpdateJournal } from "./journal";

const resolved: UpdateJournal = {
	schemaVersion: 1,
	state: "resolved",
	result: {
		outcome: "failed",
		fromVersion: null,
		toVersion: "1.1.0",
		failedStep: "swapping",
		detail: "AccessDenied",
		log: [
			{
				at: 1,
				source: "installer",
				level: "error",
				event: {
					kind: "installFailed",
					version: "1.1.0",
					step: "swapping",
					detail: "AccessDenied",
				},
			},
		],
	},
};

test("journal parsing accepts only bounded pending and resolved shapes", () => {
	expect(parseUpdateJournal(resolved)).toEqual(resolved);
	expect(
		parseUpdateJournal({
			schemaVersion: 1,
			state: "pending",
			fromVersion: "1.0.0",
			toVersion: "1.1.0",
			startedAt: 5,
			log: [],
		}),
	).toMatchObject({ state: "pending", toVersion: "1.1.0" });
	expect(parseUpdateJournal({ ...resolved, schemaVersion: 2 })).toBeNull();
	expect(
		parseUpdateJournal({ schemaVersion: 1, state: "pending", fromVersion: "1.0.0" }),
	).toBeNull();
	expect(
		parseUpdateJournal({ ...resolved, result: { ...resolved.result, outcome: "maybe" } }),
	).toBeNull();
	expect(
		parseUpdateJournal({
			...resolved,
			result: {
				...resolved.result,
				log: [{ at: 1, source: "shell", level: "info", event: { kind: "restarting" } }],
			},
		}),
	).toBeNull();
	expect(
		parseUpdateJournal({
			...resolved,
			result: {
				...resolved.result,
				log: [{ at: 1, source: "host", level: "info", event: { kind: "hostStopped" } }],
			},
		}),
	).toBeNull();
	expect(
		parseUpdateJournal({
			...resolved,
			result: {
				...resolved.result,
				log: [{ at: 1, source: "host", level: "info", text: "Stopped in 1 s" }],
			},
		}),
	).toBeNull();
	expect(
		parseUpdateJournal({
			...resolved,
			result: {
				...resolved.result,
				log: Array.from({ length: 201 }, () => resolved.result.log[0]),
			},
		}),
	).toBeNull();
});

test("the journal store round-trips, ignores corrupt files, and clears", () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-update-journal-"));
	try {
		const path = join(root, "update-journal.json");
		const errors: unknown[] = [];
		const store = createUpdateJournalStore(path, (error) => errors.push(error));
		expect(store.read()).toBeNull();
		store.write(resolved);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(resolved);
		expect(store.read()).toEqual(resolved);
		writeFileSync(path, "{not json");
		expect(store.read()).toBeNull();
		expect(errors).toHaveLength(1);
		store.clear();
		expect(store.read()).toBeNull();
		store.write(resolved);
		rmSync(root, { recursive: true, force: true });
		store.write(resolved);
		expect(errors.length).toBeGreaterThan(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
