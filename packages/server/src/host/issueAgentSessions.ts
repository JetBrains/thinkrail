import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueToolHost } from "../agent";
import { createIssueStartupPrompt, type IssuesService } from "../issues";
import type { IssueSessionAssociation, IssueSessionStore } from "./issueSessions";

export interface IssueAgentSessionHostOptions {
	service(): Promise<IssuesService>;
	store(): IssueSessionStore;
	project(projectId: string): { path: string };
	workspace(workspaceId: string): { projectId: string; worktreePath: string };
	status(sessionId: string, workspaceId: string, cwd: string): Promise<false | "idle" | "busy">;
	start(sessionId: string, workspaceId: string, cwd: string, prompt: string): Promise<void>;
	locale(): string;
}

type Target = Pick<IssueSessionAssociation, "projectId" | "reference" | "stage" | "locale">;
function stop(): never {
	throw new CodedError(
		"RESOURCE_UNAVAILABLE",
		"Issue session is unavailable or requires reconciliation.",
	);
}

export function createIssueAgentSessionHost(options: IssueAgentSessionHostOptions) {
	async function access(target: Target, binding?: IssueSessionAssociation) {
		const project = options.project(target.projectId);
		const workspace = binding ? options.workspace(binding.workspaceId) : undefined;
		const service = await options.service();
		if (options.project(target.projectId).path !== project.path) stop();
		await service.restore(target.projectId);
		const remote = service.remoteFor(target.projectId, target.reference);
		function guard() {
			if (
				options.project(target.projectId).path !== project.path ||
				service.remoteFor(target.projectId, target.reference) !== remote
			)
				stop();
			if (binding && workspace) {
				const current = options.workspace(binding.workspaceId);
				if (
					current.projectId !== binding.projectId ||
					current.worktreePath !== workspace.worktreePath
				)
					stop();
			}
		}
		guard();
		async function checked<T>(operation: () => Promise<T>) {
			guard();
			try {
				return await operation();
			} finally {
				guard();
			}
		}
		return { remote, guard, checked };
	}
	async function prepare(target: Target) {
		options.store();
		const { remote, checked } = await access(target);
		const issue = await checked(() => remote.issue(target.reference.number));
		const notes = await checked(() => remote.notes(target.reference.number));
		const project = await checked(() => remote.project());
		if (String(project.id) !== target.reference.projectId) stop();
		const link = `${target.reference.instanceUrl}/${project.pathWithNamespace}/-/issues/${target.reference.number}`;
		return createIssueStartupPrompt({ ...target, issue, notes, link });
	}
	async function binding(sessionId: string) {
		const found = await options.store().get(sessionId);
		if (!found) stop();
		return found;
	}
	const tools: IssueToolHost = {
		async context(sessionId) {
			const found = await binding(sessionId);
			const { guard } = await access(found, found);
			const prompt = await prepare(found);
			guard();
			return prompt;
		},
		async recordSummary(sessionId, operationId, summary) {
			if (
				!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationId) ||
				typeof summary !== "string" ||
				!summary.trim() ||
				Buffer.byteLength(summary) > 32_000
			)
				stop();
			const found = await binding(sessionId);
			const { remote, checked } = await access(found, found);
			const noteId = await checked(() =>
				options
					.store()
					.recordSummary(
						sessionId,
						operationId,
						summary,
						async () => (await checked(() => remote.addNote(found.reference.number, summary))).id,
					),
			);
			return { noteId };
		},
	};
	return {
		...tools,
		locale: options.locale,
		prepare,
		bind: (value: IssueSessionAssociation) => options.store().bind(value),
		async start(sessionId: string, prompt?: string) {
			const found = await binding(sessionId);
			const { checked } = await access(found, found);
			const ws = options.workspace(found.workspaceId);
			if (
				(await checked(() => options.status(sessionId, found.workspaceId, ws.worktreePath))) !==
				"idle"
			)
				stop();
			if (!(await checked(() => options.store().reserveStartup(sessionId)))) return;
			const text = prompt ?? (await prepare(found));
			await checked(() => options.start(sessionId, found.workspaceId, ws.worktreePath, text));
			await checked(() => options.store().completeStartup(sessionId));
		},
	};
}

export type IssueAgentSessionHost = ReturnType<typeof createIssueAgentSessionHost>;
