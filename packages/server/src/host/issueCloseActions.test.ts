import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueCloseActions, type IssueClosePayload } from "./issueCloseActions";
import { createIssueConfirmationStore } from "./issueConfirmations";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "issue-close-"));
	const journal = createIssueConfirmationStore(root);
	const binding = {
		sessionId: "session",
		projectId: "local",
		workspaceId: "workspace",
		reference: {
			provider: "github" as const,
			instanceUrl: "https://github.com",
			projectId: "123",
			number: 62,
		},
		stage: "implementation" as const,
		locale: "en",
	};
	let issue = {
		iid: 62,
		title: "Title",
		description: "Body",
		state: "opened" as "opened" | "closed",
		labels: ["team"],
		updatedAt: "2026-11-13T00:00:00Z",
		closedAt: null as string | null,
	};
	let approved = false;
	let failReadback = false;
	let writes = 0;
	const actions = createIssueCloseActions({
		binding: async () => binding,
		journal,
		access: async () => ({
			guard: () => {},
			remote: {
				issue: async () => {
					if (failReadback && writes) throw new Error("offline");
					return structuredClone(issue);
				},
				closeIssue: async () => {
					writes++;
					issue = {
						...issue,
						state: "closed",
						closedAt: "2026-11-13T08:00:00Z",
						updatedAt: "2026-11-13T08:00:00Z",
					};
					return issue;
				},
			},
		}),
		verifyAnswer: async () => {
			if (!approved) throw new Error("missing receipt");
		},
	});
	return {
		actions,
		journal,
		approve: () => {
			approved = true;
		},
		changeIssue: () => {
			issue = { ...issue, labels: ["team", "workflow::in-review"] };
		},
		clearCloseTimestamp: () => {
			issue.closedAt = null;
		},
		failReadback: (value: boolean) => {
			failReadback = value;
		},
		get writes() {
			return writes;
		},
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("Issue close is separately confirmed and returns observed closedAt", async () => {
	const f = fixture();
	try {
		const card = await f.actions.prepare("session", {
			operationId: "close",
			reason: "Accepted",
			acceptance: "All verified",
		});
		expect(card.questions.questions[0]?.preview).toContain("All verified");
		await expect(f.actions.execute("session", "close", "answer")).rejects.toThrow(
			"missing receipt",
		);
		expect(f.writes).toBe(0);
		f.approve();
		expect(await f.actions.execute("session", "close", "answer")).toMatchObject({
			state: "closed",
			closedAt: "2026-11-13T08:00:00Z",
		});
		expect(f.writes).toBe(1);
	} finally {
		f.dispose();
	}
});

test("a closed Issue without timestamp stays uncertain and is never closed twice", async () => {
	const f = fixture();
	try {
		await f.actions.prepare("session", {
			operationId: "close",
			reason: "Accepted",
			acceptance: "All verified",
		});
		f.approve();
		f.failReadback(true);
		await expect(f.actions.execute("session", "close", "answer")).rejects.toThrow(
			"uncertain_intent",
		);
		f.failReadback(false);
		const stored = await f.journal.get("session", "close");
		if (!stored) throw new Error("missing operation");
		f.clearCloseTimestamp();
		await expect(f.actions.observe("session", stored.payload as IssueClosePayload)).rejects.toThrow(
			"closed-timestamp-unavailable",
		);
		expect((await f.journal.inspect("session", "close")).status).toBe("uncertain");
		expect(f.writes).toBe(1);
	} finally {
		f.dispose();
	}
});

test("concurrent Issue changes invalidate close before intent", async () => {
	const f = fixture();
	try {
		await f.actions.prepare("session", {
			operationId: "close",
			reason: "Accepted",
			acceptance: "All verified",
		});
		f.approve();
		f.changeIssue();
		await expect(f.actions.execute("session", "close", "answer")).rejects.toThrow(
			"issue-snapshot-changed",
		);
		expect((await f.journal.inspect("session", "close")).status).toBe("prepared");
		expect(f.writes).toBe(0);
	} finally {
		f.dispose();
	}
});

test("missing close receipt stays uncertain and observation never closes twice", async () => {
	const f = fixture();
	try {
		await f.actions.prepare("session", {
			operationId: "close",
			reason: "Accepted",
			acceptance: "All verified",
		});
		f.approve();
		f.failReadback(true);
		await expect(f.actions.execute("session", "close", "answer")).rejects.toThrow(
			"uncertain_intent",
		);
		expect((await f.journal.inspect("session", "close")).status).toBe("uncertain");
		f.failReadback(false);
		const stored = await f.journal.get("session", "close");
		expect(stored).not.toBeNull();
		if (!stored) throw new Error("missing operation");
		await expect(
			f.actions.observe("session", stored.payload as IssueClosePayload),
		).resolves.toMatchObject({ result: { closedAt: "2026-11-13T08:00:00Z" } });
		expect(f.writes).toBe(1);
	} finally {
		f.dispose();
	}
});
