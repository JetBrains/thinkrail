import type {
	GitFileChange,
	TodoArtifact,
	TodoItem,
	TodoPlan,
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
import { enqueueTodoMutation, settleChangeArtifacts } from "./artifacts";
import { dropItemBaseline, removeSessionBaselines } from "./baselines";

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

async function toWireItem(workspaceId: string, item: StoredItem): Promise<TodoItem> {
	if (!item.artifacts) return item;
	const artifacts = await Promise.all(
		item.artifacts.map(async (a): Promise<TodoArtifact> => {
			if (a.kind !== "commit" || !a.sha) return a;
			const files = await resolveCommitFiles(workspaceId, a.sha);
			return files ? { ...a, files } : a;
		}),
	);
	return { ...item, artifacts };
}

export async function listTodos(params: {
	workspaceId: string;
	sessionId: string;
}): Promise<TodoPlan> {
	await settleChangeArtifacts(params.workspaceId);
	const plan = storeFor(params.workspaceId, params.sessionId).read();
	return {
		todos: await Promise.all(plan.todos.map((t) => toWireItem(params.workspaceId, t))),
		groups: await Promise.all(
			plan.groups.map(async (group) => ({
				...group,
				todos: await Promise.all(group.todos.map((t) => toWireItem(params.workspaceId, t))),
				status: groupStatus(group),
			})),
		),
	};
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
		removeSessionBaselines(getWorkspace(params.workspaceId).worktreePath, params.sessionId);
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
		new TodoStore(root, params.sessionId).remove(params.id);
		dropItemBaseline(root, params.sessionId, params.id);
		return { ok: true } as const;
	});
}
