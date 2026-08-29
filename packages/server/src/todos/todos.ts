import type {
	GitFileChange,
	TodoArtifact,
	TodoItem,
	TodoPlan,
	TodoReviewInfo,
	TodoStatus,
} from "@thinkrail/contracts";
import {
	flatItems,
	groupStatus,
	type Todo as StoredItem,
	type TodoPlan as StoredPlan,
	TodoStore,
} from "pi-todos/core";
import { gitStatus } from "../git";
import { getWorkspace } from "../workspaces";
import { enqueueTodoMutation, settleChangeArtifacts, unattributedChanges } from "./artifacts";
import { dropItemBaseline, readBaselines, removeSessionBaselines } from "./baselines";
import {
	clearAutoCycles,
	clearReviewPending,
	dropReviewRecord,
	findWorkerSessionByReviewer,
	markReviewPending,
	putReviewRecord,
	readAutoCycles,
	readReviewMeta,
	readReviewRecords,
	removeSessionReviews,
	setAutoCycles,
	setReviewerSession,
	type TodoReviewRecord,
} from "./reviews";

function storeFor(workspaceId: string, sessionId: string): TodoStore {
	return new TodoStore(getWorkspace(workspaceId).worktreePath, sessionId);
}

const commitFilesCache = new Map<string, GitFileChange[]>();

async function resolveCommitFiles(
	workspaceId: string,
	sha: string,
): Promise<GitFileChange[] | undefined> {
	const key = `${workspaceId}\u0000${sha}`;
	const hit = commitFilesCache.get(key);
	if (hit) return hit;
	try {
		const files = (await gitStatus(workspaceId, { kind: "commit", sha })).changes;
		commitFilesCache.set(key, files);
		return files;
	} catch {
		return undefined;
	}
}

async function toWireItem(
	workspaceId: string,
	item: StoredItem,
	record: TodoReviewRecord | undefined,
	reviewing: boolean,
): Promise<TodoItem> {
	if (!item.artifacts) return item;
	const artifacts = await Promise.all(
		item.artifacts.map(async (a): Promise<TodoArtifact> => {
			if (a.kind !== "commit" || !a.sha) return a;
			const files = await resolveCommitFiles(workspaceId, a.sha);
			return files ? { ...a, files } : a;
		}),
	);
	const review = reviewInfo(item, record, reviewing);
	return review ? { ...item, artifacts, review } : { ...item, artifacts };
}

function commitShas(item: StoredItem): string[] {
	return (item.artifacts ?? []).flatMap((a) => (a.kind === "commit" && a.sha ? [a.sha] : []));
}

function isReviewable(item: StoredItem): boolean {
	return (item.artifacts ?? []).some(
		(a) => (a.kind === "commit" && a.sha) || (a.kind === "change" && a.path),
	);
}

function reviewInfo(
	item: StoredItem,
	record: TodoReviewRecord | undefined,
	reviewing = false,
): TodoReviewInfo | undefined {
	if (!isReviewable(item)) return undefined;
	const shas = commitShas(item);
	const info: TodoReviewInfo = { state: record?.state ?? "unreviewed", revision: shas.length };
	if (reviewing) info.reviewing = true;
	if (record?.state === "reviewed" && record.reviewedBy) info.reviewedBy = record.reviewedBy;
	if (record) {
		const seen = new Set(record.reviewedShas);
		const unreviewed = shas.filter((sha) => !seen.has(sha));
		if (unreviewed.length > 0) info.unreviewedShas = unreviewed;
		if (record.state === "changes_requested" && record.feedback) info.feedback = record.feedback;
		info.at = record.at;
	}
	return info;
}

async function resolveUnattributed(
	workspaceId: string,
	root: string,
	sessionId: string,
	plan: StoredPlan,
): Promise<GitFileChange[]> {
	try {
		return unattributedChanges(
			(await gitStatus(workspaceId, { kind: "uncommitted" })).changes,
			plan,
			readBaselines(root, sessionId),
		);
	} catch {
		return [];
	}
}

export async function listTodos(params: {
	workspaceId: string;
	sessionId: string;
}): Promise<TodoPlan> {
	await settleChangeArtifacts(params.workspaceId);
	const root = getWorkspace(params.workspaceId).worktreePath;
	const plan = new TodoStore(root, params.sessionId).read();
	const records = readReviewRecords(root, params.sessionId);
	const pending = readReviewMeta(root, params.sessionId).pending;
	const wire: TodoPlan = {
		todos: await Promise.all(
			plan.todos.map((t) => toWireItem(params.workspaceId, t, records[t.id], t.id in pending)),
		),
		groups: await Promise.all(
			plan.groups.map(async (group) => ({
				...group,
				todos: await Promise.all(
					group.todos.map((t) => toWireItem(params.workspaceId, t, records[t.id], t.id in pending)),
				),
				status: groupStatus(group),
			})),
		),
	};
	if (plan.summary) wire.summary = plan.summary;
	const unattributed = await resolveUnattributed(params.workspaceId, root, params.sessionId, plan);
	if (unattributed.length > 0) wire.unattributed = unattributed;
	const reviewer = readReviewMeta(root, params.sessionId).reviewerSessionId;
	if (reviewer) wire.reviewerSessionId = reviewer;
	return wire;
}

export function countOpenTodos(params: { workspaceId: string; sessionId: string }): number {
	return openTodoCount(storeFor(params.workspaceId, params.sessionId).read());
}

export function openTodoCount(plan: StoredPlan): number {
	return flatItems(plan).filter((item) => item.status !== "done").length;
}

export function removeSessionTodoWindows(params: {
	workspaceId: string;
	sessionId: string;
}): Promise<void> {
	return enqueueTodoMutation(params.workspaceId, () => {
		const root = getWorkspace(params.workspaceId).worktreePath;
		removeSessionBaselines(root, params.sessionId);
		removeSessionReviews(root, params.sessionId);
	});
}

export function addTodo(params: {
	workspaceId: string;
	sessionId: string;
	title: string;
	note?: string;
}): TodoItem {
	const title = params.title?.trim();
	if (!title) throw new Error("A TODO title is required.");
	const input: { title: string; note?: string; origin: "user" } = {
		title,
		origin: "user",
	};
	if (params.note !== undefined) input.note = params.note;
	return storeFor(params.workspaceId, params.sessionId).add(input);
}

export function updateTodo(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
	status?: TodoStatus;
	title?: string;
	note?: string;
}): TodoItem {
	const patch: { status?: TodoStatus; title?: string; note?: string } = {};
	if (params.status !== undefined) patch.status = params.status;
	if (params.title !== undefined) patch.title = params.title;
	if (params.note !== undefined) patch.note = params.note;
	const result = storeFor(params.workspaceId, params.sessionId).update(params.id, patch);
	if (!result) throw new Error(`No TODO with id "${params.id}".`);
	return result.todo;
}

export function removeTodo(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
}): Promise<{
	ok: true;
}> {
	return enqueueTodoMutation(params.workspaceId, () => {
		const root = getWorkspace(params.workspaceId).worktreePath;
		if (readReviewMeta(root, params.sessionId).pending[params.id]) {
			throw new Error(
				`TODO "${params.id}" is currently under review — cancel or wait for the review to finish before removing it.`,
			);
		}
		new TodoStore(root, params.sessionId).remove(params.id);
		dropItemBaseline(root, params.sessionId, params.id);
		dropReviewRecord(root, params.sessionId, params.id);
		clearAutoCycles(root, params.sessionId, params.id);
		return { ok: true } as const;
	});
}

function reviewableItem(params: { workspaceId: string; sessionId: string; id: string }): {
	root: string;
	item: StoredItem;
} {
	const root = getWorkspace(params.workspaceId).worktreePath;
	const item = new TodoStore(root, params.sessionId).get(params.id);
	if (!item) throw new Error(`No TODO with id "${params.id}".`);
	if (!isReviewable(item)) throw new Error(`TODO "${params.id}" has no change set to review.`);
	return { root, item };
}

function reviewedWatermark(
	root: string,
	sessionId: string,
	id: string,
	item: StoredItem,
): string[] {
	return readReviewMeta(root, sessionId).pending[id]?.shas ?? commitShas(item);
}

export function approveTodoReview(
	params: { workspaceId: string; sessionId: string; id: string },
	by?: "agent",
): {
	ok: true;
} {
	const { root, item } = reviewableItem(params);
	putReviewRecord(root, params.sessionId, params.id, {
		state: "reviewed",
		reviewedShas: reviewedWatermark(root, params.sessionId, params.id, item),
		at: new Date().toISOString(),
		...(by ? { reviewedBy: by } : {}),
	});
	clearReviewPending(root, params.sessionId, params.id);
	clearAutoCycles(root, params.sessionId, params.id);
	return { ok: true } as const;
}

export function reviewerSessionFor(params: {
	workspaceId: string;
	sessionId: string;
}): string | undefined {
	return readReviewMeta(getWorkspace(params.workspaceId).worktreePath, params.sessionId)
		.reviewerSessionId;
}

export function pinReviewerSession(
	params: { workspaceId: string; sessionId: string },
	reviewerId: string,
): void {
	setReviewerSession(getWorkspace(params.workspaceId).worktreePath, params.sessionId, reviewerId);
}

export function workerSessionForReviewer(
	workspaceId: string,
	reviewerId: string,
): string | undefined {
	return findWorkerSessionByReviewer(getWorkspace(workspaceId).worktreePath, reviewerId);
}

export function startTodoReview(params: { workspaceId: string; sessionId: string; id: string }): {
	pkg: string;
	reviewedSha: string;
} {
	const { root, item } = reviewableItem(params);
	const record = readReviewRecords(root, params.sessionId)[params.id];
	const shas = commitShas(item);
	markReviewPending(root, params.sessionId, params.id, shas);
	return {
		pkg: renderReviewPackage(item, params.sessionId, record),
		reviewedSha: shas.at(-1) ?? "",
	};
}

export function reviewedShaSuperseded(
	params: { workspaceId: string; sessionId: string; id: string },
	reviewedSha: string,
): boolean {
	if (!reviewedSha) return false;
	let item: StoredItem;
	try {
		item = reviewableItem(params).item;
	} catch {
		return false;
	}
	const shas = commitShas(item);
	return shas.length > 0 && shas.at(-1) !== reviewedSha;
}

export function cancelTodoReview(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
}): void {
	clearReviewPending(getWorkspace(params.workspaceId).worktreePath, params.sessionId, params.id);
}

export function recordAgentChangesRequested(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
	note?: string;
	autoCycles: number;
}): { item: StoredItem } {
	const { root, item } = reviewableItem(params);
	putReviewRecord(root, params.sessionId, params.id, {
		state: "changes_requested",
		reviewedShas: reviewedWatermark(root, params.sessionId, params.id, item),
		...(params.note ? { feedback: params.note } : {}),
		at: new Date().toISOString(),
	});
	setAutoCycles(root, params.sessionId, params.id, params.autoCycles);
	clearReviewPending(root, params.sessionId, params.id);
	return { item };
}

export function todoReviewRecord(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
}): TodoReviewRecord | undefined {
	return readReviewRecords(getWorkspace(params.workspaceId).worktreePath, params.sessionId)[
		params.id
	];
}

/** Auto fix→re-review cycles spent on an item, durable independent of the review record (survives
 * the path-list fallback's `dropReviewRecord` — see `todos/artifacts.ts`, `reviews.ts`). */
export function todoReviewAutoCycles(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
}): number | undefined {
	return readAutoCycles(getWorkspace(params.workspaceId).worktreePath, params.sessionId, params.id);
}

export function renderReviewPackage(
	item: StoredItem,
	workerSessionId: string,
	prior: TodoReviewRecord | undefined,
): string {
	const shas = commitShas(item);
	const seen = new Set(prior?.reviewedShas ?? []);
	const fresh = shas.filter((s) => !seen.has(s));
	const paths = (item.artifacts ?? []).flatMap((a) =>
		a.kind === "change" && a.path ? [a.path] : [],
	);
	const changeSet =
		shas.length > 0
			? `commit${shas.length === 1 ? "" : "s"} ${shas.map((s) => s.slice(0, 12)).join(", ")}${paths.length > 0 ? `; uncommitted paths: ${paths.join(", ")}` : ""}`
			: `changed paths: ${paths.join(", ")}`;
	const rereview = prior && fresh.length > 0 && fresh.length < shas.length;
	const lines = [
		`You are the REVIEWER for plan step ${item.id} ("${item.title}") of chat ${workerSessionId}. Review the change set — you did not write this code.`,
		"",
		...(item.note ? [`Step note: ${item.note}`] : []),
		...(item.summary ? [`Worker's completion summary: ${item.summary}`] : []),
		...(item.verification
			? [`Worker's verification claim: ${item.verification} (verify the claim, don't trust it)`]
			: ["Worker reported NO verification — weigh that in your review."]),
		`Change set: ${changeSet}`,
		...(rereview
			? [
					`RE-REVIEW: only ${fresh.map((s) => s.slice(0, 12)).join(", ")} is new since your last verdict — review only that delta. Earlier findings the fix addressed are resolved by the worker or excluded as stale; approve is blocked only by what's still open.`,
				]
			: []),
		"",
		"FIRST read the reviewing-changes skill and follow it exactly — it defines the review order (intent match, scope drift, verifying the verification claim, hallucinated APIs), how to file findings (add_review_comment, one per problem, severity-prefixed, evidence-cited), and the single review_verdict that ends this review.",
	];
	return lines.join("\n");
}

export function requestTodoFix(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
	feedback: string;
}): { pkg: string; previous: TodoReviewRecord | undefined } {
	const feedback = params.feedback.trim();
	if (!feedback) throw new Error("Fix feedback must not be empty.");
	const { root, item } = reviewableItem(params);
	const previous = putReviewRecord(root, params.sessionId, params.id, {
		state: "changes_requested",
		reviewedShas: commitShas(item),
		feedback,
		at: new Date().toISOString(),
	});
	return { pkg: renderFixPackage(item, feedback), previous };
}

export function rollbackTodoFix(
	params: { workspaceId: string; sessionId: string; id: string },
	previous: TodoReviewRecord | undefined,
): void {
	dropReviewRecord(
		getWorkspace(params.workspaceId).worktreePath,
		params.sessionId,
		params.id,
		previous,
	);
}

export function renderFixPackage(item: StoredItem, feedback: string): string {
	const shas = commitShas(item);
	const paths = (item.artifacts ?? []).flatMap((a) =>
		a.kind === "change" && a.path ? [a.path] : [],
	);
	const changeSet =
		shas.length > 0
			? `commit${shas.length === 1 ? "" : "s"} ${shas.map((s) => s.slice(0, 12)).join(", ")}${paths.length > 0 ? `; uncommitted paths: ${paths.join(", ")}` : ""}`
			: `changed paths: ${paths.join(", ")}`;
	const lines = [
		`The user reviewed your completed step ${item.id} ("${item.title}") and asked for a fix.`,
		"",
		...(item.note ? [`Step note: ${item.note}`] : []),
		...(item.summary ? [`Your completion summary: ${item.summary}`] : []),
		...(item.verification ? [`Your verification claim: ${item.verification}`] : []),
		`Change set under review: ${changeSet}`,
		"",
		"User feedback:",
		'"""',
		feedback,
		'"""',
		"",
		`Address the feedback on THIS step: flip ${item.id} back to in_progress (todo_update), make the fix, then mark it done with a fresh summary describing the fix. Do not create a new item for it.`,
	];
	return lines.join("\n");
}
