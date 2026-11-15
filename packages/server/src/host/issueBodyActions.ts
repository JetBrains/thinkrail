import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { IssueReference } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueDeliveryRemote, IssueRecord } from "../issues";
import type { IssueConfirmationStore } from "./issueConfirmations";
import type { IssueSessionAssociation } from "./issueSessions";

export interface IssueBodyPayload {
	stage: "update-body";
	sessionId: string;
	reference: IssueReference;
	operationId: string;
	before: IssueRecord;
	after: string;
}
function issueBodyPayload(value: unknown): value is IssueBodyPayload {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const payload = value as Partial<IssueBodyPayload>;
	return (
		payload.stage === "update-body" &&
		typeof payload.sessionId === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(payload.operationId ?? "") &&
		validBody(payload.after) &&
		payload.before !== undefined &&
		payload.reference !== undefined
	);
}
function blocked(reason: string): never {
	throw new CodedError(
		"ISSUE_CONFIRMATION_BLOCKED",
		`Issue body update refused [${reason}]. Inspect the original operation before continuing.`,
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
	});
}
function validBody(value: unknown): value is string {
	return typeof value === "string" && Buffer.byteLength(value, "utf8") <= 32000;
}
export function issueBodyQuestions(payload: IssueBodyPayload) {
	return {
		questions: [
			{
				question: EN["issue.confirm.body.question"] ?? "",
				header: EN["issue.confirm.body.header"] ?? "",
				preview: `Issue: ${payload.reference.instanceUrl} / ${payload.reference.projectId} #${payload.reference.number}\n\nCurrent complete body:\n${payload.before.description}\n\nComplete replacement body:\n${payload.after}\n\nThis updates only the description; labels and other Issue fields are unchanged.\nVersion: ${digest(payload)}`,
				options: [{ label: "Looks right", description: EN["issue.confirm.body.option"] ?? "" }],
			},
		],
	};
}
export interface IssueBodyActionOptions {
	binding(sessionId: string): Promise<IssueSessionAssociation>;
	access(
		binding: IssueSessionAssociation,
	): Promise<{ remote: Pick<IssueDeliveryRemote, "issue" | "updateIssue">; guard(): void }>;
	verifyAnswer(sessionId: string, payload: IssueBodyPayload, toolCallId: string): Promise<void>;
	journal: IssueConfirmationStore;
}
export function createIssueBodyActions(options: IssueBodyActionOptions) {
	async function prepare(sessionId: string, input: { operationId: string; body: string }) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.operationId) || !validBody(input.body))
			blocked("invalid-input");
		const binding = await options.binding(sessionId);
		const { remote, guard } = await options.access(binding);
		const before = await remote.issue(binding.reference.number);
		guard();
		if (before.iid !== binding.reference.number) blocked("issue-identity-mismatch");
		const payload: IssueBodyPayload = {
			stage: "update-body",
			sessionId,
			reference: binding.reference,
			operationId: input.operationId,
			before,
			after: input.body,
		};
		const stored = await options.journal.prepare(sessionId, input.operationId, payload);
		return { digest: stored.digest, questions: issueBodyQuestions(payload) };
	}
	async function execute(sessionId: string, operationId: string, toolCallId: string) {
		const stored = await options.journal.get(sessionId, operationId);
		if (!stored) blocked("operation-missing");
		if (!issueBodyPayload(stored.payload)) blocked("invalid-payload");
		const payload = stored.payload;
		if (payload.sessionId !== sessionId || payload.operationId !== operationId)
			blocked("operation-binding-mismatch");
		await options.verifyAnswer(sessionId, payload, toolCallId);
		let checked: Awaited<ReturnType<typeof preflight>> | undefined;
		let dispatched = false;
		async function preflight() {
			const binding = await options.binding(sessionId);
			if (!isDeepStrictEqual(binding.reference, payload.reference))
				blocked("issue-binding-changed");
			const access = await options.access(binding);
			const current = await access.remote.issue(payload.reference.number);
			access.guard();
			if (current.iid !== payload.reference.number) blocked("issue-identity-mismatch");
			if (snapshot(current) !== snapshot(payload.before)) blocked("body-snapshot-changed");
			return { ...access, current };
		}
		return options.journal.execute(
			sessionId,
			operationId,
			stored.digest,
			toolCallId,
			async () => {
				if (!checked) blocked("preflight-missing");
				dispatched = true;
				await checked.remote.updateIssue(payload.reference.number, { description: payload.after });
				checked.guard();
				const updated = await checked.remote.issue(payload.reference.number);
				checked.guard();
				if (
					updated.iid !== payload.reference.number ||
					updated.description !== payload.after ||
					updated.labels.toSorted().join("\0") !== checked.current.labels.toSorted().join("\0")
				)
					blocked("readback-mismatch");
				return {
					stage: "update-body",
					issue: payload.reference,
					description: updated.description,
					updatedAt: updated.updatedAt,
					digest: stored.digest,
				};
			},
			async () => {
				checked = await preflight();
			},
			() => dispatched,
		);
	}
	async function observe(sessionId: string, payload: IssueBodyPayload) {
		const binding = await options.binding(sessionId);
		if (!isDeepStrictEqual(binding.reference, payload.reference)) blocked("issue-binding-changed");
		const { remote, guard } = await options.access(binding);
		const current = await remote.issue(payload.reference.number);
		guard();
		if (
			current.iid !== payload.reference.number ||
			current.description !== payload.after ||
			current.labels.toSorted().join("\0") !== payload.before.labels.toSorted().join("\0")
		)
			blocked("recovery-result-not-observed");
		return {
			evidence: {
				description: current.description,
				labels: current.labels.toSorted(),
				updatedAt: current.updatedAt,
			},
			result: {
				stage: "update-body",
				issue: payload.reference,
				description: current.description,
				updatedAt: current.updatedAt,
				digest: digest(payload),
			},
		};
	}
	return { prepare, execute, observe };
}
