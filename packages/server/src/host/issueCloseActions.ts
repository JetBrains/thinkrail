import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { IssueReference } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueDeliveryRemote, IssueRecord } from "../issues";
import type { IssueConfirmationStore } from "./issueConfirmations";
import type { IssueSessionAssociation } from "./issueSessions";

export interface IssueClosePayload {
	stage: "close-issue";
	sessionId: string;
	reference: IssueReference;
	operationId: string;
	before: IssueRecord;
	reason: string;
	acceptance: string;
}
function validId(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function validText(value: unknown): value is string {
	return (
		typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= 8000
	);
}
function blocked(reason: string): never {
	throw new CodedError(
		"ISSUE_CONFIRMATION_BLOCKED",
		`Issue close refused [${reason}]. Inspect the original operation before continuing.`,
	);
}
function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function snapshot(issue: IssueRecord): string {
	return digest({
		iid: issue.iid,
		title: issue.title,
		description: issue.description,
		state: issue.state,
		labels: issue.labels,
		updatedAt: issue.updatedAt,
		closedAt: issue.closedAt,
	});
}
function payloadValid(value: unknown): value is IssueClosePayload {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const payload = value as Partial<IssueClosePayload>;
	return (
		payload.stage === "close-issue" &&
		typeof payload.sessionId === "string" &&
		validId(payload.operationId) &&
		payload.before !== undefined &&
		validText(payload.reason) &&
		typeof payload.acceptance === "string" &&
		Buffer.byteLength(payload.acceptance, "utf8") <= 8000 &&
		payload.reference !== undefined
	);
}
export function issueCloseQuestions(payload: IssueClosePayload) {
	return {
		questions: [
			{
				question: EN["issue.confirm.close.question"] ?? "",
				header: EN["issue.confirm.close.header"] ?? "",
				preview: `Issue: ${payload.reference.instanceUrl} / ${payload.reference.projectId} #${payload.reference.number}\n\nCurrent state: ${payload.before.state}\nClose reason: ${payload.reason}\n\nAcceptance evidence and unresolved items:\n${payload.acceptance}\n\nThe operation closes only this Issue. It does not merge a PR/MR.\nVersion: ${digest(payload)}`,
				options: [{ label: "Looks right", description: EN["issue.confirm.close.option"] ?? "" }],
			},
		],
	};
}
export interface IssueCloseActionOptions {
	binding(sessionId: string): Promise<IssueSessionAssociation>;
	access(
		binding: IssueSessionAssociation,
	): Promise<{ remote: Pick<IssueDeliveryRemote, "issue" | "closeIssue">; guard(): void }>;
	verifyAnswer?(sessionId: string, payload: IssueClosePayload, toolCallId: string): Promise<void>;
	authorize?(sessionId: string, payload: IssueClosePayload, authorization: unknown): Promise<void>;
	journal: IssueConfirmationStore;
}
export function createIssueCloseActions(options: IssueCloseActionOptions) {
	async function prepare(
		sessionId: string,
		input: { operationId: string; reason: string; acceptance: string },
	) {
		if (
			!validId(input.operationId) ||
			!validText(input.reason) ||
			!validText(input.acceptance) ||
			Buffer.byteLength(input.acceptance, "utf8") > 8000
		)
			blocked("invalid-input");
		const binding = await options.binding(sessionId);
		const { remote, guard } = await options.access(binding);
		const before = await remote.issue(binding.reference.number);
		guard();
		if (before.iid !== binding.reference.number || before.state !== "opened")
			blocked("issue-not-open");
		const payload: IssueClosePayload = {
			stage: "close-issue",
			sessionId,
			reference: binding.reference,
			operationId: input.operationId,
			before,
			reason: input.reason,
			acceptance: input.acceptance,
		};
		const stored = await options.journal.prepare(sessionId, input.operationId, payload);
		return { digest: stored.digest, questions: issueCloseQuestions(payload) };
	}
	async function execute(
		sessionId: string,
		operationId: string,
		toolCallId: string,
		authorization?: unknown,
	) {
		const stored = await options.journal.get(sessionId, operationId);
		if (!stored || !payloadValid(stored.payload)) blocked("operation-missing-or-invalid");
		const payload = stored.payload;
		if (payload.sessionId !== sessionId || payload.operationId !== operationId)
			blocked("operation-binding-mismatch");
		if (authorization !== undefined) {
			if (!options.authorize) blocked("policy-authorization-unavailable");
			await options.authorize(sessionId, payload, authorization);
		} else {
			if (!options.verifyAnswer) blocked("confirmation-unavailable");
			await options.verifyAnswer(sessionId, payload, toolCallId);
		}
		let checked: Awaited<ReturnType<typeof preflight>> | undefined;
		let dispatched = false;
		async function preflight() {
			const binding = await options.binding(sessionId);
			if (!isDeepStrictEqual(binding.reference, payload.reference))
				blocked("issue-binding-changed");
			const access = await options.access(binding);
			const current = await access.remote.issue(payload.reference.number);
			access.guard();
			if (current.iid !== payload.reference.number || current.state !== "opened")
				blocked("issue-state-changed");
			if (snapshot(current) !== snapshot(payload.before)) blocked("issue-snapshot-changed");
			return access;
		}
		return options.journal.execute(
			sessionId,
			operationId,
			stored.digest,
			toolCallId,
			async () => {
				if (!checked) blocked("preflight-missing");
				dispatched = true;
				await checked.remote.closeIssue(payload.reference.number);
				checked.guard();
				const closed = await checked.remote.issue(payload.reference.number);
				checked.guard();
				if (
					closed.iid !== payload.reference.number ||
					closed.state !== "closed" ||
					!closed.closedAt
				)
					blocked("closed-result-not-observed");
				return {
					stage: "close-issue",
					issue: payload.reference,
					reason: payload.reason,
					state: closed.state,
					closedAt: closed.closedAt,
					updatedAt: closed.updatedAt,
					digest: stored.digest,
				};
			},
			async () => {
				checked = await preflight();
			},
			() => dispatched,
		);
	}
	async function observe(sessionId: string, value: unknown) {
		if (!payloadValid(value)) blocked("invalid-payload");
		const payload = value;
		const binding = await options.binding(sessionId);
		if (!isDeepStrictEqual(binding.reference, payload.reference)) blocked("issue-binding-changed");
		const { remote, guard } = await options.access(binding);
		const closed = await remote.issue(payload.reference.number);
		guard();
		if (closed.iid !== payload.reference.number || closed.state !== "closed")
			blocked("closed-result-not-observed");
		if (!closed.closedAt) blocked("closed-timestamp-unavailable");
		return {
			evidence: {
				state: closed.state,
				closedAt: closed.closedAt,
				updatedAt: closed.updatedAt,
			},
			result: {
				stage: "close-issue",
				issue: payload.reference,
				reason: payload.reason,
				state: closed.state,
				closedAt: closed.closedAt,
				updatedAt: closed.updatedAt,
				digest: digest(payload),
			},
		};
	}
	return { prepare, execute, observe };
}
