import { createHash } from "node:crypto";
import { CodedError } from "@thinkrail/shared/codedError";
import type { GitLabLabelEvent, GitLabMember, GitLabNote } from "./client";

export const tomatoLabels = {
	design: "tomato::design-approved",
	implementation: "tomato::implementation-approved",
} as const;
export type ApprovalStage = keyof typeof tomatoLabels;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function designVersion(text: string): string {
	return `design:${digest(text)}`;
}
export function implementationVersion(commit: string, design: string): string {
	if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit) || !/^design:[a-f0-9]{64}$/.test(design))
		throw new CodedError("RANGE_INVALID", "Invalid approval version.");
	return `implementation:${digest(`${commit}\n${design}`)}`;
}
export interface ApprovalPublication {
	stage: ApprovalStage;
	version: string;
	noteId: number;
	resetEventId: number;
	body: string;
}
export function approvalPublication(input: Omit<ApprovalPublication, "body">): ApprovalPublication {
	if (
		!validVersion(input.stage, input.version) ||
		!Number.isSafeInteger(input.noteId) ||
		input.noteId <= 0 ||
		!Number.isSafeInteger(input.resetEventId) ||
		input.resetEventId < 0
	)
		throw new CodedError("RANGE_INVALID", "Invalid approval publication.");
	return {
		...input,
		body: `ThinkRail Tomato pending ${input.stage}\nVersion: ${input.version}\nReset event boundary: ${input.resetEventId}`,
	};
}
function validVersion(stage: ApprovalStage, version: string): boolean {
	return (
		(stage === "design" || stage === "implementation") &&
		new RegExp(`^${stage}:[a-f0-9]{64}$`).test(version)
	);
}
export interface ApprovalEvidence {
	stage: ApprovalStage;
	version: string;
	currentVersion: string;
	publication: ApprovalPublication;
	notes: readonly GitLabNote[];
	resetConfirmedAbsent: boolean;
	events: readonly GitLabLabelEvent[];
	labels: readonly string[];
	members: readonly GitLabMember[];
	beforeRevision: string;
	afterRevision: string;
}
export type ApprovalResult =
	| { approved: true; eventId: number; userId: number }
	| { approved: false; reason: "unproven" };
export function validateApproval(input: ApprovalEvidence): ApprovalResult {
	const denied = { approved: false, reason: "unproven" } as const;
	const p = input.publication;
	if (
		!validVersion(input.stage, input.version) ||
		input.version !== input.currentVersion ||
		p.version !== input.version ||
		p.stage !== input.stage ||
		!input.resetConfirmedAbsent ||
		!input.beforeRevision ||
		input.beforeRevision !== input.afterRevision ||
		!input.labels.includes(tomatoLabels[input.stage])
	)
		return denied;
	if (
		!Number.isSafeInteger(p.resetEventId) ||
		p.resetEventId < 0 ||
		!Number.isSafeInteger(p.noteId) ||
		p.noteId <= 0 ||
		p.body !== approvalPublication(p).body
	)
		return denied;
	const notes = input.notes.filter((n) => n.id === p.noteId);
	const note = notes[0];
	if (notes.length !== 1 || !note || note.body !== p.body) return denied;
	const publishedAt = Date.parse(note.createdAt);
	if (!Number.isFinite(publishedAt)) return denied;
	const events = [...input.events].sort((a, b) => a.id - b.id);
	let previousId = 0;
	let previousTime = -Infinity;
	let candidate: GitLabLabelEvent | undefined;
	let sawBoundary = p.resetEventId === 0;
	let labelPresentAtReset = false;
	for (const event of events) {
		const time = Date.parse(event.createdAt);
		if (
			!Number.isSafeInteger(event.id) ||
			event.id <= previousId ||
			!Number.isFinite(time) ||
			time <= previousTime ||
			!Number.isSafeInteger(event.userId) ||
			event.userId <= 0 ||
			(event.action !== "add" && event.action !== "remove")
		)
			return denied;
		previousId = event.id;
		previousTime = time;
		if (event.id <= p.resetEventId) {
			if (time >= publishedAt) return denied;
			if (event.id === p.resetEventId) sawBoundary = true;
			if (event.label === tomatoLabels[input.stage]) labelPresentAtReset = event.action === "add";
			continue;
		}
		if (event.label === null) return denied;
		if (event.label !== tomatoLabels[input.stage]) continue;
		if (time <= publishedAt) return denied;
		if (event.action === "remove") candidate = undefined;
		else {
			if (candidate) return denied;
			candidate = event;
		}
	}
	if (!sawBoundary || labelPresentAtReset || !candidate) return denied;
	const roles = input.members.filter((m) => m.userId === candidate.userId);
	if (roles.length !== 1 || ![30, 40, 50].includes(roles[0]?.accessLevel ?? 0)) return denied;
	return { approved: true, eventId: candidate.id, userId: candidate.userId };
}
