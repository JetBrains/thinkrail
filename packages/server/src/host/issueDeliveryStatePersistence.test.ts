import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createIssueDeliveryStatePersistence,
	type IssueDeliveryStateRecord,
} from "./issueDeliveryStatePersistence";

const ref = {
	provider: "github" as const,
	instanceUrl: "https://github.com",
	projectId: "123",
	number: 62,
};
const sha = "a".repeat(40);
function record(revision: number): IssueDeliveryStateRecord {
	return {
		revision,
		repositories: [
			{
				projectId: "local",
				worktreeId: "workspace-1",
				sourceBranch: "feature",
				targetBranch: "main",
				policy: "draft",
				dependsOn: [],
				checkoutSha: sha,
				checkoutTree: "b".repeat(40),
				validations: [
					{
						command: "bun test",
						result: "passed",
						sha,
						tree: "b".repeat(40),
						targetBranch: "main",
						toolVersion: "bun 1.3",
						platform: "windows-x64",
						observedAt: "2026-11-13T00:00:00Z",
						source: "agent-reported",
					},
				],
				updatedAt: "2026-11-13T00:00:00Z",
			},
		],
	};
}
test("delivery state uses durable revisions and compare-and-set", () => {
	const root = mkdtempSync(join(tmpdir(), "issue-delivery-state-"));
	try {
		const store = createIssueDeliveryStatePersistence(root);
		expect(store.load("local", ref)).toBeNull();
		expect(() => store.compareAndSet("local", ref, 0, record(1))).not.toThrow();
		expect(store.load("local", ref)?.revision).toBe(1);
		expect(store.load("local", ref)).toEqual(record(1));
		expect(store.compareAndSet("local", ref, 0, record(1))).toBe(false);
		expect(store.compareAndSet("local", ref, 1, record(2))).toBe(true);
		expect(store.load("local", ref)?.revision).toBe(2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("target changes must explicitly invalidate validation for the old branch or tree", () => {
	const root = mkdtempSync(join(tmpdir(), "issue-delivery-state-"));
	try {
		const store = createIssueDeliveryStatePersistence(root);
		store.compareAndSet("local", ref, 0, record(1));
		const changed = record(2);
		const repo = changed.repositories[0];
		if (!repo) throw new Error("missing repository fixture");
		repo.targetBranch = "release";
		expect(() => store.compareAndSet("local", ref, 1, changed)).toThrow("requires reconciliation");
		repo.validations = [];
		expect(store.compareAndSet("local", ref, 1, changed)).toBe(true);
		expect(store.load("local", ref)?.repositories[0]?.validations).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("repository removal cannot erase the evidence invalidation history", () => {
	const root = mkdtempSync(join(tmpdir(), "issue-delivery-state-"));
	try {
		const store = createIssueDeliveryStatePersistence(root);
		store.compareAndSet("local", ref, 0, record(1));
		expect(() => store.compareAndSet("local", ref, 1, { revision: 2, repositories: [] })).toThrow(
			"requires reconciliation",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("initial evidence must match its repository commit tree and target", () => {
	const root = mkdtempSync(join(tmpdir(), "issue-delivery-state-"));
	try {
		const store = createIssueDeliveryStatePersistence(root);
		const next = record(1);
		const evidence = next.repositories[0]?.validations[0];
		if (!evidence) throw new Error("missing fixture evidence");
		evidence.sha = "c".repeat(40);
		expect(() => store.compareAndSet("local", ref, 0, next)).toThrow("requires reconciliation");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("delivery state is isolated by Issue binding and repository", () => {
	const root = mkdtempSync(join(tmpdir(), "issue-delivery-state-"));
	try {
		const store = createIssueDeliveryStatePersistence(root);
		store.compareAndSet("local", ref, 0, record(1));
		expect(store.load("other", ref)).toBeNull();
		expect(store.load("local", { ...ref, number: 63 })).toBeNull();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("malformed evidence and symlinked record directories fail closed", () => {
	const root = mkdtempSync(join(tmpdir(), "issue-delivery-state-"));
	const elsewhere = mkdtempSync(join(tmpdir(), "issue-delivery-state-outside-"));
	try {
		const store = createIssueDeliveryStatePersistence(root);
		const invalid = record(1);
		const repository = invalid.repositories[0];
		const evidence = repository?.validations[0];
		if (!repository || !evidence) throw new Error("missing fixture evidence");
		evidence.tree = "not-a-tree";
		expect(() => store.compareAndSet("local", ref, 0, invalid)).toThrow("requires reconciliation");
		const key = createHash("sha256")
			.update(JSON.stringify([ref.provider, ref.instanceUrl, ref.projectId, ref.number, "local"]))
			.digest("hex");
		symlinkSync(elsewhere, join(root, key), "junction");
		expect(() => store.load("local", ref)).toThrow("requires reconciliation");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(elsewhere, { recursive: true, force: true });
	}
});
