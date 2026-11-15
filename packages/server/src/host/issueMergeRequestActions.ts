import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { IssueReference } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueDeliveryRemote, IssueMergeRequest } from "../issues";
import type { IssueConfirmationStore } from "./issueConfirmations";
import type { IssueSessionAssociation } from "./issueSessions";

export interface MergeRequestPayload {
	stage: "ready-mr" | "merge-mr";
	sessionId: string;
	operationId: string;
	reference: IssueReference;
	repository: { projectId: string; workspaceId: string; path: string; name: string };
	repositoryId: string;
	iid: number;
	targetBranch: string;
	expectedSha: string;
	targetSha: string;
	before: IssueMergeRequest;
	readiness?: import("../issues").IssueMergeReadiness;
}
function blocked(reason: string): never {
	throw new CodedError(
		"ISSUE_DELIVERY_REFUSED",
		`Issue MR operation refused [${reason}]. Inspect the operation with issue_prepare_confirmation({operationId, inspect:true}).`,
	);
}
function validSha(value: unknown): value is string {
	return typeof value === "string" && /^[a-fA-F0-9]{40}$/.test(value);
}
function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function sameRequestTargetAndHead(current: IssueMergeRequest, before: IssueMergeRequest): boolean {
	return (
		current.id === before.id &&
		current.iid === before.iid &&
		current.webUrl === before.webUrl &&
		current.sourceBranch === before.sourceBranch &&
		current.targetBranch === before.targetBranch &&
		current.sourceProjectId === before.sourceProjectId &&
		current.targetProjectId === before.targetProjectId &&
		current.sha === before.sha
	);
}
function validRequest(
	request: IssueMergeRequest,
	payload: Pick<MergeRequestPayload, "repositoryId" | "iid" | "targetBranch" | "expectedSha">,
): boolean {
	return (
		request.iid === payload.iid &&
		request.id > 0 &&
		request.state === "opened" &&
		request.targetBranch === payload.targetBranch &&
		request.sha === payload.expectedSha &&
		request.sourceProjectId === Number(payload.repositoryId) &&
		request.targetProjectId === Number(payload.repositoryId)
	);
}
export function mergeRequestQuestions(payload: MergeRequestPayload) {
	const ready = payload.stage === "ready-mr";
	return {
		questions: [
			{
				question: ready
					? "Mark this exact pull/merge request ready for review?"
					: "Merge this exact pull/merge request?",
				header: ready ? "Ready for review" : "Merge request",
				preview: `Issue: ${payload.reference.instanceUrl} / ${payload.reference.projectId} #${payload.reference.number}\nRepository: ${payload.repository.name} (${payload.repository.projectId})\nMR/PR: #${payload.iid} ${payload.before.webUrl}\nTarget: ${payload.targetBranch}\nHead: ${payload.expectedSha}\nObserved provider checks: mergeability=${payload.before.mergeStatus}; details=${payload.before.detailedMergeStatus ?? "unknown"}; pipeline=${payload.before.headPipeline?.status ?? "unknown"} at ${payload.before.headPipeline?.sha ?? "unknown"}\n\nAction: ${ready ? "mark ready only" : "merge only"}. ${ready ? "No merge is authorized." : "After merge, read the actual target branch SHA."}\nVersion: ${digest(payload)}`,
				options: [
					{
						label: "Looks right",
						description: ready ? "Mark only this request ready." : "Merge only this request.",
					},
				],
			},
		],
	};
}
export interface IssueMergeRequestActionOptions {
	binding(sessionId: string): Promise<IssueSessionAssociation>;
	access(
		binding: IssueSessionAssociation,
		repositoryProjectId: string,
	): Promise<{
		remote: Pick<
			IssueDeliveryRemote,
			| "project"
			| "mergeRequest"
			| "mergeReadiness"
			| "mergeEvidence"
			| "setMergeRequestReady"
			| "mergeMergeRequest"
			| "targetBranchSha"
		>;
		guard(): void;
	}>;
	repositories(
		binding: IssueSessionAssociation,
	): Promise<readonly { projectId: string; workspaceId: string; path: string; name: string }[]>;
	verifyAnswer?(sessionId: string, payload: MergeRequestPayload, toolCallId: string): Promise<void>;
	authorize?(
		sessionId: string,
		payload: MergeRequestPayload,
		authorization: unknown,
	): Promise<void>;
	journal: IssueConfirmationStore;
}
export function createIssueMergeRequestActions(options: IssueMergeRequestActionOptions) {
	async function prepare(
		sessionId: string,
		action: "ready-mr" | "merge-mr",
		input: {
			operationId: string;
			projectId: string;
			iid: number;
			targetBranch: string;
			expectedSha: string;
		},
	) {
		if (
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.operationId) ||
			!input.projectId ||
			!Number.isSafeInteger(input.iid) ||
			input.iid <= 0 ||
			!input.targetBranch ||
			!validSha(input.expectedSha)
		)
			blocked("input-invalid");
		const binding = await options.binding(sessionId);
		if (binding.stage !== "implementation") blocked("session-stage-invalid");
		const repositories = await options.repositories(binding);
		const matches = repositories.filter((repository) => repository.projectId === input.projectId);
		if (matches.length !== 1) blocked("repository-not-participating");
		const repository = matches[0];
		if (!repository) blocked("repository-not-participating");
		const { remote, guard } = await options.access(binding, repository.projectId);
		const repositoryConnection = await remote.project();
		guard();
		const request = await remote.mergeRequest(input.iid);
		guard();
		if (
			!validRequest(request, {
				repositoryId: String(repositoryConnection.id),
				iid: input.iid,
				targetBranch: input.targetBranch,
				expectedSha: input.expectedSha,
			})
		)
			blocked("request-identity-or-head-mismatch");
		let readiness: MergeRequestPayload["readiness"];
		if (action === "merge-mr") {
			if (request.draft !== false) blocked("request-not-ready");
			if (!remote.mergeReadiness) blocked("checks-and-approvals-capability-unavailable");
			readiness = await remote.mergeReadiness(input.iid, input.expectedSha);
			guard();
			if (
				readiness.actualSha !== input.expectedSha ||
				readiness.expectedSha !== input.expectedSha ||
				readiness.sourceBranch !== request.sourceBranch ||
				readiness.targetBranch !== input.targetBranch ||
				readiness.checks !== "passed" ||
				readiness.approval !== "satisfied"
			)
				blocked("checks-or-approval-evidence-incomplete");
		}
		const targetSha = await remote.targetBranchSha(input.targetBranch);
		guard();
		if (!validSha(targetSha)) blocked("target-sha-invalid");
		const payload: MergeRequestPayload = {
			stage: action,
			sessionId,
			operationId: input.operationId,
			reference: binding.reference,
			repository,
			repositoryId: String(repositoryConnection.id),
			iid: input.iid,
			targetBranch: input.targetBranch,
			expectedSha: input.expectedSha,
			targetSha,
			before: request,
			...(readiness ? { readiness } : {}),
		};
		if (!validRequest(request, payload)) blocked("request-identity-or-head-mismatch");
		if (action === "ready-mr" && request.draft !== true) blocked("request-not-draft");
		const stored = await options.journal.prepare(sessionId, input.operationId, payload);
		return { digest: stored.digest, questions: mergeRequestQuestions(payload) };
	}
	async function execute(
		sessionId: string,
		operationId: string,
		toolCallId: string,
		authorization?: unknown,
	) {
		const candidate = await options.journal.get(sessionId, operationId);
		if (candidate?.payload && (candidate.payload as { stage?: string }).stage === "merge-mr") {
			const payload = candidate.payload as MergeRequestPayload;
			const readiness = await options.access(
				await options.binding(sessionId),
				payload.repository.projectId,
			);
			if (!readiness.remote.mergeReadiness) blocked("checks-and-approvals-capability-unavailable");
		}
		const stored = candidate;
		if (!stored) blocked("operation-missing");
		const payload = stored.payload as MergeRequestPayload;
		if (authorization !== undefined) {
			if (!options.authorize) blocked("policy-authorization-unavailable");
			await options.authorize(sessionId, payload, authorization);
		} else {
			if (!options.verifyAnswer) blocked("confirmation-unavailable");
			await options.verifyAnswer(sessionId, payload, toolCallId);
		}
		let access: Awaited<ReturnType<typeof options.access>> | undefined;
		let dispatched = false;
		async function preflight() {
			const binding = await options.binding(sessionId);
			if (!isDeepStrictEqual(binding.reference, payload.reference))
				blocked("issue-binding-changed");
			const remoteAccess = await options.access(binding, payload.repository.projectId);
			const project = await remoteAccess.remote.project();
			remoteAccess.guard();
			if (String(project.id) !== payload.repositoryId) blocked("repository-changed");
			const current = await remoteAccess.remote.mergeRequest(payload.iid);
			remoteAccess.guard();
			if (!validRequest(current, payload) || !sameRequestTargetAndHead(current, payload.before))
				blocked("request-snapshot-changed");
			if (binding.stage !== "implementation") blocked("session-stage-invalid");
			if (payload.stage === "ready-mr" && current.draft !== true)
				blocked("request-no-longer-draft");
			if (payload.stage === "merge-mr" && current.draft !== false)
				blocked("request-no-longer-ready");
			if (payload.stage === "merge-mr") {
				if (!remoteAccess.remote.mergeReadiness)
					blocked("checks-and-approvals-capability-unavailable");
				const readiness = await remoteAccess.remote.mergeReadiness(
					payload.iid,
					payload.expectedSha,
				);
				remoteAccess.guard();
				if (
					!payload.readiness ||
					!isDeepStrictEqual(readiness, payload.readiness) ||
					readiness.checks !== "passed" ||
					readiness.approval !== "satisfied"
				)
					blocked("checks-or-approval-snapshot-changed");
			}
			const targetSha = await remoteAccess.remote.targetBranchSha(payload.targetBranch);
			remoteAccess.guard();
			if (!validSha(targetSha) || targetSha !== payload.targetSha) blocked("target-sha-changed");
			access = remoteAccess;
		}
		return options.journal.execute(
			sessionId,
			operationId,
			stored.digest,
			toolCallId,
			async () => {
				if (!access) blocked("preflight-missing");
				dispatched = true;
				if (payload.stage === "ready-mr") {
					await access.remote.setMergeRequestReady(payload.iid);
				} else {
					if (!payload.readiness) blocked("checks-and-approvals-capability-unavailable");
					await access.remote.mergeMergeRequest(payload.iid, payload.expectedSha);
				}
				access.guard();
				const current = await access.remote.mergeRequest(payload.iid);
				access.guard();
				if (payload.stage === "ready-mr") {
					if (
						!validRequest(current, payload) ||
						!sameRequestTargetAndHead(current, payload.before) ||
						current.draft !== false
					)
						blocked("ready-state-not-observed");
					return {
						stage: payload.stage,
						issue: payload.reference,
						iid: payload.iid,
						webUrl: current.webUrl,
						targetBranch: current.targetBranch,
						headSha: current.sha,
						draft: false,
						digest: stored.digest,
					};
				}
				if (
					current.state !== "merged" ||
					current.sha !== payload.expectedSha ||
					current.targetBranch !== payload.targetBranch
				)
					blocked("merged-request-not-observed");
				if (!access.remote.mergeEvidence) blocked("merge-ancestry-capability-unavailable");
				const mergeEvidence = await access.remote.mergeEvidence(payload.iid);
				access.guard();
				if (
					mergeEvidence.relationship !== "ancestor" ||
					!mergeEvidence.mergeCommitSha ||
					!mergeEvidence.targetSha
				)
					blocked("merge-ancestry-not-proven");
				return {
					stage: payload.stage,
					issue: payload.reference,
					iid: payload.iid,
					webUrl: current.webUrl,
					targetBranch: current.targetBranch,
					headSha: current.sha,
					mergeCommitSha: mergeEvidence.mergeCommitSha,
					targetSha: mergeEvidence.targetSha,
					digest: stored.digest,
				};
			},
			preflight,
			() => dispatched,
		);
	}
	async function observe(sessionId: string, value: MergeRequestPayload) {
		const binding = await options.binding(sessionId);
		if (!isDeepStrictEqual(binding.reference, value.reference)) blocked("issue-binding-changed");
		const { remote, guard } = await options.access(binding, value.repository.projectId);
		const current = await remote.mergeRequest(value.iid);
		guard();
		const repository = await remote.project();
		guard();
		if (
			String(repository.id) !== value.repositoryId ||
			current.iid !== value.iid ||
			current.targetBranch !== value.targetBranch ||
			current.sha !== value.expectedSha ||
			!sameRequestTargetAndHead(current, value.before)
		)
			blocked("request-result-not-observed");
		if (value.stage === "ready-mr" && (current.draft !== false || current.state !== "opened"))
			blocked("ready-result-not-observed");
		if (value.stage === "merge-mr" && current.state !== "merged")
			blocked("merged-request-not-observed");
		if (value.stage === "merge-mr" && !remote.mergeEvidence)
			blocked("merge-ancestry-capability-unavailable");
		const mergeEvidence =
			value.stage === "merge-mr" ? await remote.mergeEvidence?.(value.iid) : null;
		guard();
		if (
			mergeEvidence &&
			(mergeEvidence.relationship !== "ancestor" ||
				!mergeEvidence.mergeCommitSha ||
				!mergeEvidence.targetSha)
		)
			blocked("merge-ancestry-not-proven");
		const targetSha =
			mergeEvidence?.targetSha ?? (await remote.targetBranchSha(value.targetBranch));
		guard();
		if (!validSha(targetSha) || (value.stage === "ready-mr" && targetSha !== value.targetSha))
			blocked("target-sha-changed");
		return {
			evidence: {
				state: current.state,
				draft: current.draft,
				targetBranch: current.targetBranch,
				headSha: current.sha,
				targetSha,
			},
			result: {
				stage: value.stage,
				issue: value.reference,
				iid: value.iid,
				webUrl: current.webUrl,
				targetBranch: current.targetBranch,
				headSha: current.sha,
				mergeCommitSha: mergeEvidence?.mergeCommitSha ?? current.mergeCommitSha,
				targetSha,
				digest: digest(value),
			},
		};
	}
	return { prepare, execute, observe };
}
