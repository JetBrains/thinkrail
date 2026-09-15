import type { PiEvent } from "@thinkrail/contracts";
import { groupStatus, TodoStore } from "pi-todos/core";
import type { AdditionalAnalyticsCapture, AdditionalAnalyticsEvent } from "../analytics";
import { settleChangeArtifacts } from "../todos";
import { getWorkspace } from "../workspaces";
import { additionalCapture, captureAdditional } from "./productAnalytics";

type TaskProperties = Extract<AdditionalAnalyticsEvent, { name: "task_completed" }>["params"];

export interface TaskGroupObservation {
	id: string;
	done: boolean;
	completedItems: Set<string>;
	openItems: Set<string>;
	properties: TaskProperties;
}

function readGroups(workspaceId: string, sessionId: string): TaskGroupObservation[] {
	return new TodoStore(getWorkspace(workspaceId).worktreePath, sessionId)
		.read()
		.groups.map((group) => {
			const artifacts = group.todos.flatMap((item) => item.artifacts ?? []);
			const commit = artifacts.some((artifact) => artifact.kind === "commit");
			const changes = artifacts.some((artifact) => artifact.kind === "change");
			return {
				id: group.id,
				done: group.todos.length > 0 && groupStatus(group) === "done",
				completedItems: new Set(
					group.todos.filter((item) => item.status === "done").map((item) => item.id),
				),
				openItems: new Set(
					group.todos.filter((item) => item.status !== "done").map((item) => item.id),
				),
				properties: {
					change_evidence:
						commit && changes ? "both" : commit ? "commit" : changes ? "changes" : "none",
					verification_recorded: group.todos.some((item) => Boolean(item.verification?.trim()))
						? "yes"
						: "no",
				},
			};
		});
}

export class TaskObservation {
	private grant: AdditionalAnalyticsCapture | null = null;
	private readonly completed = new Map<string, Set<string>>();
	private readonly tools = new Map<string, Map<string, () => Promise<void>>>();

	constructor(
		private readonly getCapture = additionalCapture,
		private readonly read = readGroups,
	) {}

	clear(): void {
		this.grant = null;
		this.completed.clear();
		this.tools.clear();
	}

	forget(sessionId: string): void {
		this.completed.delete(sessionId);
		this.tools.delete(sessionId);
	}

	begin(workspaceId: string, sessionId: string): () => Promise<void> {
		try {
			const capture = this.getCapture();
			if (capture !== this.grant) {
				this.clear();
				this.grant = capture;
			}
			if (!capture) return async () => {};
			const before = new Map(this.read(workspaceId, sessionId).map((group) => [group.id, group]));
			let completed = this.completed.get(sessionId);
			if (!completed) {
				completed = new Set();
				this.completed.set(sessionId, completed);
			}
			for (const group of before.values()) if (!group.done) completed.delete(group.id);
			let finished = false;
			return async () => {
				if (finished) return;
				finished = true;
				try {
					if (capture !== this.getCapture()) return;
					await settleChangeArtifacts(workspaceId);
					if (capture !== this.getCapture() || this.completed.get(sessionId) !== completed) return;
					for (const group of this.read(workspaceId, sessionId)) {
						const previous = before.get(group.id);
						if (!previous || previous.done || !group.done || completed.has(group.id)) continue;
						if (![...previous.openItems].some((id) => group.completedItems.has(id))) continue;
						completed.add(group.id);
						captureAdditional(capture, {
							name: "task_completed",
							params: {
								change_evidence: group.properties.change_evidence,
								verification_recorded: group.properties.verification_recorded,
							},
						});
					}
				} catch {}
			};
		} catch {
			return async () => {};
		}
	}

	toolStarted(workspaceId: string, sessionId: string, event: PiEvent): void {
		if (
			event.type !== "tool_execution_start" ||
			(event.toolName !== "todo_update" && event.toolName !== "todo_write")
		)
			return;
		const finish = this.begin(workspaceId, sessionId);
		if (!this.grant) return;
		let tools = this.tools.get(sessionId);
		if (!tools) {
			tools = new Map();
			this.tools.set(sessionId, tools);
		}
		tools.set(event.toolCallId, finish);
	}

	toolFinished(sessionId: string, event: PiEvent): () => Promise<void> {
		if (event.type !== "tool_execution_end") return async () => {};
		const tools = this.tools.get(sessionId);
		const finish = tools?.get(event.toolCallId);
		tools?.delete(event.toolCallId);
		if (tools?.size === 0) this.tools.delete(sessionId);
		return event.isError ? async () => {} : (finish ?? (async () => {}));
	}
}

export const taskObservation = new TaskObservation();
