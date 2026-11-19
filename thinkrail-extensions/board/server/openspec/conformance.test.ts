import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readList, readStatus, readValidation, withCli } from "./cli";
import { FIXTURES, fixtureTree, recorded } from "./fixtureTree";
import { DELTA_OPERATIONS, parseOpenspec, stageOf } from "./parse";
import { upsertTopLevelKey } from "./yaml";

const CASES = readdirSync(FIXTURES).filter((name) => statSync(join(FIXTURES, name)).isDirectory());

const taskStatus = (completed: number, total: number) =>
	total === 0 ? "no-tasks" : completed === total ? "complete" : "in-progress";

test("the fixtures cover every stage and were recorded with the real CLI", () => {
	expect(CASES.length).toBeGreaterThanOrEqual(5);
	expect(recorded(".", "version.txt").trim()).toMatch(/^\d+\.\d+\.\d+/);
	const stages = new Set(
		CASES.flatMap((name) => parseOpenspec(fixtureTree(name)).map((change) => stageOf(change))),
	);
	expect([...stages].sort()).toEqual(["archived", "complete", "in-progress", "planning", "ready"]);
});

describe.each(CASES)("conformance: %s", (name) => {
	const changes = parseOpenspec(fixtureTree(name));
	const list = readList(recorded(name, "list.json"));
	const status = readStatus(recorded(name, "status.json"));

	test("the parser lists exactly the changes `openspec list --all` lists, with its task counts", () => {
		expect(list).not.toBeNull();
		expect(
			changes.map((change) => ({
				name: change.name,
				completedTasks: change.tasks.completed,
				totalTasks: change.tasks.total,
				status: taskStatus(change.tasks.completed, change.tasks.total),
				archived: change.archived,
			})),
		).toEqual(
			[...(list ?? [])].sort((a, b) =>
				a.archived === b.archived ? (a.name < b.name ? -1 : 1) : a.archived ? 1 : -1,
			),
		);
	});

	test("each change's stage is the one the CLI's counts give", () => {
		for (const entry of list ?? []) {
			const change = changes.find(
				(candidate) => candidate.name === entry.name && candidate.archived === entry.archived,
			);
			expect(change && stageOf(change)).toBe(
				stageOf({
					archived: entry.archived,
					tasks: { completed: entry.completedTasks, total: entry.totalTasks },
				}),
			);
		}
	});

	test("the artifact chain matches `openspec status --all`, an unreadable schema included", () => {
		expect(status).not.toBeNull();
		const active = changes.filter((change) => !change.archived);
		expect(active.map((change) => change.name)).toEqual((status ?? []).map((e) => e.changeName));
		for (const entry of status ?? []) {
			const change = active.find((candidate) => candidate.name === entry.changeName);
			if (!change) throw new Error(`missing ${entry.changeName}`);
			if (entry.error !== undefined) {
				expect(change.error).toBeDefined();
				expect(change.artifacts).toEqual([]);
				continue;
			}
			expect(change.error).toBeUndefined();
			expect(change.schema).toBe(entry.schemaName ?? "");
			expect(change.isComplete).toBe(entry.isComplete ?? false);
			expect(change.nextArtifact).toBe(entry.nextArtifact ?? null);
			expect(change.artifacts.map(({ files: _files, ...artifact }) => artifact)).toEqual(
				entry.artifacts ?? [],
			);
		}
	});

	test("deltas per capability match `openspec show --deltas-only`", () => {
		for (const change of changes.filter(
			(candidate) => !candidate.archived && candidate.deltas.length > 0,
		)) {
			const shown = JSON.parse(recorded(name, join("show", `${change.name}.json`))) as {
				deltas: { spec: string; operation: string }[];
			};
			const counted = new Map<string, Record<string, number>>();
			for (const delta of shown.deltas) {
				const counts = counted.get(delta.spec) ?? {};
				counts[delta.operation] = (counts[delta.operation] ?? 0) + 1;
				counted.set(delta.spec, counts);
			}
			expect(
				change.deltas.map((delta) => ({
					capability: delta.capability,
					counts: Object.fromEntries(
						DELTA_OPERATIONS.map((operation) => [
							operation,
							delta[operation.toLowerCase() as "added"],
						]).filter(([, count]) => count !== 0),
					),
				})),
			).toEqual(
				[...counted.entries()]
					.sort(([a], [b]) => (a < b ? -1 : 1))
					.map(([capability, counts]) => ({ capability, counts })),
			);
		}
	});

	test("the CLI's answers laid over the parse change nothing the parse already had right", () => {
		const merged = withCli(changes, { list: list ?? [], status: status ?? [] });
		expect(merged.map((change) => [change.name, change.tasks, change.artifacts.length])).toEqual(
			changes.map((change) => [change.name, change.tasks, change.artifacts.length]),
		);
	});

	test("`openspec validate --all --strict --json` reads as a verdict per change", () => {
		const verdicts = readValidation(recorded(name, "validate.json"));
		expect(verdicts).not.toBeNull();
		for (const [id, verdict] of verdicts ?? []) {
			expect(changes.some((change) => change.name === id)).toBe(true);
			expect(verdict.valid).toBe(verdict.errors + verdict.warnings === 0);
		}
	});
});

test("the invalid fixture fails validate --strict, and REMOVED without a Reason alone does not", () => {
	const verdicts = readValidation(recorded("invalid", "validate.json"));
	const verdict = verdicts?.get("drop-legacy-sms");
	expect(verdict?.valid).toBe(false);
	expect(verdict?.issues.some((issue) => issue.level === "ERROR")).toBe(true);
	expect(verdict?.issues.some((issue) => /REMOVED/.test(issue.message))).toBe(false);
});

test("x-thinkrail written by the upsert passes validate --strict and survives archive", () => {
	const tree = fixtureTree("ready");
	const metadata = tree.files.find(
		(file) => file.path === "openspec/changes/add-2fa-login/.openspec.yaml",
	);
	if (!metadata) throw new Error("the ready fixture has no metadata");
	const marked = upsertTopLevelKey(metadata.text, "x-thinkrail", {
		card: "PA-1",
		workspace: "ws-apply",
	});
	expect(marked).toBe(recorded("ready", "x-thinkrail.openspec.yaml"));
	expect(
		readValidation(recorded("ready", "validate-x-thinkrail.json"))?.get("add-2fa-login"),
	).toEqual({ valid: true, errors: 0, warnings: 0, issues: [] });
	const archived = parseOpenspec(fixtureTree("complete-archived")).find(
		(change) => change.archived,
	);
	expect(archived?.baseName).toBe("add-refunds");
	expect(archived?.thinkrail).toEqual({ card: "PA-3", workspace: "ws-refunds" });
});
