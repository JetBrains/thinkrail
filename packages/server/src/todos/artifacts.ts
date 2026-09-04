import type { GitFileChange, PiEvent } from "@thinkrail/contracts";
import { WORKSPACE_INTERNAL_DIR } from "@thinkrail/shared/paths";
import { type TodoArtifact, type TodoPlan, TodoStore } from "pi-todos/core";
import { gitCommitPaths, gitHeadSha, gitStatus, gitUncommittedPaths } from "../git";
import { logger } from "../log";
import { getWorkspace } from "../workspaces";
import {
	type Baseline,
	markOtherSessionWindowsShared,
	otherSessionWindows,
	readBaselines,
	writeBaselines,
} from "./baselines";
import { dropReviewRecord } from "./reviews";

const log = logger("todos");

export type CommitWindow = (opts: { subject: string; paths: string[] }) => { sha: string } | null;

const isAppStatePath = (path: string): boolean =>
	path === WORKSPACE_INTERNAL_DIR || path.startsWith(`${WORKSPACE_INTERNAL_DIR}/`);

export function isTodoToolEnd(event: PiEvent): boolean {
	return (
		event.type === "tool_execution_end" &&
		typeof event.toolName === "string" &&
		event.toolName.startsWith("todo_")
	);
}

function flatten(plan: TodoPlan): TodoPlan["todos"] {
	return [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
}

const commitQueues = new Map<string, Promise<void>>();

export function enqueueTodoMutation<T>(workspaceId: string, fn: () => T | Promise<T>): Promise<T> {
	const prev = commitQueues.get(workspaceId);
	let reservation: Promise<void> | undefined;
	let next: Promise<T>;
	if (prev) {
		next = prev.then(fn);
	} else {
		let releaseReservation!: () => void;
		reservation = new Promise<void>((resolve) => {
			releaseReservation = resolve;
		});
		commitQueues.set(workspaceId, reservation);
		next = new Promise<T>((resolve, reject) => {
			try {
				resolve(fn());
			} catch (error) {
				reject(error);
			}
		});
		void next.then(releaseReservation, releaseReservation);
	}
	const tail = next.then(
		() => undefined,
		() => undefined,
	);
	if (reservation && commitQueues.get(workspaceId) !== reservation) return next;
	commitQueues.set(workspaceId, tail);
	void tail.finally(() => {
		if (commitQueues.get(workspaceId) === tail) commitQueues.delete(workspaceId);
	});
	return next;
}

function captureNewWorkWindow(workspaceId: string, sessionId: string): void {
	const root = getWorkspace(workspaceId).worktreePath;
	const store = new TodoStore(root, sessionId);
	const active = flatten(store.read()).find((item) => item.status === "in_progress");
	if (!active) return;
	const baselines = readBaselines(root, sessionId);
	if (baselines[active.id]) return;
	const shared = otherSessionWindows(root, sessionId);
	baselines[active.id] = {
		paths: gitUncommittedPaths(workspaceId).filter((path) => !isAppStatePath(path)),
		head: gitHeadSha(workspaceId),
		...(shared && { shared }),
	};
	if (shared) markOtherSessionWindowsShared(root, sessionId);
	writeBaselines(root, sessionId, baselines);
}

export function maybeAttachChangeArtifacts(workspaceId: string, sessionId: string): Promise<void> {
	try {
		captureNewWorkWindow(workspaceId, sessionId);
	} catch {
		log.warn(`todo work-window capture skipped (${workspaceId}/${sessionId})`);
	}
	return enqueueTodoMutation(workspaceId, () => runReconcile(workspaceId, sessionId));
}

export function settleChangeArtifacts(workspaceId: string): Promise<void> {
	return (commitQueues.get(workspaceId) ?? Promise.resolve()).catch(() => {});
}

async function runReconcile(workspaceId: string, sessionId: string): Promise<void> {
	try {
		const root = getWorkspace(workspaceId).worktreePath;
		const store = new TodoStore(root, sessionId);
		await reconcileChangeArtifacts(
			store,
			root,
			sessionId,
			async () =>
				(await gitStatus(workspaceId, { kind: "uncommitted" })).changes.map((c) => c.path),
			({ subject, paths }) => gitCommitPaths(workspaceId, subject, paths),
			() => gitHeadSha(workspaceId),
			false,
		);
	} catch {
		log.warn(`todo change-artifacts skipped (${workspaceId}/${sessionId})`);
	}
}

function hasChangeSet(artifacts: TodoArtifact[] | undefined): boolean {
	return artifacts?.some((a) => a.kind === "change" || a.kind === "commit") ?? false;
}

export function unattributedChanges(
	changes: GitFileChange[],
	plan: TodoPlan,
	baselines: Record<string, Baseline>,
): GitFileChange[] {
	const items = flatten(plan);
	const attributed = new Set(
		items.flatMap((t) =>
			(t.artifacts ?? []).flatMap((a) => (a.kind === "change" && a.path ? [a.path] : [])),
		),
	);
	const openWindows = items.flatMap((t) => {
		const base = baselines[t.id];
		return t.status === "in_progress" && base ? [base] : [];
	});
	return changes.filter(
		(c) =>
			!isAppStatePath(c.path) &&
			!attributed.has(c.path) &&
			openWindows.every((b) => b.paths.includes(c.path)),
	);
}

export async function reconcileChangeArtifacts(
	store: TodoStore,
	root: string,
	sessionId: string,
	getChangedPaths: () => Promise<string[]>,
	commit?: CommitWindow,
	getHead: () => string | null = () => null,
	openMissingWorkWindow = true,
): Promise<void> {
	const plan = store.read();
	let planFingerprint = JSON.stringify(plan);
	const planUnchanged = (): boolean => JSON.stringify(store.read()) === planFingerprint;
	const acceptPlanWrite = (): void => {
		planFingerprint = JSON.stringify(store.read());
	};
	const baselines = readBaselines(root, sessionId);
	let persistedBaselineFingerprint = JSON.stringify(baselines);
	const baselinesUnchanged = (): boolean =>
		JSON.stringify(readBaselines(root, sessionId)) === persistedBaselineFingerprint;
	let baselinesDirty = false;
	const flushBaselines = (): boolean => {
		if (!baselinesDirty) return true;
		if (!planUnchanged()) return false;
		if (!baselinesUnchanged()) return false;
		writeBaselines(root, sessionId, baselines);
		persistedBaselineFingerprint = JSON.stringify(baselines);
		baselinesDirty = false;
		return true;
	};
	const dropBaseline = (id: string): void => {
		if (baselines[id] === undefined) return;
		delete baselines[id];
		baselinesDirty = true;
	};
	let changed: string[] | null = null;
	const currentChanged = async (): Promise<string[]> =>
		(changed ??= (await getChangedPaths()).filter((p) => !isAppStatePath(p)));
	let othersOpen: boolean | null = null;
	const otherChatWorking = (): boolean => (othersOpen ??= otherSessionWindows(root, sessionId));

	const items = flatten(plan);
	const liveIds = new Set(items.map((t) => t.id));
	for (const id of Object.keys(baselines)) {
		if (!liveIds.has(id)) dropBaseline(id);
	}
	if (!flushBaselines()) return;
	for (const todo of items) {
		if (todo.status === "in_progress") {
			if (!baselines[todo.id] && openMissingWorkWindow) {
				const paths = await currentChanged();
				if (!planUnchanged() || !baselinesUnchanged()) return;
				const shared = otherChatWorking();
				baselines[todo.id] = {
					paths,
					head: getHead(),
					...(shared && { shared }),
				};
				if (shared) markOtherSessionWindowsShared(root, sessionId);
				baselinesDirty = true;
			}
			if (!flushBaselines()) return;
			continue;
		}
		if (todo.status !== "done") {
			dropBaseline(todo.id);
			if (!flushBaselines()) return;
			continue;
		}
		const base: Baseline | undefined = baselines[todo.id];
		dropBaseline(todo.id);
		const existing = todo.artifacts ?? [];
		if (hasChangeSet(existing) && base === undefined) continue;
		const now = await currentChanged();
		if (!planUnchanged() || !baselinesUnchanged()) return;
		const deltaPaths = base ? now.filter((p) => !base.paths.includes(p)) : now;
		if (deltaPaths.length === 0) {
			if (!flushBaselines()) return;
			continue;
		}
		const preserved = existing.filter((a) => a.kind !== "change");
		const exclusive = base?.shared !== true && !otherChatWorking();
		const committed =
			commit && base?.paths.every((p) => !now.includes(p)) && exclusive
				? commit({
						subject: (todo.commitSubject ?? todo.title).split(/[\r\n]/u, 1)[0] ?? "",
						paths: deltaPaths,
					})
				: null;
		if (committed) {
			changed = null;
			store.update(todo.id, {
				artifacts: [...preserved, { kind: "commit", sha: committed.sha, label: todo.title }],
			});
			acceptPlanWrite();
			if (!flushBaselines()) return;
			continue;
		}
		const changes = deltaPaths.map((path): TodoArtifact => ({ kind: "change", path }));
		store.update(todo.id, { artifacts: [...preserved, ...changes] });
		acceptPlanWrite();
		dropReviewRecord(root, sessionId, todo.id);
		if (!flushBaselines()) return;
	}
}
