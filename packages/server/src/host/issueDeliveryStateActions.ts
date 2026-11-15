import type { IssueReference } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import type {
	IssueDeliveryRepositoryState,
	IssueDeliveryStateRecord,
} from "./issueDeliveryStatePersistence";
import type { IssueSessionAssociation } from "./issueSessions";

export interface IssueDeliveryStateStore {
	load(projectId: string, reference: IssueReference): IssueDeliveryStateRecord | null;
	compareAndSet(
		projectId: string,
		reference: IssueReference,
		expectedRevision: number,
		next: IssueDeliveryStateRecord,
	): boolean;
}
function stop(reason: string, next?: unknown): never {
	throw new CodedError(
		"ISSUE_DELIVERY_REFUSED",
		`Issue delivery state refused [${reason}]${next ? `; refresh current state: ${JSON.stringify(next)}` : ""}.`,
	);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Reflect.ownKeys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
export interface IssueDeliveryStateActionOptions {
	binding(sessionId: string): Promise<IssueSessionAssociation>;
	repositories(
		binding: IssueSessionAssociation,
	): Promise<readonly { projectId: string; workspaceId: string; path: string; name: string }[]>;
	checkout(repository: {
		projectId: string;
		workspaceId: string;
		path: string;
	}): Promise<{ sha: string; tree: string; branch: string; dirty: boolean }>;
	store: IssueDeliveryStateStore;
}
export function createIssueDeliveryStateActions(options: IssueDeliveryStateActionOptions) {
	async function record(sessionId: string, expectedRevision: number, input: unknown) {
		const binding = await options.binding(sessionId);
		if (binding.stage !== "implementation") stop("session-stage-invalid");
		if (
			!Number.isSafeInteger(expectedRevision) ||
			expectedRevision < 0 ||
			!exact(input, ["repositories"]) ||
			!Array.isArray(input.repositories)
		)
			stop("input-invalid");
		const request = input as { repositories: unknown[] };
		const repositories = await options.repositories(binding);
		if (request.repositories.length !== repositories.length) stop("repository-set-mismatch");
		const nextRepositories: IssueDeliveryRepositoryState[] = [];
		for (const value of request.repositories) {
			if (!value || typeof value !== "object" || Array.isArray(value)) stop("repository-invalid");
			const data = value as Record<string, unknown>;
			const repository = repositories.find((item) => item.projectId === data.projectId);
			if (!repository || nextRepositories.some((item) => item.projectId === repository.projectId))
				stop("repository-not-participating");
			const actual = await options.checkout(repository);
			if (
				data.worktreeId !== repository.workspaceId ||
				data.sourceBranch !== actual.branch ||
				data.checkoutSha !== actual.sha ||
				data.checkoutTree !== actual.tree
			)
				stop("checkout-snapshot-changed");
			if (
				!exact(data, [
					"projectId",
					"worktreeId",
					"sourceBranch",
					"targetBranch",
					"policy",
					"dependsOn",
					"checkoutSha",
					"checkoutTree",
					"validations",
					"updatedAt",
				]) ||
				!["draft", "auto-merge", "manual"].includes(String(data.policy)) ||
				!Array.isArray(data.dependsOn) ||
				!Array.isArray(data.validations)
			)
				stop("repository-state-invalid");
			if (actual.dirty && data.validations.length) stop("validation-checkout-dirty");
			const validations = data.validations.map((entry) => {
				if (!entry || typeof entry !== "object" || Array.isArray(entry)) stop("validation-invalid");
				const validation = entry as Record<string, unknown>;
				if (
					!exact(validation, [
						"command",
						"result",
						"sha",
						"tree",
						"targetBranch",
						"toolVersion",
						"platform",
						"observedAt",
					]) ||
					validation.sha !== actual.sha ||
					validation.tree !== actual.tree ||
					validation.targetBranch !== data.targetBranch ||
					![
						"passed",
						"failed",
						"skipped",
						"not-run",
						"not-applicable",
						"environment-limited",
					].includes(String(validation.result))
				)
					stop("validation-target-mismatch");
				return {
					...validation,
					sha: actual.sha,
					tree: actual.tree,
					source: "agent-reported" as const,
				};
			});
			nextRepositories.push({
				...(data as unknown as IssueDeliveryRepositoryState),
				checkoutSha: actual.sha,
				checkoutTree: actual.tree,
				validations: validations as unknown as IssueDeliveryRepositoryState["validations"],
			});
		}
		const next = { revision: expectedRevision + 1, repositories: nextRepositories };
		if (options.store.compareAndSet(binding.projectId, binding.reference, expectedRevision, next))
			return next;
		const current = options.store.load(binding.projectId, binding.reference);
		stop("revision-conflict-refresh-and-retry", { revision: current?.revision ?? 0 });
	}
	async function read(sessionId: string) {
		const binding = await options.binding(sessionId);
		if (binding.stage !== "implementation") stop("session-stage-invalid");
		return (
			options.store.load(binding.projectId, binding.reference) ?? { revision: 0, repositories: [] }
		);
	}
	return { record, read };
}
