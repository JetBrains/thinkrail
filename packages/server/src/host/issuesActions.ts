import { lstatSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	type IssueDesignPublicationInput,
	type IssueImplementationTarget,
	type IssueReference,
	type IssueSessionLaunch,
	type IssueSessionStartupTarget,
	type IssueTarget,
	isIssueDesignPublicationInput,
	isIssueImplementationTarget,
	isIssueSessionStartupTarget,
	isIssueTarget,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { sessionReuseStatus } from "../agent";
import { resolveCommitOid } from "../git";
import {
	type ApprovalPublication,
	type ApprovalResult,
	createIssueWorkflow,
	createIssueWorkspaceCoordinator,
	type IssuesService,
	type WorkflowRemote,
	type WorkspaceHandle,
} from "../issues";
import { getProjects } from "../projects";
import {
	createWorkspaceAtPathWithBranch,
	listGitWorktrees,
	listWorkspaceRecords,
	listWorkspaces,
} from "../workspaces";
import { createHostSession } from "./createHostSession";
import type { IssueAgentSessionHost } from "./issueAgentSessions";
import { createIssueWorkflowPersistence } from "./issueWorkflowPersistence";
import { createIssueWorkspacePersistence } from "./issueWorkspacePersistence";

type Action =
	| "beginDesign"
	| "beginImplementation"
	| "approveDesign"
	| "approveImplementation"
	| "launchDesign"
	| "launchImplementation"
	| "publishDesign"
	| "publishImplementation"
	| "startImplementation"
	| "validateDesign"
	| "validateImplementation";
function stop(): never {
	throw new CodedError(
		"RESOURCE_UNAVAILABLE",
		"Issue action is unavailable or requires reconciliation.",
	);
}
function invalid(): never {
	throw new CodedError("RANGE_INVALID", "Invalid Issue request.");
}
type ParsedAction =
	| { action: "beginDesign" | "beginImplementation"; args: IssueSessionStartupTarget }
	| {
			action:
				| "approveDesign"
				| "approveImplementation"
				| "launchDesign"
				| "startImplementation"
				| "validateDesign"
				| "validateImplementation";
			args: IssueTarget;
	  }
	| {
			action: "launchImplementation" | "publishImplementation";
			args: IssueImplementationTarget;
	  }
	| { action: "publishDesign"; args: IssueDesignPublicationInput };

function snapshot<T extends IssueTarget>(value: T): T {
	return { ...value, reference: { ...value.reference } };
}
function parse(value: unknown, action: Action): ParsedAction {
	switch (action) {
		case "beginDesign":
		case "beginImplementation":
			if (!isIssueSessionStartupTarget(value)) invalid();
			return { action, args: snapshot(value) };
		case "publishDesign":
			if (!isIssueDesignPublicationInput(value)) invalid();
			return { action, args: snapshot(value) };
		case "launchImplementation":
		case "publishImplementation":
			if (!isIssueImplementationTarget(value)) invalid();
			return { action, args: snapshot(value) };
		default:
			if (!isIssueTarget(value)) invalid();
			return { action, args: snapshot(value) };
	}
}
function trusted(projectId: string) {
	const project = getProjects().find((p) => p.id === projectId);
	if (project?.trusted !== true) stop();
	return project;
}
// Walk every existing ancestor: recursive mkdir must never traverse a symlink/junction.
export function privateDirectory(path: string): void {
	const parent = dirname(path);
	if (parent !== path) privateDirectory(parent);
	try {
		const stat = lstatSync(path);
		if (!stat.isDirectory() || stat.isSymbolicLink()) stop();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		mkdirSync(path, { mode: 0o700 });
	}
}
export type IssueActionSessions = {
	create?: typeof createHostSession;
	status?: typeof sessionReuseStatus;
};
export function createIssuesActions(
	service: () => Promise<IssuesService>,
	dir: string,
	sessions: IssueActionSessions = {},
	agentSessions?: IssueAgentSessionHost,
) {
	function run(
		action:
			| "beginDesign"
			| "beginImplementation"
			| "launchDesign"
			| "launchImplementation"
			| "startImplementation",
		input: unknown,
	): Promise<IssueSessionLaunch>;
	function run(
		action: "publishDesign" | "publishImplementation",
		input: unknown,
	): Promise<ApprovalPublication>;
	function run(
		action: "approveDesign" | "approveImplementation" | "validateDesign" | "validateImplementation",
		input: unknown,
	): Promise<ApprovalResult>;
	async function run(action: Action, input: unknown) {
		const request = parse(input, action);
		const { projectId, reference } = request.args;
		const initialProject = trusted(projectId);
		const issues = await service();
		if (trusted(projectId).path !== initialProject.path) stop();
		// Durable credentials restore lazily; actions must never require a manual reconnect first.
		await issues.restore(projectId);
		if (trusted(projectId).path !== initialProject.path) stop();
		const remote = issues.remoteFor(projectId, reference);
		let pinned: WorkspaceHandle | undefined;
		let startupPrompt: string | undefined;
		const startup =
			request.action === "beginDesign" || request.action === "beginImplementation"
				? request.args
				: undefined;
		const stage =
			action === "launchDesign" || action === "beginDesign" ? "design" : "implementation";
		function guard() {
			if (
				trusted(projectId).path !== initialProject.path ||
				issues.remoteFor(projectId, reference) !== remote
			)
				stop();
			if (pinned) {
				const current = listWorkspaceRecords(projectId).find((ws) => ws.id === pinned?.id);
				if (
					!current ||
					current.worktreePath !== pinned.worktreePath ||
					current.branch !== pinned.branch ||
					current.kind !== pinned.kind
				)
					stop();
			}
		}
		async function checked<T>(operation: () => T | Promise<T>): Promise<T> {
			guard();
			try {
				return await operation();
			} finally {
				guard();
			}
		}
		const root = resolve(dir);
		guard();
		privateDirectory(root);
		const receiptDir = join(root, "issue-workflow");
		const workspaceDir = join(root, "issue-workspaces");
		privateDirectory(receiptDir);
		privateDirectory(workspaceDir);
		guard();
		const receipts = createIssueWorkflowPersistence(receiptDir);
		const launches = createIssueWorkspacePersistence(workspaceDir);
		guard();
		return launches.withLaunch(
			projectId,
			reference,
			async (ports) => {
				guard();
				const wrapped: WorkflowRemote = {
					issue: (...a) => checked(() => remote.issue(...a)),
					notes: (...a) => checked(() => remote.notes(...a)),
					labelEvents: (...a) => checked(() => remote.labelEvents(...a)),
					member: (...a) => checked(() => remote.member(...a)),
					currentUser: (...a) => checked(() => remote.currentUser(...a)),
					updateIssue: (...a) => checked(() => remote.updateIssue(...a)),
					addNote: (...a) => checked(() => remote.addNote(...a)),
				};
				function find(query: { workspaceId: string } | { worktreePath: string }) {
					return (
						listWorkspaceRecords(projectId).find((w) =>
							"workspaceId" in query
								? w.id === query.workspaceId
								: w.worktreePath === query.worktreePath,
						) ?? null
					);
				}
				async function currentCommit(ref: IssueReference) {
					const ws = await checked(() => coordinator.ownedImplementation(ref));
					if (
						pinned &&
						(ws.id !== pinned.id ||
							ws.worktreePath !== pinned.worktreePath ||
							ws.branch !== pinned.branch)
					)
						stop();
					pinned ??= { ...ws };
					const sha = await checked(() => resolveCommitOid(ws.worktreePath, "HEAD"));
					const after = await checked(() => coordinator.ownedImplementation(ref));
					if (
						after.id !== pinned.id ||
						after.worktreePath !== pinned.worktreePath ||
						after.branch !== pinned.branch ||
						!sha ||
						!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)
					)
						stop();
					return sha;
				}
				const workflow = createIssueWorkflow({
					clientFor: () => {
						guard();
						return wrapped;
					},
					persistence: {
						load: (ref) => checked(() => receipts.load(ref)),
						compareAndSet: (ref, revision, next) =>
							checked(() => receipts.compareAndSet(ref, revision, next)),
					},
					currentImplementationCommit: currentCommit,
				});
				let preparedPrompt: string | undefined;
				let sessionTitle: string | undefined;
				const coordinator = createIssueWorkspaceCoordinator({
					projectId,
					projectPath: () => checked(() => trusted(projectId).path),
					load: (key) => checked(() => ports.load(key)),
					save: (key, row) => checked(() => ports.save(key, row)),
					findWorkspace: (query) => checked(() => find(query)),
					listGitWorktrees: (id) => checked(() => listGitWorktrees(id)),
					createWorkspaceAtPath: (id, path, branch, name) =>
						checked(() => createWorkspaceAtPathWithBranch(id, path, branch, undefined, name)),
					defaultWorkspace: (id) =>
						checked(async () => {
							const rows = await checked(() => listWorkspaces(id, { includeDiffStats: false }));
							const ws = rows.find((w) => w.projectId === projectId && w.kind === "default");
							if (!ws) stop();
							return ws;
						}),
					sessionExists: (id, workspaceId) =>
						checked(() => {
							const ws = find({ workspaceId });
							if (!ws) stop();
							return (sessions.status ?? sessionReuseStatus)(id, workspaceId, ws.worktreePath);
						}),
					createSession: (workspaceId) =>
						checked(async () => {
							if (!find({ workspaceId })) stop();
							// This port is called only after the coordinator decides a new session is needed.
							const title =
								sessionTitle ?? (await checked(() => wrapped.issue(reference.number))).title;
							const created = await checked(() =>
								(sessions.create ?? createHostSession)({ workspaceId }, guard, { title }),
							);
							if (startup) {
								if (!agentSessions || preparedPrompt === undefined) stop();
								await checked(() =>
									agentSessions.bind({
										sessionId: created.sessionId,
										workspaceId,
										projectId,
										reference,
										stage,
										locale: startup.locale,
									}),
								);
								// Only this newly created and durably bound session may start.
								startupPrompt = preparedPrompt;
							}
							return created.sessionId;
						}),
				});
				async function launch(kind: "design" | "implementation") {
					if (startup) {
						sessionTitle = (await checked(() => wrapped.issue(reference.number))).title;
						if (!agentSessions) stop();
						// Read all context before the coordinator can create a worktree or session.
						preparedPrompt = await checked(() =>
							agentSessions.prepare({
								projectId,
								reference,
								stage,
								locale: startup.locale,
							}),
						);
					}
					const result = await checked(() =>
						kind === "design"
							? coordinator.design(reference)
							: coordinator.implementation(reference),
					);
					if (startupPrompt !== undefined) {
						if (!agentSessions) stop();
						await checked(() => agentSessions.start(result.sessionId, startupPrompt));
					}
					return result;
				}
				switch (request.action) {
					case "approveDesign":
						return checked(() => workflow.approveStage(reference, "design"));
					case "approveImplementation":
						return checked(() => workflow.approveStage(reference, "implementation"));
					case "beginDesign":
					case "launchDesign":
						return launch("design");
					case "beginImplementation":
					case "launchImplementation":
					case "startImplementation":
						// No approval gate: an explicit click starts (or reuses) the Issue worktree.
						return launch("implementation");
					case "publishDesign":
						return checked(() =>
							workflow.publishDesign(
								reference,
								request.args.expectedDescription,
								request.args.newDescription,
							),
						);
					case "publishImplementation": {
						const sha = await currentCommit(reference);
						return checked(() =>
							workflow.publishImplementation(reference, request.args.approvedDesignVersion, sha),
						);
					}
					case "validateDesign":
						return checked(() => workflow.validateDesign(reference));
					case "validateImplementation":
						return checked(() => workflow.validateImplementation(reference));
				}
			},
			guard,
		);
	}
	return {
		beginDesign: (input: unknown) => run("beginDesign", input),
		beginImplementation: (input: unknown) => run("beginImplementation", input),
		approveDesign: (input: unknown) => run("approveDesign", input),
		approveImplementation: (input: unknown) => run("approveImplementation", input),
		launchDesign: (input: unknown) => run("launchDesign", input),
		launchImplementation: (input: unknown) => run("launchImplementation", input),
		publishDesign: (input: unknown) => run("publishDesign", input),
		publishImplementation: (input: unknown) => run("publishImplementation", input),
		startImplementation: (input: unknown) => run("startImplementation", input),
		validateDesign: (input: unknown) => run("validateDesign", input),
		validateImplementation: (input: unknown) => run("validateImplementation", input),
	};
}
