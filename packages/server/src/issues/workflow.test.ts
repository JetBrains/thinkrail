import { expect, test } from "bun:test";
import type { IssueReference } from "@thinkrail/contracts";
import { tomatoLabels } from "./approvals";
import type { GitLabIssue, GitLabLabelEvent, GitLabNote } from "./client";
import { createIssueWorkflow, type WorkflowRecord, type WorkflowRemote } from "./workflow";

const reference: IssueReference = {
	provider: "gitlab",
	instanceUrl: "https://gitlab.example",
	projectId: "1",
	number: 2,
};
function fixture() {
	let record: WorkflowRecord | null = null;
	let issue: GitLabIssue = {
		iid: 2,
		title: "Task",
		description: "old",
		state: "opened",
		labels: ["workflow::backlog", "type::bug"],
		updatedAt: "2026-01-01T00:00:00Z",
	};
	const events: GitLabLabelEvent[] = [];
	const notes: GitLabNote[] = [];
	let clock = 0;
	let role = 30;
	let actor = 1;
	let failNote = false;
	let torn = false;
	let commit = "a".repeat(40);
	let commitRead = async () => commit;
	const time = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString();
	const remote: WorkflowRemote = {
		async issue() {
			return structuredClone(issue);
		},
		async notes() {
			if (torn) issue.description += "human edit";
			return structuredClone(notes);
		},
		async labelEvents() {
			return structuredClone(events);
		},
		async member(userId) {
			return { userId, accessLevel: role };
		},
		async currentUser() {
			return { id: actor };
		},
		async updateIssue(_iid, update) {
			expect(record?.pending).toBeDefined();
			if (update.labels) {
				for (const label of issue.labels.filter((l) => !update.labels?.includes(l)))
					events.push({
						id: events.length + 1,
						action: "remove",
						label,
						userId: actor,
						createdAt: time(),
					});
				for (const label of update.labels.filter((l) => !issue.labels.includes(l)))
					events.push({
						id: events.length + 1,
						action: "add",
						label,
						userId: actor,
						createdAt: time(),
					});
			}
			issue = { ...issue, ...update, updatedAt: time() };
			return structuredClone(issue);
		},
		async addNote(_iid, body) {
			expect(record?.pending).toBeDefined();
			if (failNote) throw new Error("SECRET");
			const note = { id: notes.length + 1, body, createdAt: time() };
			notes.push(note);
			return note;
		},
	};
	const persistence = {
		async load() {
			return structuredClone(record);
		},
		async compareAndSet(_ref: IssueReference, revision: number, next: WorkflowRecord) {
			if ((record?.revision ?? 0) !== revision) return false;
			record = structuredClone(next);
			return true;
		},
	};
	const currentImplementationCommit = () => commitRead();
	const workflow = createIssueWorkflow({
		clientFor: () => remote,
		persistence,
		currentImplementationCommit,
	});
	return {
		workflow,
		currentImplementationCommit,
		set commit(value: string) {
			commit = value;
		},
		set commitRead(value: () => Promise<string>) {
			commitRead = value;
		},
		remote,
		persistence,
		events,
		notes,
		get record() {
			return record;
		},
		get issue() {
			return issue;
		},
		set role(value: number) {
			role = value;
		},
		set actor(value: number) {
			actor = value;
		},
		set failNote(value: boolean) {
			failNote = value;
		},
		set torn(value: boolean) {
			torn = value;
		},
		revoke(label: string) {
			issue.labels = issue.labels.filter((value) => value !== label);
			issue.updatedAt = time();
			events.push({ id: events.length + 1, label, action: "remove", userId: 8, createdAt: time() });
		},
		approve(label: string) {
			issue.labels.push(label);
			issue.updatedAt = time();
			events.push({ id: events.length + 1, label, action: "add", userId: 8, createdAt: time() });
		},
	};
}

test("publishes trusted receipts, validates fresh Developer approval and preserves unrelated labels", async () => {
	const f = fixture();
	const receipt = await f.workflow.publishDesign(reference, "old", "design");
	expect(receipt.version).toMatch(/^design:/);
	expect(f.record?.design?.publication.noteId).toBe(1);
	expect((await f.workflow.validateDesign(reference)).approved).toBe(false);
	f.approve(tomatoLabels.design);
	expect((await f.workflow.validateDesign(reference)).approved).toBe(true);
	expect(f.issue.labels).toContain("type::bug");
	expect(f.issue.labels).toContain("workflow::in-progress");
	await f.workflow.publishImplementation(reference, receipt.version, "a".repeat(40));
	f.approve(tomatoLabels.implementation);
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(true);
	expect(f.issue.labels).toContain("workflow::in-review");
	const labels = [...f.issue.labels];
	const design = structuredClone(f.record?.design);
	const implementation = structuredClone(f.record?.implementation);
	for (let repeat = 0; repeat < 2; repeat++) {
		expect((await f.workflow.validateDesign(reference)).approved).toBe(true);
		expect(f.issue.labels).toEqual(labels);
		expect(f.record?.design).toEqual(design);
		expect(f.record?.implementation).toEqual(implementation);
	}
	expect(JSON.stringify(f.record)).not.toMatch(/SECRET|token|clientFor/);
});

test.each([
	3, 8,
])("design revocation after design snapshot %i cannot authorize a transition", async (revokeAt) => {
	const f = fixture();
	const design = await f.workflow.publishDesign(reference, "old", "design");
	f.approve(tomatoLabels.design);
	await f.workflow.validateDesign(reference);
	await f.workflow.publishImplementation(reference, design.version, "a".repeat(40));
	f.approve(tomatoLabels.implementation);
	const record = structuredClone(f.record);
	const readIssue = f.remote.issue;
	let reads = 0;
	f.remote.issue = async (iid) => {
		const snapshot = await readIssue(iid);
		// Revoke after the initial or final design evidence captures its after
		// snapshot, before implementation evidence starts. Neither read is torn.
		if (++reads === revokeAt) f.revoke(tomatoLabels.design);
		return snapshot;
	};
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(false);
	expect(reads).toBeGreaterThanOrEqual(revokeAt);
	expect(f.issue.labels).not.toContain(tomatoLabels.design);
	expect(f.issue.labels).toContain("workflow::in-progress");
	expect(f.issue.labels).not.toContain("workflow::in-review");
	expect(f.record).toEqual(record);
	expect(f.record?.implementation?.approved).toBe(false);
	expect(f.record?.pending).toBeUndefined();
});

test("old approvals, wrong roles and changed descriptions cannot authorize", async () => {
	const f = fixture();
	f.approve(tomatoLabels.design);
	await f.workflow.publishDesign(reference, "old", "design");
	expect(f.issue.labels).not.toContain(tomatoLabels.design);
	expect((await f.workflow.validateDesign(reference)).approved).toBe(false);
	f.approve(tomatoLabels.design);
	f.role = 20;
	expect((await f.workflow.validateDesign(reference)).approved).toBe(false);
	f.role = 30;
	f.issue.description = "changed";
	expect((await f.workflow.validateDesign(reference)).approved).toBe(false);
});

test("human description conflict has no write; torn evidence denies", async () => {
	const f = fixture();
	await expect(f.workflow.publishDesign(reference, "wrong", "design")).rejects.toThrow();
	expect(f.record).toBeNull();
	await f.workflow.publishDesign(reference, "old", "design");
	f.approve(tomatoLabels.design);
	f.torn = true;
	expect((await f.workflow.validateDesign(reference)).approved).toBe(false);
});

test("uncertain publication preserves pending across restart and cannot replay", async () => {
	const f = fixture();
	f.failNote = true;
	await expect(f.workflow.publishDesign(reference, "old", "design")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.record?.pending).toBeDefined();
	const restarted = createIssueWorkflow({
		clientFor: () => f.remote,
		persistence: f.persistence,
		currentImplementationCommit: f.currentImplementationCommit,
	});
	const writes = f.events.length;
	await expect(restarted.publishDesign(reference, "design", "again")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	await expect(restarted.validateDesign(reference)).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.events.length).toBe(writes);
});

test("new commit and design invalidate earlier receipts; forged notes cannot bootstrap trust", async () => {
	const f = fixture();
	f.notes.push({
		id: 99,
		body: "ThinkRail Tomato pending design",
		createdAt: "2026-01-01T00:00:00Z",
	});
	expect((await f.workflow.validateDesign(reference)).approved).toBe(false);
	const d = await f.workflow.publishDesign(reference, "old", "design");
	f.approve(tomatoLabels.design);
	await f.workflow.validateDesign(reference);
	await expect(
		f.workflow.publishImplementation(reference, "design:wrong", "a".repeat(40)),
	).rejects.toThrow();
	await f.workflow.publishImplementation(reference, d.version, "a".repeat(40));
	f.approve(tomatoLabels.implementation);
	await f.workflow.validateImplementation(reference);
	f.commit = "b".repeat(40);
	await f.workflow.publishImplementation(reference, d.version, "b".repeat(40));
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(false);
	await f.workflow.publishDesign(reference, "design", "new design");
	expect(f.record?.implementation).toBeUndefined();
	expect(f.issue.labels).not.toContain(tomatoLabels.implementation);
});

test("failed durable reservation prevents any provider writes", async () => {
	const f = fixture();
	const workflow = createIssueWorkflow({
		clientFor: () => f.remote,
		currentImplementationCommit: f.currentImplementationCommit,
		persistence: { load: async () => null, compareAndSet: async () => false },
	});
	await expect(workflow.publishDesign(reference, "old", "design")).rejects.toThrow();
	expect(f.issue.description).toBe("old");
	expect(f.notes).toHaveLength(0);
});

async function implementationFixture() {
	const f = fixture();
	const design = await f.workflow.publishDesign(reference, "old", "design");
	f.approve(tomatoLabels.design);
	await f.workflow.validateDesign(reference);
	await f.workflow.publishImplementation(reference, design.version, "a".repeat(40));
	f.approve(tomatoLabels.implementation);
	return { f, design };
}

test("implementation HEAD mismatch denies before reservation and already-approved fast path", async () => {
	const { f } = await implementationFixture();
	f.commit = "b".repeat(40);
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(false);
	expect(f.record?.pending).toBeUndefined();
	expect(f.issue.labels).toContain("workflow::in-progress");
	f.commit = "a".repeat(40);
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(true);
	f.commit = "b".repeat(40);
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(false);
	expect(f.record?.implementation?.approved).toBe(false);
});

test("HEAD change during implementation evidence denies without stage advancement", async () => {
	const { f } = await implementationFixture();
	const notes = f.remote.notes;
	f.remote.notes = async (iid) => {
		f.commit = "b".repeat(40);
		return notes(iid);
	};
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(false);
	expect(f.record?.pending).toBeUndefined();
	expect(f.issue.labels).toContain("workflow::in-progress");
});

test("HEAD change at reservation prevents labels and retains pending", async () => {
	const { f } = await implementationFixture();
	const save = f.persistence.compareAndSet;
	f.persistence.compareAndSet = async (ref, revision, next) => {
		const saved = await save(ref, revision, next);
		if (next.pending?.operation === "approve-implementation") f.commit = "b".repeat(40);
		return saved;
	};
	await expect(f.workflow.validateImplementation(reference)).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.record?.pending?.operation).toBe("approve-implementation");
	expect(f.issue.labels).toContain("workflow::in-progress");
	expect(f.record?.implementation?.approved).toBe(false);
});

test("publication SHA must match host before reservation and later writes", async () => {
	for (const boundary of ["before", "reserved", "note"] as const) {
		const { f, design } = await implementationFixture();
		const notes = f.notes.length;
		const events = f.events.length;
		if (boundary === "before") f.commit = "b".repeat(40);
		if (boundary === "reserved") {
			const save = f.persistence.compareAndSet;
			f.persistence.compareAndSet = async (ref, revision, next) => {
				const saved = await save(ref, revision, next);
				if (next.pending) f.commit = "b".repeat(40);
				return saved;
			};
		}
		if (boundary === "note") {
			const update = f.remote.updateIssue;
			f.remote.updateIssue = async (iid, input) => {
				const result = await update(iid, input);
				f.commit = "b".repeat(40);
				return result;
			};
		}
		await expect(
			f.workflow.publishImplementation(reference, design.version, "a".repeat(40)),
		).rejects.toThrow("Issue workflow requires reconciliation.");
		expect(f.notes).toHaveLength(notes);
		if (boundary !== "note") expect(f.events).toHaveLength(events);
		expect(Boolean(f.record?.pending)).toBe(boundary !== "before");
	}
});

test("invalid or unavailable host SHA fails statically; design-only operations do not read Git", async () => {
	const { f } = await implementationFixture();
	for (const read of [
		async () => "not-a-sha SECRET",
		async () => {
			throw new Error("SECRET");
		},
	]) {
		f.commitRead = read;
		await expect(f.workflow.validateImplementation(reference)).rejects.toThrow(
			"Issue workflow requires reconciliation.",
		);
		expect(f.record?.pending).toBeUndefined();
	}
	expect((await f.workflow.validateDesign(reference)).approved).toBe(true);
	await f.workflow.publishDesign(reference, "design", "new design");
});

test.each([
	false,
	true,
])("HEAD changes at final pre-reservation check deny, including fast path %s", async (alreadyApproved) => {
	const { f } = await implementationFixture();
	if (alreadyApproved) await f.workflow.validateImplementation(reference);
	const before = structuredClone(f.record);
	let reads = 0;
	f.commitRead = async () => (++reads < 5 ? "a".repeat(40) : "b".repeat(40));
	expect((await f.workflow.validateImplementation(reference)).approved).toBe(false);
	expect(reads).toBe(5);
	expect(f.record).toEqual(before);
	if (!alreadyApproved) expect(f.issue.labels).toContain("workflow::in-progress");
});

test("HEAD change during label write cannot complete approval and retains pending", async () => {
	const { f } = await implementationFixture();
	const update = f.remote.updateIssue;
	f.remote.updateIssue = async (iid, input) => {
		const result = await update(iid, input);
		f.commit = "b".repeat(40);
		return result;
	};
	await expect(f.workflow.validateImplementation(reference)).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.record?.pending?.operation).toBe("approve-implementation");
	expect(f.record?.implementation?.approved).toBe(false);
});

test("HEAD change during note publication cannot complete receipt", async () => {
	const { f, design } = await implementationFixture();
	const previous = structuredClone(f.record?.implementation);
	const addNote = f.remote.addNote;
	f.remote.addNote = async (iid, body) => {
		const note = await addNote(iid, body);
		f.commit = "b".repeat(40);
		return note;
	};
	await expect(
		f.workflow.publishImplementation(reference, design.version, "a".repeat(40)),
	).rejects.toThrow("Issue workflow requires reconciliation.");
	expect(f.record?.pending?.operation).toBe("publish-implementation");
	expect(f.record?.implementation).toEqual(previous);
});

/** Design approved in the app, with the implementation publication recorded but unapproved. */
async function implementationPublished() {
	const f = fixture();
	const design = await f.workflow.publishDesign(reference, "old", "design");
	expect((await f.workflow.approveStage(reference, "design")).approved).toBe(true);
	await f.workflow.publishImplementation(reference, design.version, "a".repeat(40));
	return { f, design };
}

test("app design approval adds only the approval label and persists the receipt", async () => {
	const f = fixture();
	const publication = await f.workflow.publishDesign(reference, "old", "design");
	const result = await f.workflow.approveStage(reference, "design");
	expect(result).toEqual({ approved: true, eventId: 1, userId: 1 });
	expect(f.record?.design?.approved).toBe(true);
	expect(f.record?.design?.publication).toEqual(publication);
	expect(f.record?.pending).toBeUndefined();
	expect(f.issue.labels).toContain(tomatoLabels.design);
	expect(f.issue.labels).toContain("workflow::in-progress");
	expect(f.issue.labels).toContain("type::bug");
	expect(f.issue.labels).not.toContain("workflow::backlog");
	// The approval leaves a remote label record: no second publication note, no merge capability.
	expect(f.notes).toHaveLength(1);
	expect(f.events.filter((event) => event.label === tomatoLabels.design)).toEqual([
		{ id: 1, action: "add", label: tomatoLabels.design, userId: 1, createdAt: expect.any(String) },
	]);
	expect(Object.hasOwn(f.workflow, "merge")).toBe(false);
	expect(JSON.stringify(f.record)).not.toMatch(/SECRET|token/);
});

test("stale design text is never approved and reserves nothing", async () => {
	const f = fixture();
	await f.workflow.publishDesign(reference, "old", "design");
	f.issue.description = "human edit";
	f.issue.updatedAt = "2026-02-01T00:00:00Z";
	const events = f.events.length;
	await expect(f.workflow.approveStage(reference, "design")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.issue.labels).not.toContain(tomatoLabels.design);
	expect(f.record?.design?.approved).toBe(false);
	expect(f.record?.pending).toBeUndefined();
	expect(f.events).toHaveLength(events);
});

test("stale implementation HEAD or design text is never approved and reserves nothing", async () => {
	const { f } = await implementationPublished();
	f.commit = "b".repeat(40);
	await expect(f.workflow.approveStage(reference, "implementation")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.record?.pending).toBeUndefined();
	expect(f.issue.labels).not.toContain(tomatoLabels.implementation);
	f.commit = "a".repeat(40);
	f.issue.description = "another design";
	f.issue.updatedAt = "2026-02-01T00:00:00Z";
	await expect(f.workflow.approveStage(reference, "implementation")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.record?.pending).toBeUndefined();
	expect(f.issue.labels).not.toContain(tomatoLabels.implementation);
	expect(f.record?.implementation?.approved).toBe(false);
});

test("app implementation approval advances to in-review", async () => {
	const { f } = await implementationPublished();
	const result = await f.workflow.approveStage(reference, "implementation");
	expect(result.approved).toBe(true);
	expect(f.record?.implementation?.approved).toBe(true);
	expect(f.record?.pending).toBeUndefined();
	expect(f.issue.labels).toContain(tomatoLabels.implementation);
	expect(f.issue.labels).toContain("workflow::in-review");
	expect(f.notes).toHaveLength(2);
});

test("app approval reads the actor and Developer role fresh", async () => {
	const f = fixture();
	await f.workflow.publishDesign(reference, "old", "design");
	const events = f.events.length;
	f.role = 20;
	await expect(f.workflow.approveStage(reference, "design")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.record?.pending).toBeUndefined();
	expect(f.events).toHaveLength(events);
	expect(f.issue.labels).not.toContain(tomatoLabels.design);
	f.role = 40;
	expect((await f.workflow.approveStage(reference, "design")).approved).toBe(true);
	// A different actor without the role still cannot approve the next stage.
	const { f: next } = await implementationPublished();
	next.actor = 8;
	next.role = 20;
	await expect(next.workflow.approveStage(reference, "implementation")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(next.record?.pending).toBeUndefined();
});

test("app approval requires a recorded publication receipt", async () => {
	const f = fixture();
	for (const stage of ["design", "implementation"] as const)
		await expect(f.workflow.approveStage(reference, stage)).rejects.toThrow(
			"Issue workflow requires reconciliation.",
		);
	expect(f.record).toBeNull();
	expect(f.issue.labels).toEqual(["workflow::backlog", "type::bug"]);
	expect(f.events).toHaveLength(0);
});

test("a pending record blocks app approval without remote writes", async () => {
	const f = fixture();
	f.failNote = true;
	await expect(f.workflow.publishDesign(reference, "old", "design")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	f.failNote = false;
	const events = f.events.length;
	const notes = f.notes.length;
	await expect(f.workflow.approveStage(reference, "design")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.events).toHaveLength(events);
	expect(f.notes).toHaveLength(notes);
	expect(f.record?.pending?.operation).toBe("publish-design");
});

test("an approval label added by another user never authorizes the app actor", async () => {
	const f = fixture();
	await f.workflow.publishDesign(reference, "old", "design");
	f.approve(tomatoLabels.design);
	const record = structuredClone(f.record);
	await expect(f.workflow.approveStage(reference, "design")).rejects.toThrow(
		"Issue workflow requires reconciliation.",
	);
	expect(f.record).toEqual(record);
	expect(f.record?.design?.approved).toBe(false);
});

test("repeated app approval is idempotent and leaves no pending operation", async () => {
	const f = fixture();
	await f.workflow.publishDesign(reference, "old", "design");
	const first = await f.workflow.approveStage(reference, "design");
	const labels = [...f.issue.labels];
	const events = f.events.length;
	const notes = f.notes.length;
	const record = structuredClone(f.record);
	for (let repeat = 0; repeat < 2; repeat++) {
		expect(await f.workflow.approveStage(reference, "design")).toEqual(first);
		expect(f.issue.labels).toEqual(labels);
		expect(f.events).toHaveLength(events);
		expect(f.notes).toHaveLength(notes);
		expect(f.record).toEqual(record);
		expect(f.record?.pending).toBeUndefined();
	}
});

test("uncertainty after the approval reservation retains pending reconciliation", async () => {
	for (const boundary of ["label write", "head change"] as const) {
		const { f } = await implementationPublished();
		const update = f.remote.updateIssue;
		f.remote.updateIssue = async (iid, input) => {
			if (boundary === "label write") throw new Error("SECRET");
			const result = await update(iid, input);
			f.commit = "b".repeat(40);
			return result;
		};
		await expect(f.workflow.approveStage(reference, "implementation")).rejects.toThrow(
			"Issue workflow requires reconciliation.",
		);
		expect(f.record?.pending?.operation).toBe("approve-implementation");
		expect(f.record?.implementation?.approved).toBe(false);
		// The label write itself may have landed; only the "head change" boundary wrote it.
		expect(f.issue.labels.includes(tomatoLabels.implementation)).toBe(boundary === "head change");
		await expect(f.workflow.approveStage(reference, "implementation")).rejects.toThrow(
			"Issue workflow requires reconciliation.",
		);
		await expect(f.workflow.validateImplementation(reference)).rejects.toThrow(
			"Issue workflow requires reconciliation.",
		);
		expect(f.record?.pending?.operation).toBe("approve-implementation");
	}
});
