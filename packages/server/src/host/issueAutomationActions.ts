import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { IssueReference } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueMergeRequest } from "../issues";
import type { IssueConfirmationStore } from "./issueConfirmations";
import type { IssueDependencyPairingReceipt } from "./issueRepositoryDependencies";

export interface IssueAutomationPolicy {
	stage: "issue-automation-policy";
	sessionId: string;
	operationId: string;
	reference: IssueReference;
	repository: {
		projectId: string;
		workspaceId: string;
		sourceBranch: string;
		targetBranch: string;
		repositoryId: string;
	};
	baselineSha: string;
	title: string;
	body: string;
	mode: "draft" | "auto-merge" | "manual";
	closeIssue: boolean;
	reason: string;
	acceptance: string;
}
export interface IssueAutomationAuthorization {
	readonly policyOperationId: string;
	readonly policyDigest: string;
	readonly payloadDigest: string;
	readonly toolCallId: string;
}
export interface IssueAutomationActionsOptions {
	journal: IssueConfirmationStore;
	binding(sessionId: string): Promise<{ sessionId: string; reference: IssueReference }>;
	/** Host-verified participating repositories, including authenticated provider identity. */
	repositories(binding: {
		sessionId: string;
		reference: IssueReference;
	}): Promise<readonly IssueAutomationPolicy["repository"][]>;
	verifyAnswer?(
		sessionId: string,
		payload: IssueAutomationPolicy,
		toolCallId: string,
	): Promise<void>;
	checkout(
		sessionId: string,
		repository: IssueAutomationPolicy["repository"],
	): Promise<{ sha: string; branch: string }>;
	isAncestor(
		sessionId: string,
		repository: IssueAutomationPolicy["repository"],
		ancestor: string,
		descendant: string,
	): Promise<boolean>;
	/** Must re-read actual upstream target merges and host-run pair compatibility. */
	dependencyPreflight?(
		sessionId: string,
		projectId: string,
	): Promise<IssueDependencyPairingReceipt>;
	delivery?: {
		prepare(
			sessionId: string,
			input: {
				operationId: string;
				projectId: string;
				title: string;
				body: string;
				targetBranch: string;
			},
		): Promise<unknown>;
		execute(
			sessionId: string,
			operationId: string,
			toolCallId: string,
			authorization?: unknown,
		): Promise<unknown>;
	};
	mergeRequest?: {
		prepare(
			sessionId: string,
			action: "ready-mr" | "merge-mr",
			input: {
				operationId: string;
				projectId: string;
				iid: number;
				targetBranch: string;
				expectedSha: string;
			},
		): Promise<unknown>;
		execute(
			sessionId: string,
			operationId: string,
			toolCallId: string,
			authorization?: unknown,
		): Promise<unknown>;
	};
	close?: {
		prepare(
			sessionId: string,
			input: { operationId: string; reason: string; acceptance: string },
		): Promise<unknown>;
		execute(
			sessionId: string,
			operationId: string,
			toolCallId: string,
			authorization?: unknown,
		): Promise<unknown>;
	};
	request?(sessionId: string, projectId: string, iid: number): Promise<IssueMergeRequest>;
	readiness?(
		sessionId: string,
		projectId: string,
		iid: number,
		sha: string,
	): Promise<{ checks: string; approval: string }>;
	deliveryState?(sessionId: string): Promise<{
		revision: number;
		repositories: readonly {
			projectId: string;
			worktreeId: string;
			sourceBranch: string;
			targetBranch: string;
			policy: string;
			dependsOn: readonly string[];
			checkoutSha: string;
			checkoutTree: string;
			validations: readonly {
				result: string;
				source: string;
				sha: string;
				tree: string;
				targetBranch: string;
			}[];
		}[];
	}>;
	/** Must verify the exact merged request's ancestry and the chosen acceptance. */
	observeMerged?(sessionId: string, policy: IssueAutomationPolicy, iid: number): Promise<boolean>;
}
function refuse(reason: string): never {
	throw new CodedError("ISSUE_DELIVERY_REFUSED", `Issue automation refused [${reason}].`);
}
function text(value: unknown, optional = false): value is string {
	return (
		typeof value === "string" &&
		Buffer.byteLength(value, "utf8") <= 8000 &&
		(optional || value.trim().length > 0)
	);
}
function sha(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{40,64}$/i.test(value);
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) refuse("payload-invalid");
	return value as Record<string, unknown>;
}
function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function childId(policy: IssueAutomationPolicy, action: string, head = ""): string {
	return `auto:${digest([policy.sessionId, policy.operationId, action, head])}`;
}
export function policyQuestions(payload: IssueAutomationPolicy) {
	return {
		questions: [
			{
				question: "Authorize this Issue lifecycle policy?",
				header: "Issue automation",
				preview: `Issue ${payload.reference.instanceUrl} / ${payload.reference.projectId} #${payload.reference.number}\nRepository ${payload.repository.projectId} (${payload.repository.workspaceId}, ${payload.repository.repositoryId})\nSource ${payload.repository.sourceBranch} -> ${payload.repository.targetBranch}\nBaseline ${payload.baselineSha}\nTitle ${payload.title}\nBody ${payload.body}\nMode ${payload.mode}\nClose Issue: ${payload.closeIssue}${payload.closeIssue ? `\nReason: ${payload.reason}\nAcceptance: ${payload.acceptance}` : ""}\nVersion: ${digest(payload)}`,
				options: [
					{
						label: "Looks right",
						description: "Authorize only this policy and its stated lifecycle choices.",
					},
				],
			},
		],
	};
}
export function createIssueAutomationActions(options: IssueAutomationActionsOptions) {
	async function preflight(sessionId: string, policy: IssueAutomationPolicy) {
		const binding = await options.binding(sessionId);
		if (binding.sessionId !== sessionId || !isDeepStrictEqual(binding.reference, policy.reference))
			refuse("policy-binding-changed");
		const matches = (await options.repositories(binding)).filter(
			(repo) => repo.projectId === policy.repository.projectId,
		);
		if (matches.length !== 1 || !isDeepStrictEqual(matches[0], policy.repository))
			refuse("policy-repository-changed");
		const current = await options.checkout(sessionId, policy.repository);
		if (
			current.branch !== policy.repository.sourceBranch ||
			!sha(current.sha) ||
			!(await options.isAncestor(sessionId, policy.repository, policy.baselineSha, current.sha))
		)
			refuse("checkout-not-descendant-of-policy-baseline");
		return current;
	}
	async function prepare(
		sessionId: string,
		input: {
			operationId: string;
			projectId: string;
			baselineSha?: string;
			title: string;
			body: string;
			mode: IssueAutomationPolicy["mode"];
			closeIssue: boolean;
			reason: string;
			acceptance: string;
		},
	) {
		if (
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.operationId) ||
			!text(input.title) ||
			!text(input.body) ||
			!["draft", "auto-merge", "manual"].includes(input.mode) ||
			typeof input.closeIssue !== "boolean" ||
			!text(input.reason, !input.closeIssue) ||
			!text(input.acceptance, !input.closeIssue)
		)
			refuse("policy-input-invalid");
		const binding = await options.binding(sessionId);
		if (binding.sessionId !== sessionId) refuse("session-mismatch");
		const matches = (await options.repositories(binding)).filter(
			(repo) => repo.projectId === input.projectId,
		);
		const repository = matches[0];
		if (
			matches.length !== 1 ||
			!repository ||
			!Object.values(repository).every((value) => text(value))
		)
			refuse("repository-identity-incomplete");
		const current = await options.checkout(sessionId, repository);
		if (!sha(current.sha) || current.branch !== repository.sourceBranch) refuse("checkout-invalid");
		const payload: IssueAutomationPolicy = {
			stage: "issue-automation-policy",
			sessionId,
			operationId: input.operationId,
			reference: binding.reference,
			repository,
			baselineSha: current.sha,
			title: input.title,
			body: input.body,
			mode: input.mode,
			closeIssue: input.closeIssue,
			reason: input.closeIssue ? input.reason : "",
			acceptance: input.closeIssue ? input.acceptance : "",
		};
		const stored = await options.journal.prepare(sessionId, input.operationId, payload);
		return { digest: stored.digest, questions: policyQuestions(payload) };
	}
	function policyPayload(
		value: unknown,
		sessionId: string,
		operationId: string,
	): IssueAutomationPolicy {
		const payload = object(value);
		if (
			payload.stage !== "issue-automation-policy" ||
			payload.sessionId !== sessionId ||
			payload.operationId !== operationId
		)
			refuse("policy-invalid");
		return payload as unknown as IssueAutomationPolicy;
	}
	async function proof(sessionId: string, operationId: string) {
		const record = await options.journal.inspect?.(sessionId, operationId);
		if (record?.status !== "completed") refuse("policy-receipt-incomplete");
		const policy = policyPayload(record.payload, sessionId, operationId);
		const result = object(record.result);
		if (
			record.digest !== digest(policy) ||
			result.stage !== policy.stage ||
			result.policyOperationId !== operationId ||
			result.policyDigest !== record.digest ||
			result.payloadDigest !== digest(policy) ||
			typeof result.toolCallId !== "string" ||
			!result.toolCallId
		)
			refuse("policy-receipt-invalid");
		await preflight(sessionId, policy);
		const authorization: IssueAutomationAuthorization = Object.freeze({
			policyOperationId: operationId,
			policyDigest: record.digest,
			payloadDigest: digest(policy),
			toolCallId: result.toolCallId,
		});
		return { policy, authorization };
	}
	async function execute(sessionId: string, operationId: string, toolCallId: string) {
		const stored = await options.journal.get(sessionId, operationId);
		if (!stored) refuse("policy-missing");
		const payload = policyPayload(stored.payload, sessionId, operationId);
		if (!options.verifyAnswer) refuse("policy-questionnaire-unavailable");
		await options.verifyAnswer(sessionId, payload, toolCallId);
		return options.journal.execute(
			sessionId,
			operationId,
			stored.digest,
			toolCallId,
			async () => ({
				stage: payload.stage,
				policyOperationId: operationId,
				policyDigest: stored.digest,
				payloadDigest: digest(payload),
				toolCallId,
			}),
			async () => {
				const current = await preflight(sessionId, payload);
				if (current.sha !== payload.baselineSha) refuse("policy-checkout-changed");
			},
		);
	}
	async function children(sessionId: string, policy: IssueAutomationPolicy) {
		return (await options.journal.listCompleted()).filter((entry) => {
			if (entry.sessionId !== sessionId) return false;
			const p = object(entry.payload);
			const head = p.stage === "delivery" ? p.sha : p.expectedSha;
			return (
				typeof p.stage === "string" &&
				entry.operationId === childId(policy, p.stage, typeof head === "string" ? head : "")
			);
		});
	}
	async function pinnedRequest(
		sessionId: string,
		policy: IssueAutomationPolicy,
	): Promise<{ iid: number; id?: number } | undefined> {
		let pinned: { iid: number; id?: number } | undefined;
		for (const entry of await children(sessionId, policy)) {
			const p = object(entry.payload);
			if (p.stage !== "delivery" && p.stage !== "ready-mr" && p.stage !== "merge-mr") continue;
			const result = object(entry.result);
			const iid = p.stage === "delivery" ? result.number : p.iid;
			if (typeof iid !== "number" || !Number.isSafeInteger(iid) || iid <= 0)
				refuse("child-receipt-invalid");
			const before = p.stage === "delivery" ? p.existing : p.before;
			const after = p.stage === "delivery" ? result.request : undefined;
			const requestId = before ? object(before).id : after ? object(after).id : undefined;
			if (
				pinned &&
				(pinned.iid !== iid ||
					(pinned.id !== undefined && requestId !== undefined && pinned.id !== requestId))
			)
				refuse("request-identity-changed");
			pinned = {
				iid,
				...(typeof requestId === "number"
					? { id: requestId }
					: pinned?.id !== undefined
						? { id: pinned.id }
						: {}),
			};
		}
		return pinned;
	}
	/** Wire this directly to each real child action's authorize callback. */
	async function authorizeChild(sessionId: string, value: unknown, token: unknown): Promise<void> {
		const supplied = object(token);
		if (typeof supplied.policyOperationId !== "string") refuse("authorization-invalid");
		const { policy, authorization } = await proof(sessionId, supplied.policyOperationId);
		if (!isDeepStrictEqual(supplied, authorization)) refuse("authorization-invalid");
		const p = object(value);
		if (
			p.sessionId !== sessionId ||
			!isDeepStrictEqual(p.reference, policy.reference) ||
			(p.warnings !== undefined && (!Array.isArray(p.warnings) || p.warnings.length > 0))
		)
			refuse("child-binding-or-warnings-invalid");
		const state = await options.deliveryState?.(sessionId);
		const repoState = state?.repositories.find(
			(entry) => entry.projectId === policy.repository.projectId,
		);
		if (!repoState) refuse("delivery-state-unavailable");
		if (repoState.dependsOn.length) {
			if (!options.dependencyPreflight) refuse("dependency-preflight-unavailable");
			await options.dependencyPreflight(sessionId, policy.repository.projectId);
		}
		if (p.stage === "close-issue") {
			const pinned = await pinnedRequest(sessionId, policy);
			if (
				!pinned ||
				!policy.closeIssue ||
				p.reason !== policy.reason ||
				p.acceptance !== policy.acceptance ||
				p.operationId !== childId(policy, "close-issue") ||
				!options.observeMerged ||
				!(await options.observeMerged(sessionId, policy, pinned.iid))
			)
				refuse("issue-close-facts-not-satisfied");
			return;
		}
		if (
			policy.mode === "manual" ||
			!["delivery", "ready-mr", "merge-mr"].includes(String(p.stage)) ||
			(policy.mode === "draft" && p.stage !== "delivery")
		)
			refuse("child-action-not-authorized");
		const repo = object(p.repository);
		const current = await preflight(sessionId, policy);
		const head = p.stage === "delivery" ? p.sha : p.expectedSha;
		const before = p.stage === "delivery" ? p.existing : p.before;
		if (
			repo.projectId !== policy.repository.projectId ||
			repo.workspaceId !== policy.repository.workspaceId ||
			p.repositoryId !== policy.repository.repositoryId ||
			p.targetBranch !== policy.repository.targetBranch ||
			head !== current.sha ||
			p.operationId !== childId(policy, String(p.stage), current.sha)
		)
			refuse("child-repository-or-checkout-mismatch");
		if (
			p.stage === "delivery" &&
			(p.branch !== policy.repository.sourceBranch ||
				p.title !== policy.title ||
				p.body !== policy.body)
		)
			refuse("delivery-content-changed");
		const pinned = await pinnedRequest(sessionId, policy);
		if (before) {
			const request = object(before);
			if (
				request.sourceBranch !== policy.repository.sourceBranch ||
				request.targetBranch !== policy.repository.targetBranch ||
				String(request.sourceProjectId) !== policy.repository.repositoryId ||
				String(request.targetProjectId) !== policy.repository.repositoryId ||
				(p.stage !== "delivery" && p.iid !== request.iid) ||
				(pinned &&
					(request.iid !== pinned.iid || (pinned.id !== undefined && request.id !== pinned.id)))
			)
				refuse("request-identity-changed");
		} else if (p.stage !== "delivery" || pinned) refuse("request-identity-changed");
	}
	async function advance(sessionId: string, policyOperationId: string, repoProjectId: string) {
		const { policy, authorization } = await proof(sessionId, policyOperationId);
		if (policy.repository.projectId !== repoProjectId) refuse("repository-policy-mismatch");
		if (policy.mode === "manual") return { status: "needs-user" as const };
		if (!options.deliveryState) refuse("delivery-state-unavailable");
		const deliveryState = await options.deliveryState(sessionId);
		const entry = deliveryState.repositories.find((repo) => repo.projectId === repoProjectId);
		if (
			!entry ||
			entry.policy !== policy.mode ||
			entry.sourceBranch !== policy.repository.sourceBranch ||
			entry.targetBranch !== policy.repository.targetBranch ||
			entry.worktreeId !== policy.repository.workspaceId
		)
			refuse("delivery-state-policy-mismatch");
		if (
			entry.validations.length === 0 ||
			entry.validations.some(
				(validation) =>
					validation.source !== "host-observed" ||
					validation.result !== "passed" ||
					validation.sha !== entry.checkoutSha ||
					validation.tree !== entry.checkoutTree ||
					validation.targetBranch !== entry.targetBranch,
			)
		)
			refuse("host-validation-evidence-required");
		if (entry.dependsOn.length) {
			if (!options.dependencyPreflight) refuse("dependency-preflight-unavailable");
			await options.dependencyPreflight(sessionId, repoProjectId);
		}
		const current = await preflight(sessionId, policy);
		async function run(
			action: string,
			prepareChild: (operationId: string) => Promise<unknown>,
			executeChild: NonNullable<IssueAutomationActionsOptions["delivery"]>["execute"],
			head = current.sha,
		) {
			const operationId = childId(policy, action, head);
			let record = await options.journal.inspect?.(sessionId, operationId);
			if (!record) refuse("journal-inspection-unavailable");
			if (record.status === "uncertain") refuse("child-intent-uncertain");
			if (record.status === "missing") {
				await prepareChild(operationId);
				record = await options.journal.inspect?.(sessionId, operationId);
			}
			if (!record || record.status === "missing") refuse("child-not-prepared");
			if (record.status === "completed") return record.result;
			await authorizeChild(sessionId, record.payload, authorization);
			await executeChild(sessionId, operationId, authorization.toolCallId, authorization);
			const receipt = await options.journal.inspect?.(sessionId, operationId);
			if (receipt?.status !== "completed") refuse("child-receipt-incomplete");
			return receipt.result;
		}
		async function closeIfChosen() {
			if (!policy.closeIssue) return { status: "completed" as const };
			const pinned = await pinnedRequest(sessionId, policy);
			if (
				!pinned ||
				!options.observeMerged ||
				!(await options.observeMerged(sessionId, policy, pinned.iid))
			)
				return { status: "blocked" as const, reason: "issue-close-facts-not-satisfied" };
			const close = options.close;
			if (!close) return { status: "blocked" as const, reason: "close-action-unavailable" };
			await run(
				"close-issue",
				(operationId) =>
					close.prepare(sessionId, {
						operationId,
						reason: policy.reason,
						acceptance: policy.acceptance,
					}),
				close.execute,
				"",
			);
			return { status: "completed" as const };
		}
		const merged = (await children(sessionId, policy)).find(
			(entry) => object(entry.payload).stage === "merge-mr",
		);
		if (merged) return closeIfChosen();
		const delivery = options.delivery;
		if (!delivery) return { status: "blocked" as const, reason: "delivery-action-unavailable" };
		const result = object(
			await run(
				"delivery",
				(operationId) =>
					delivery.prepare(sessionId, {
						operationId,
						projectId: repoProjectId,
						title: policy.title,
						body: policy.body,
						targetBranch: policy.repository.targetBranch,
					}),
				delivery.execute,
			),
		);
		if (
			typeof result.number !== "number" ||
			!Number.isSafeInteger(result.number) ||
			result.number <= 0 ||
			result.sha !== current.sha
		)
			refuse("delivery-receipt-invalid");
		if (policy.mode === "draft") return { status: "completed" as const, delivery: result };
		const iid = result.number;
		const mergeRequest = options.mergeRequest;
		if (!mergeRequest || !options.request || !options.readiness)
			return { status: "blocked" as const, reason: "lifecycle-actions-unavailable" };
		const request = await options.request(sessionId, repoProjectId, iid);
		const pinned = await pinnedRequest(sessionId, policy);
		if (
			!pinned ||
			request.iid !== iid ||
			(pinned.id !== undefined && request.id !== pinned.id) ||
			request.sha !== current.sha ||
			request.sourceBranch !== policy.repository.sourceBranch ||
			request.targetBranch !== policy.repository.targetBranch ||
			String(request.sourceProjectId) !== policy.repository.repositoryId ||
			String(request.targetProjectId) !== policy.repository.repositoryId
		)
			refuse("request-identity-changed");
		if (request.state === "merged") return closeIfChosen();
		if (request.state !== "opened")
			return { status: "blocked" as const, reason: "request-not-opened" };
		const prepareMr = (action: "ready-mr" | "merge-mr") => (operationId: string) =>
			mergeRequest.prepare(sessionId, action, {
				operationId,
				projectId: repoProjectId,
				iid,
				targetBranch: policy.repository.targetBranch,
				expectedSha: current.sha,
			});
		if (request.draft === true) await run("ready-mr", prepareMr("ready-mr"), mergeRequest.execute);
		else if (request.draft !== false)
			return { status: "blocked" as const, reason: "request-draft-state-unknown" };
		// Read fresh readiness AFTER ready; ready itself can start checks.
		const readiness = await options.readiness(sessionId, repoProjectId, iid, current.sha);
		if (
			!["passed", "pending"].includes(readiness.checks) ||
			!["satisfied", "pending"].includes(readiness.approval)
		)
			return {
				status: "blocked" as const,
				reason: "checks-or-approval-failed-or-unknown",
				readiness,
			};
		if (readiness.checks !== "passed" || readiness.approval !== "satisfied")
			return { status: "waiting" as const, reason: "checks-or-approval-pending", readiness };
		await run("merge-mr", prepareMr("merge-mr"), mergeRequest.execute);
		return closeIfChosen();
	}
	return { prepare, execute, proof, authorizeChild, advance };
}
