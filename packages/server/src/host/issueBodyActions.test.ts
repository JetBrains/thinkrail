import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueBodyActions, type IssueBodyPayload } from "./issueBodyActions";
import { createIssueConfirmationStore } from "./issueConfirmations";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "issue-body-"));
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
		description: "Original",
		state: "opened" as const,
		labels: ["team"],
		updatedAt: "2026-11-13T00:00:00Z",
	};
	const writes: unknown[] = [];
	let approved = false;
	let failReadback = false;
	const actions = createIssueBodyActions({
		binding: async () => binding,
		journal,
		access: async () => ({
			guard: () => {},
			remote: {
				issue: async () => {
					if (failReadback && writes.length) throw new Error("offline");
					return structuredClone(issue);
				},
				updateIssue: async (_iid, input) => {
					writes.push(input);
					issue = { ...issue, description: input.description ?? issue.description };
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
		writes,
		binding,
		approve: () => {
			approved = true;
		},
		changeBody: () => {
			issue.description = "Concurrent";
		},
		failReadback: (value: boolean) => {
			failReadback = value;
		},
		dispose: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("body replacement freezes full before/after and requires a real receipt", async () => {
	const f = fixture();
	try {
		const prepared = await f.actions.prepare("session", {
			operationId: "body",
			body: "Replacement",
		});
		expect(prepared.questions.questions[0]?.preview).toContain("Original");
		expect(prepared.questions.questions[0]?.preview).toContain("Replacement");
		await expect(f.actions.execute("session", "body", "answer")).rejects.toThrow("missing receipt");
		expect(f.writes).toEqual([]);
		f.approve();
		expect(await f.actions.execute("session", "body", "answer")).toMatchObject({
			stage: "update-body",
			description: "Replacement",
		});
		expect(f.writes).toEqual([{ description: "Replacement" }]);
		await f.actions.execute("session", "body", "answer");
		expect(f.writes).toHaveLength(1);
	} finally {
		f.dispose();
	}
});

test("concurrent body changes refuse before intent and leave labels untouched", async () => {
	const f = fixture();
	try {
		await f.actions.prepare("session", { operationId: "body", body: "" });
		f.approve();
		f.changeBody();
		await expect(f.actions.execute("session", "body", "answer")).rejects.toThrow(
			"body-snapshot-changed",
		);
		expect((await f.journal.inspect("session", "body")).status).toBe("prepared");
		expect(f.writes).toEqual([]);
	} finally {
		f.dispose();
	}
});

test("failed readback retains uncertainty and observes without resending", async () => {
	const f = fixture();
	try {
		await f.actions.prepare("session", { operationId: "body", body: "Replacement" });
		f.approve();
		f.failReadback(true);
		await expect(f.actions.execute("session", "body", "answer")).rejects.toThrow(
			"uncertain_intent",
		);
		expect((await f.journal.inspect("session", "body")).status).toBe("uncertain");
		f.failReadback(false);
		const stored = await f.journal.get("session", "body");
		expect(stored).not.toBeNull();
		if (!stored) throw new Error("missing operation");
		const observed = await f.actions.observe("session", stored.payload as IssueBodyPayload);
		expect(observed.result).toMatchObject({ description: "Replacement" });
		expect(f.writes).toHaveLength(1);
	} finally {
		f.dispose();
	}
});
