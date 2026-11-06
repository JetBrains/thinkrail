import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IssueReference } from "@thinkrail/contracts";
import {
	approvalPublication,
	designVersion,
	implementationVersion,
	tomatoLabels,
	type WorkflowRecord,
} from "../issues";
import { createIssueWorkflow, type WorkflowRemote } from "../issues/workflow";
import { createIssueWorkflowPersistence } from "./issueWorkflowPersistence";

const dirs: string[] = [];
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "issue-workflow-"));
	dirs.push(dir);
	return { dir, store: createIssueWorkflowPersistence(dir) };
}
const ref: IssueReference = {
	provider: "gitlab",
	instanceUrl: "https://gitlab.example",
	projectId: "12",
	number: 3,
};
const key = (r = ref) =>
	createHash("sha256")
		.update(
			JSON.stringify([
				r.provider,
				new URL(r.instanceUrl).href.replace(/\/$/, ""),
				r.projectId,
				r.number,
			]),
		)
		.digest("hex");
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("persists receipts and pending reservations across independent instances; stale CAS loses", async () => {
	const { dir, store } = setup();
	expect(await store.load(ref)).toBeNull();
	const version = designVersion("design");
	const record: WorkflowRecord = {
		revision: 1,
		design: {
			publication: approvalPublication({ stage: "design", version, noteId: 2, resetEventId: 0 }),
			approved: false,
			resetConfirmedAbsent: true,
		},
		pending: { operation: "approve-design", version },
	};
	expect(await store.compareAndSet(ref, 0, record)).toBe(true);
	const other = createIssueWorkflowPersistence(dir);
	expect(await other.load(ref)).toEqual(record);
	expect(await other.compareAndSet(ref, 0, { revision: 1 })).toBe(false);
	expect(await other.compareAndSet(ref, 1, { revision: 2 })).toBe(true);
	expect(await store.load(ref)).toEqual({ revision: 2 });
});

function implementationRecord(approved: boolean) {
	const design = designVersion("design");
	const commit = "a".repeat(40);
	return {
		revision: 1,
		design: {
			publication: approvalPublication({
				stage: "design",
				version: design,
				noteId: 1,
				resetEventId: 0,
			}),
			resetConfirmedAbsent: true as const,
			approved: true,
		},
		implementation: {
			publication: approvalPublication({
				stage: "implementation",
				version: implementationVersion(commit, design),
				noteId: 2,
				resetEventId: 0,
			}),
			designVersion: design,
			commit,
			resetConfirmedAbsent: true as const,
			approved,
		},
	};
}

for (const approved of [false, true]) {
	test(`retains implementation approved=${approved} when design approval is revoked`, async () => {
		const { dir, store } = setup();
		const initial = implementationRecord(approved);
		expect(await store.compareAndSet(ref, 0, initial)).toBe(true);
		const revoked = {
			...initial,
			revision: 2,
			design: { ...initial.design, approved: false },
		};
		expect(await store.compareAndSet(ref, 1, revoked)).toBe(true);
		expect(await createIssueWorkflowPersistence(dir).load(ref)).toEqual(revoked);
	});

	test(`validateDesign persists revocation with implementation approved=${approved}`, async () => {
		const { dir, store } = setup();
		const initial = implementationRecord(approved);
		await store.compareAndSet(ref, 0, initial);
		const remote: WorkflowRemote = {
			async issue() {
				return {
					iid: ref.number,
					title: "Task",
					description: "design",
					state: "opened",
					labels: ["workflow::in-progress"],
					updatedAt: "2026-01-01T00:00:02Z",
				};
			},
			async notes() {
				return [
					{ id: 1, body: initial.design.publication.body, createdAt: "2026-01-01T00:00:00Z" },
				];
			},
			async labelEvents() {
				return [
					{
						id: 1,
						label: tomatoLabels.design,
						action: "add",
						userId: 8,
						createdAt: "2026-01-01T00:00:01Z",
					},
					{
						id: 2,
						label: tomatoLabels.design,
						action: "remove",
						userId: 8,
						createdAt: "2026-01-01T00:00:02Z",
					},
				];
			},
			async member(userId) {
				return { userId, accessLevel: 30 };
			},
			async currentUser() {
				return { id: 8 };
			},
			async updateIssue() {
				throw new Error("Revocation must not write remotely");
			},
			async addNote() {
				throw new Error("Revocation must not publish");
			},
		};
		const workflow = createIssueWorkflow({
			clientFor: () => remote,
			persistence: store,
			currentImplementationCommit: async () => "a".repeat(40),
		});
		expect((await workflow.validateDesign(ref)).approved).toBe(false);
		expect(await createIssueWorkflowPersistence(dir).load(ref)).toEqual({
			...initial,
			revision: 2,
			design: { ...initial.design, approved: false },
		});
	});
}

test("implementation still requires a valid matching design receipt", async () => {
	const { store } = setup();
	const initial = implementationRecord(false);
	for (const design of [
		undefined,
		{ ...initial.design, publication: { ...initial.design.publication, body: "forged" } },
		{
			...initial.design,
			publication: approvalPublication({
				stage: "design",
				version: designVersion("other"),
				noteId: 1,
				resetEventId: 0,
			}),
		},
	]) {
		const next: WorkflowRecord = { ...initial };
		if (design) next.design = design;
		else delete next.design;
		await expect(store.compareAndSet(ref, 0, next)).rejects.toThrow("requires reconciliation");
	}
	expect(await store.load(ref)).toBeNull();
});

test("canonical URL aliases share identity; instances, projects and IIDs are isolated", async () => {
	const { store } = setup();
	await store.compareAndSet(ref, 0, { revision: 1 });
	expect(await store.load({ ...ref, instanceUrl: "https://GITLAB.example:443/" })).toEqual({
		revision: 1,
	});
	for (const other of [
		{ ...ref, projectId: "13" },
		{ ...ref, number: 4 },
		{ ...ref, instanceUrl: "https://other.example" },
	])
		expect(await store.load(other)).toBeNull();
});

test("independent processes race for a single exclusive revision claim", async () => {
	const { dir, store } = setup();
	const modulePath = new URL("./issueWorkflowPersistence.ts", import.meta.url).href;
	const code = `import { createIssueWorkflowPersistence } from ${JSON.stringify(modulePath)}; try { console.log(await createIssueWorkflowPersistence(${JSON.stringify(dir)}).compareAndSet(${JSON.stringify(ref)}, 0, {revision:1})); } catch { console.log('closed'); }`;
	const workers = Array.from({ length: 6 }, () =>
		Bun.spawn([process.execPath, "--eval", code], { stdout: "pipe", stderr: "pipe" }),
	);
	const results = await Promise.all(
		workers.map(async (p) => {
			const text = await new Response(p.stdout).text();
			expect(await p.exited).toBe(0);
			return text.trim();
		}),
	);
	expect(results.filter((r) => r === "true")).toHaveLength(1);
	expect(results.every((r) => ["true", "false", "closed"].includes(r))).toBe(true);
	expect(await store.load(ref)).toEqual({ revision: 1 });
});

for (const [name, filename, body] of [
	["reserved", "1.json", ""],
	["torn", "1.json", '{"record":'],
	["gap", "2.json", "{}"],
	["unexpected entry", "other.json", "{}"],
	["wrong revision", "1.json", JSON.stringify({ reference: ref, record: { revision: 2 } })],
	[
		"secret field",
		"1.json",
		JSON.stringify({ reference: ref, record: { revision: 1, token: "secret" } }),
	],
	["oversized", "1.json", "x".repeat(17000)],
] as const)
	test(`${name} storage fails closed without removing or overwriting`, async () => {
		const { dir, store } = setup();
		const folder = join(dir, key());
		mkdirSync(folder);
		const file = join(folder, filename);
		writeFileSync(file, body);
		await expect(store.load(ref)).rejects.toThrow("requires reconciliation");
		await expect(store.compareAndSet(ref, 0, { revision: 1 })).rejects.toThrow(
			"requires reconciliation",
		);
		expect(readFileSync(file, "utf8")).toBe(body);
	});

test("strict input bounds, reference shape and receipt semantics are checked before claim", async () => {
	const { store } = setup();
	for (const bad of [
		{ ...ref, token: "secret" },
		{ ...ref, projectId: "012" },
		{ ...ref, instanceUrl: "https://secret@gitlab.example" },
		{ ...ref, number: 0 },
		{ ...ref, instanceUrl: `https://example.com/${"x".repeat(2048)}` },
	])
		await expect(store.load(bad)).rejects.toThrow();
	for (const bad of [
		{ revision: 2 },
		{ revision: 1, pending: { operation: "replay", version: "x" } },
		{ revision: 1, design: { approved: true } },
		{ revision: 1, extra: true },
	])
		await expect(store.compareAndSet(ref, 0, bad as WorkflowRecord)).rejects.toThrow();
	expect(await store.load(ref)).toBeNull();
});

test("every reservation persists its stage version and rejects a mismatched one", async () => {
	const design = designVersion("design");
	const implementation = implementationVersion("a".repeat(40), design);
	for (const [operation, version] of [
		["approve-design", design],
		["approve-implementation", implementation],
	] as const) {
		const { store } = setup();
		const record: WorkflowRecord = { revision: 1, pending: { operation, version } };
		expect(await store.compareAndSet(ref, 0, record)).toBe(true);
		expect(await store.load(ref)).toEqual(record);
	}
	for (const [operation, version] of [
		["approve-design", implementation],
		["approve-implementation", design],
	] as const) {
		const { store } = setup();
		await expect(
			store.compareAndSet(ref, 0, { revision: 1, pending: { operation, version } }),
		).rejects.toThrow("requires reconciliation");
		expect(await store.load(ref)).toBeNull();
	}
});

test("a torn tail cannot fall back to a prior good revision or accept further CAS", async () => {
	const { dir, store } = setup();
	await store.compareAndSet(ref, 0, { revision: 1 });
	const tail = join(dir, key(), "2.json");
	writeFileSync(tail, "");
	await expect(store.load(ref)).rejects.toThrow("requires reconciliation");
	await expect(
		createIssueWorkflowPersistence(dir).compareAndSet(ref, 1, { revision: 2 }),
	).rejects.toThrow("requires reconciliation");
	expect(readFileSync(tail, "utf8")).toBe("");
});

test("loaded envelopes and receipts are untrusted, not cast to workflow records", async () => {
	const version = designVersion("design");
	const publication = approvalPublication({ stage: "design", version, noteId: 1, resetEventId: 0 });
	for (const envelope of [
		{ reference: { ...ref, projectId: "13" }, record: { revision: 1 } },
		{ reference: ref, record: { revision: 1 }, token: "secret" },
		{
			reference: ref,
			record: {
				revision: 1,
				design: {
					publication: { ...publication, body: "forged" },
					resetConfirmedAbsent: true as const,
					approved: true,
				},
			},
		},
		{
			reference: ref,
			record: { revision: 1, design: { publication, resetConfirmedAbsent: false, approved: true } },
		},
		{
			reference: ref,
			record: { revision: 1, pending: { operation: "publish-design", version: "invalid" } },
		},
	]) {
		const { dir, store } = setup();
		mkdirSync(join(dir, key()));
		writeFileSync(join(dir, key(), "1.json"), JSON.stringify(envelope));
		await expect(store.load(ref)).rejects.toThrow("requires reconciliation");
	}
});
