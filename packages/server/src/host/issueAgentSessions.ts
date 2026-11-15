import { issueWebUrl } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueToolHost } from "../agent";
import {
	createIssueStartupPrompt,
	type IssueRepositoryContext,
	type IssuesService,
} from "../issues";
import type { IssueSessionAssociation, IssueSessionStore } from "./issueSessions";

export interface IssueAgentSessionHostOptions {
	service(): Promise<IssuesService>;
	store(): IssueSessionStore;
	project(projectId: string): { path: string };
	workspace(workspaceId: string): { projectId: string; worktreePath: string };
	status(sessionId: string, workspaceId: string, cwd: string): Promise<false | "idle" | "busy">;
	start(sessionId: string, workspaceId: string, cwd: string, prompt: string): Promise<void>;
	locale(): string;
	prepareConfirmation?(
		sessionId: string,
		input: {
			operationId: string;
			inspect?: boolean;
			continueDespiteChecks?: boolean;
			recovery?: "reconcile";
			report?: string;
			projectId?: string;
			title?: string;
			body?: string;
			targetBranch?: string;
			action?:
				| "update-body"
				| "close-issue"
				| "ready-mr"
				| "merge-mr"
				| "record-delivery-state"
				| "read-delivery-state"
				| "authorize-automation"
				| "advance-automation"
				| "preflight-dependencies";
			reason?: string;
			acceptance?: string;
			mergeRequestId?: number;
			expectedSha?: string;
			expectedRevision?: number;
			deliveryState?: unknown;
			mode?: "draft" | "auto-merge" | "manual";
			closeIssue?: boolean;
		},
	): Promise<unknown>;
	executeConfirmation?(
		sessionId: string,
		operationId: string,
		toolCallId: string,
		continuationId?: string,
	): Promise<unknown>;
	repositories?(target: Target): Promise<readonly IssueRepositoryContext[]>;
	/** Join one more repository to the bound Issue's running implementation. */
	join?(target: Target, repositoryProjectId: string): Promise<unknown>;
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
	async function prepare(target: Target, repositories?: readonly IssueRepositoryContext[]) {
		options.store();
		const { remote, checked } = await access(target);
		const issue = await checked(() => remote.issue(target.reference.number));
		const notes = await checked(() => remote.notes(target.reference.number));
		const project = await checked(() => remote.project());
		if (String(project.id) !== target.reference.projectId) stop();
		const link = issueWebUrl(
			target.reference.provider,
			target.reference.instanceUrl,
			project.pathWithNamespace,
			target.reference.number,
		);
		if (link === null) stop();
		repositories ??= await options.repositories?.(target);
		return createIssueStartupPrompt({
			...target,
			issue,
			notes,
			link,
			...(repositories ? { repositories } : {}),
		});
	}
	async function binding(sessionId: string) {
		const found = await options.store().get(sessionId);
		if (!found) stop();
		return found;
	}
	/** Only an implementation binding may ask, and only for a repository it was shown as `reference`. */
	async function joinable(sessionId: string, repositoryProjectId: string) {
		const found = await binding(sessionId);
		if (found.stage !== "implementation" || !options.repositories || !options.join) stop();
		const { checked } = await access(found, found);
		const contexts = await checked(async () => (await options.repositories?.(found)) ?? []);
		const candidate = contexts.find(
			(context) => context.projectId === repositoryProjectId && context.role === "reference",
		);
		if (!candidate) stop();
		return { found, checked, candidate };
	}
	const tools: IssueToolHost = {
		async joinCandidate(sessionId, repositoryProjectId) {
			const { candidate } = await joinable(sessionId, repositoryProjectId);
			return { projectId: candidate.projectId, name: candidate.name, path: candidate.path };
		},
		async joinRepository(sessionId, repositoryProjectId) {
			const { found, checked } = await joinable(sessionId, repositoryProjectId);
			await checked(async () => options.join?.(found, repositoryProjectId));
			const contexts = await checked(async () => (await options.repositories?.(found)) ?? []);
			const joined = contexts.find(
				(context) => context.projectId === repositoryProjectId && context.role === "associated",
			);
			if (!joined) stop();
			return {
				projectId: joined.projectId,
				name: joined.name,
				path: joined.path,
				workspaceId: joined.workspaceId,
			};
		},
		prepareConfirmation: (sessionId, input) => {
			if (!options.prepareConfirmation) stop();
			return options.prepareConfirmation(sessionId, input);
		},
		executeConfirmation: (sessionId, operationId, toolCallId, continuationId) => {
			if (!options.executeConfirmation) stop();
			return options.executeConfirmation(sessionId, operationId, toolCallId, continuationId);
		},
		async context(sessionId) {
			const found = await binding(sessionId);
			const { guard } = await access(found, found);
			const prompt = await prepare(found);
			guard();
			return prompt;
		},
		async recordSummary(sessionId, operationId, summary, recovery) {
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
				options.store().recordSummary(
					sessionId,
					operationId,
					summary,
					async () => {
						try {
							return (await checked(() => remote.addNote(found.reference.number, summary))).id;
						} catch {
							throw new CodedError(
								"ISSUE_SUMMARY_RECOVERY_REQUIRED",
								"Issue summary requires reconciliation.",
							);
						}
					},
					recovery,
					() => checked(() => remote.notes(found.reference.number)),
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
		findAssociation: (query: Parameters<IssueSessionStore["findAssociation"]>[0]) =>
			options.store().findAssociation(query),
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
