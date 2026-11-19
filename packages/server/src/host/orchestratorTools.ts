import type {
	Container,
	MergePrResult,
	OpenPrResult,
	OrchestratorMessageDetails,
	Project,
	SessionSummary,
	Workspace,
} from "@thinkrail/contracts";
import { ORCHESTRATOR_MESSAGE_CUSTOM_TYPE } from "@thinkrail/contracts";
import {
	type AddWorkspaceParams,
	abortSession,
	ensureSessionAttached,
	getSessionWorkspaceId,
	type HostMessageDelivery,
	hasSession,
	isSessionStreaming,
	listSessions,
	type MergeApproval,
	type MergePrToolParams,
	type MessageChatParams,
	type OpenPrToolParams,
	type OrchestratorToolsHost,
	type RemoveWorkspaceParams,
	type StartedWorkspace,
	type StartWorkspaceParams,
	type StopChatParams,
	sendHostMessageToSession,
} from "../agent";
import { listContainers, removeContainerWorkspace } from "../containers";
import { mergePr, openPr } from "../pr";
import { listProjects } from "../projects";
import {
	getChatWorkspace,
	isChatsContainer,
	isChatWorkspaceId,
	listAllWorkspaceRecords,
	recordWorkspaceActivity,
	setWorkspaceReview,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { addContainerWorkspaceOrchestrated } from "./orchestrator";
import { runObservation } from "./runAnalytics";
import { findWorkspaceReviewOutcome } from "./settledLifecycle";
import { archiveWorkspace } from "./workspaceArchive";
import {
	chatName,
	matchWorkspaces,
	prLine,
	resolveProject,
	startWorkspaceJoining,
} from "./workspaceTools";

const MESSAGE_ACK_MS = 3_000;

type MergeParams = Parameters<typeof mergePr>[0];

export interface OrchestratorToolsDeps {
	/** The orchestrator chat a session belongs to; `null` for any other session. */
	callerChat: (sessionId: string) => Workspace | null;
	containers: () => Container[];
	workspaces: () => Workspace[];
	projects: () => Project[];
	chats: (workspace: Workspace) => Promise<SessionSummary[]>;
	attach: (sessionId: string, workspace: Workspace) => Promise<boolean>;
	streaming: (sessionId: string) => boolean;
	send: (
		sessionId: string,
		content: string,
		details: OrchestratorMessageDetails,
		deliverAs: HostMessageDelivery,
	) => Promise<void>;
	abort: (sessionId: string) => Promise<void>;
	start: (
		callerSessionId: string,
		params: StartWorkspaceParams,
		join: (workspace: Workspace) => void,
		signal?: AbortSignal,
	) => Promise<StartedWorkspace>;
	join: (containerId: string, workspaceId: string) => Container;
	leave: (containerId: string, workspaceId: string) => Promise<Container | null>;
	archive: (workspaceId: string) => void;
	/** A fresh review lookup, recorded on the workspace; the record as it stands after it. */
	refreshReview: (workspace: Workspace) => Promise<Workspace>;
	openPr: (
		workspace: Workspace,
		params: OpenPrToolParams,
	) => Promise<OpenPrResult & { branch: string }>;
	mergePr: (params: MergeParams) => Promise<MergePrResult>;
}

/** `pr.open` and `open_pr`: the review the open reported becomes the workspace's last-known review. */
export function recordOpenedReview(
	workspaceId: string,
	result: OpenPrResult,
	branch: string,
): void {
	if (!result.review) return;
	setWorkspaceReview(
		workspaceId,
		{ ...result.review, state: "open", ...(result.url ? { url: result.url } : {}) },
		branch,
	);
}

function callerChat(sessionId: string): Workspace | null {
	const workspaceId = getSessionWorkspaceId(sessionId);
	if (!workspaceId || !isChatWorkspaceId(workspaceId)) return null;
	try {
		return getChatWorkspace(workspaceId);
	} catch {
		return null;
	}
}

const liveDeps: OrchestratorToolsDeps = {
	callerChat,
	containers: listContainers,
	workspaces: listAllWorkspaceRecords,
	projects: listProjects,
	chats: (workspace) => listSessions(workspace.id, workspace.worktreePath),
	attach: async (sessionId, workspace) =>
		getSessionWorkspaceId(sessionId) === workspace.id ||
		(getSessionWorkspaceId(sessionId) === undefined &&
			(await ensureSessionAttached(sessionId, workspace.id, workspace.worktreePath))),
	streaming: (sessionId) => hasSession(sessionId) && isSessionStreaming(sessionId),
	send: (sessionId, content, details, deliverAs) =>
		ackSend(
			runObservation.send(sessionId, "internal", () =>
				sendHostMessageToSession(sessionId, ORCHESTRATOR_MESSAGE_CUSTOM_TYPE, content, details, {
					deliverAs,
				}),
			),
			MESSAGE_ACK_MS,
		),
	abort: async (sessionId) => {
		await abortSession(sessionId);
	},
	start: startWorkspaceJoining,
	join: addContainerWorkspaceOrchestrated,
	leave: removeContainerWorkspace,
	archive: archiveWorkspace,
	refreshReview: async (workspace) => {
		try {
			const outcome = await findWorkspaceReviewOutcome(workspace, { fresh: true });
			if (!outcome.reliable) return workspace;
			return setWorkspaceReview(workspace.id, outcome.value, workspace.branch) ?? workspace;
		} catch {
			return workspace;
		}
	},
	openPr: async (workspace, params) => {
		recordWorkspaceActivity(workspace.id);
		const opened = await openPr({
			workspaceId: workspace.id,
			...(params.title?.trim() ? { title: params.title.trim(), titleEdited: true } : {}),
			...(params.body !== undefined ? { body: params.body } : {}),
			...(params.draft ? { draft: true } : {}),
		});
		const { branch, ...result } = opened;
		recordOpenedReview(workspace.id, result, branch);
		return opened;
	},
	mergePr: (params) => {
		recordWorkspaceActivity(params.workspaceId);
		return mergePr(params);
	},
};

interface Scope {
	container: Container;
	members: Workspace[];
}

function scopeOf(deps: OrchestratorToolsDeps, callerSessionId: string): Scope {
	const chat = deps.callerChat(callerSessionId);
	if (!chat?.orchestratorOf) throw new Error("Only a container's orchestrator can use this tool.");
	const container = deps.containers().find((candidate) => candidate.id === chat.orchestratorOf);
	if (!container) throw new Error("This chat's container no longer exists.");
	const records = new Map(deps.workspaces().map((workspace) => [workspace.id, workspace]));
	return {
		container,
		members: container.workspaceIds.flatMap((id) => records.get(id) ?? []),
	};
}

function describeMembers(members: readonly Workspace[]): string {
	return (
		members
			.map((member) => `${member.name} (branch ${member.branch}, id ${member.id})`)
			.join(", ") || "none"
	);
}

function memberOf(deps: OrchestratorToolsDeps, scope: Scope, ref: string): Workspace {
	const needle = ref.trim();
	const list = `Members of "${scope.container.name}": ${describeMembers(scope.members)}.`;
	if (!needle) throw new Error(`Name a member workspace. ${list}`);
	const { matched } = matchWorkspaces([needle], scope.members);
	const [only] = matched;
	if (only && matched.length === 1) return only;
	if (matched.length > 1) throw new Error(`Ambiguous workspace "${needle}". ${list}`);
	const elsewhere = matchWorkspaces([needle], deps.workspaces()).matched.length > 0;
	throw new Error(
		elsewhere
			? `"${needle}" is not a member of the container "${scope.container.name}": the orchestrator acts only on its own container's workspaces (add_workspace with \`attach\` brings a standalone one in). ${list}`
			: `No member workspace matches "${needle}". ${list}`,
	);
}

function latestChat(chats: readonly SessionSummary[]): SessionSummary | undefined {
	return chats.reduce<SessionSummary | undefined>(
		(latest, chat) => (!latest || chat.updatedAt > latest.updatedAt ? chat : latest),
		undefined,
	);
}

async function memberChat(
	deps: OrchestratorToolsDeps,
	member: Workspace,
	ref: string | undefined,
): Promise<SessionSummary> {
	const chats = await deps.chats(member);
	const needle = ref?.trim();
	if (needle) {
		const chat = chats.find((candidate) => candidate.sessionId === needle);
		if (chat) return chat;
		const ids = chats.map((candidate) => candidate.sessionId).join(", ") || "none";
		throw new Error(
			`${needle} is not a chat of the member "${member.name}": the orchestrator acts only on its members' chats. Its chats: ${ids}.`,
		);
	}
	const latest = latestChat(chats);
	if (!latest) throw new Error(`The member "${member.name}" has no chat yet.`);
	return latest;
}

function orchestratorMessageContent(container: Container, text: string): string {
	return `Message from the orchestrator of the container "${container.name}" (another agent coordinating this workspace with the container's other workspaces; not the human):\n\n${text}`;
}

export async function messageChat(
	callerSessionId: string,
	params: MessageChatParams,
	deps: OrchestratorToolsDeps = liveDeps,
): Promise<string> {
	const scope = scopeOf(deps, callerSessionId);
	const member = memberOf(deps, scope, params.workspace);
	const text = params.text.trim();
	if (!text) throw new Error("Pass a non-empty text.");
	const chat = await memberChat(deps, member, params.session);
	if (!(await deps.attach(chat.sessionId, member)))
		throw new Error(`The chat ${chat.sessionId} of "${member.name}" could not be opened.`);
	const mode = params.mode ?? "follow_up";
	const running = deps.streaming(chat.sessionId);
	const { container } = scope;
	const details: OrchestratorMessageDetails = {
		containerId: container.id,
		containerName: container.name,
		orchestratorSessionId: callerSessionId,
		mode,
		text,
	};
	await deps.send(
		chat.sessionId,
		orchestratorMessageContent(container, text),
		details,
		mode === "steer" ? "steer" : "followUp",
	);
	const landing = !running
		? "it starts a turn now"
		: mode === "steer"
			? "it reaches the running turn at its next step"
			: "it waits for the running turn to end";
	return `Sent to chat ${chatName(chat)} (${chat.sessionId}) of "${member.name}" as ${mode === "steer" ? "a steer" : "a follow-up"}; ${landing}. You are woken when the chat settles.`;
}

export async function stopChat(
	callerSessionId: string,
	params: StopChatParams,
	deps: OrchestratorToolsDeps = liveDeps,
): Promise<string> {
	const scope = scopeOf(deps, callerSessionId);
	const member = memberOf(deps, scope, params.workspace);
	const targets = params.session?.trim()
		? [await memberChat(deps, member, params.session)]
		: (await deps.chats(member)).filter((chat) => deps.streaming(chat.sessionId));
	const running = targets.filter((chat) => deps.streaming(chat.sessionId));
	if (running.length === 0) return `Nothing stopped: no chat of "${member.name}" is running.`;
	for (const chat of running) await deps.abort(chat.sessionId);
	return `Stopped ${running.map((chat) => `chat ${chatName(chat)} (${chat.sessionId})`).join(", ")} of "${member.name}".`;
}

function openRepositories(deps: OrchestratorToolsDeps): Project[] {
	return deps.projects().filter((project) => !isChatsContainer(project));
}

async function attachMember(
	deps: OrchestratorToolsDeps,
	scope: Scope,
	ref: string,
): Promise<string> {
	const open = new Set(openRepositories(deps).map((project) => project.id));
	const candidates = deps.workspaces().filter((workspace) => open.has(workspace.projectId));
	const { matched } = matchWorkspaces([ref], candidates);
	const [only] = matched;
	if (!only || matched.length > 1)
		throw new Error(
			`${matched.length > 1 ? "Ambiguous" : "Unknown"} workspace "${ref.trim()}" to attach; name it by id.`,
		);
	const { container } = scope;
	if (container.workspaceIds.includes(only.id))
		return `"${only.name}" is already a member of the container "${container.name}".`;
	const holder = deps.containers().find((other) => other.workspaceIds.includes(only.id));
	if (holder)
		throw new Error(
			`"${only.name}" belongs to the container "${holder.name}": the orchestrator never takes a member from another container.`,
		);
	deps.join(container.id, only.id);
	return `Attached "${only.name}" (id ${only.id}, branch ${only.branch}) to the container "${container.name}". You are woken when its chats settle or its PR changes.`;
}

interface BaseChoice {
	project?: string;
	baseBranch?: string;
	sibling?: Workspace;
}

function baseChoice(deps: OrchestratorToolsDeps, scope: Scope, params: AddWorkspaceParams) {
	const project = params.project?.trim() || undefined;
	const ref = params.base?.trim();
	if (!ref) return { ...(project ? { project } : {}) } satisfies BaseChoice;
	const { matched } = matchWorkspaces([ref], scope.members);
	if (matched.length > 1)
		throw new Error(
			`Ambiguous base "${ref}": it names several members. Members: ${describeMembers(scope.members)}.`,
		);
	const [sibling] = matched;
	if (!sibling) return { ...(project ? { project } : {}), baseBranch: ref } satisfies BaseChoice;
	if (project && resolveProject(project, undefined, deps.projects()).id !== sibling.projectId) {
		throw new Error(
			`Cannot stack on "${sibling.name}": it belongs to another project. Stack within its project, or pass a branch of this one as \`base\`.`,
		);
	}
	return {
		project: sibling.projectId,
		baseBranch: sibling.branch,
		sibling,
	} satisfies BaseChoice;
}

export async function addWorkspace(
	callerSessionId: string,
	params: AddWorkspaceParams,
	signal?: AbortSignal,
	deps: OrchestratorToolsDeps = liveDeps,
): Promise<string> {
	const scope = scopeOf(deps, callerSessionId);
	const prompt = params.prompt?.trim();
	if (params.attach?.trim()) {
		if (prompt)
			throw new Error(
				"Pass either `attach` (an existing workspace) or `prompt` (a new one), not both.",
			);
		return attachMember(deps, scope, params.attach);
	}
	if (!prompt)
		throw new Error("Pass the new member's `prompt`, or `attach` an existing workspace.");
	const choice: BaseChoice = baseChoice(deps, scope, params);
	const { container } = scope;
	let joined = false;
	let joinError: unknown = null;
	const join = (workspace: Workspace): void => {
		try {
			deps.join(container.id, workspace.id);
			joined = true;
		} catch (error) {
			joinError = error;
		}
	};
	let started: StartedWorkspace;
	try {
		started = await deps.start(
			callerSessionId,
			{
				prompt,
				...(choice.project ? { project: choice.project } : {}),
				...(choice.baseBranch ? { base_branch: choice.baseBranch } : {}),
				...(params.model ? { model: params.model } : {}),
				...(params.effort ? { effort: params.effort } : {}),
				...(params.attachments ? { attachments: params.attachments } : {}),
			},
			join,
			signal,
		);
	} catch (error) {
		if (!joined || !(error instanceof Error)) throw error;
		throw new Error(`${error.message} It is a member of the container "${container.name}".`);
	}
	const model = started.model ? `${started.model}, effort ${started.effort}` : "default model";
	const head = `Started workspace "${started.name}" (id ${started.workspaceId}, branch ${started.branch}, from ${started.baseBranch}) with chat ${started.sessionId} on ${model}`;
	if (!joined) {
		const reason = joinError instanceof Error ? joinError.message : String(joinError);
		return `${head}, but it could not join the container: ${reason}`;
	}
	const stack = choice.sibling
		? ` Stacked on "${choice.sibling.name}": its PR targets ${choice.sibling.branch}.`
		: "";
	return `${head}; it is a member of the container "${container.name}".${stack} You are woken when its chat settles.`;
}

export async function removeWorkspace(
	callerSessionId: string,
	params: RemoveWorkspaceParams,
	deps: OrchestratorToolsDeps = liveDeps,
): Promise<string> {
	const scope = scopeOf(deps, callerSessionId);
	const member = memberOf(deps, scope, params.workspace);
	const { container } = scope;
	if (container.workspaceIds.length <= 1) {
		throw new Error(
			`"${member.name}" is the container's last member: removing it would dissolve the container and delete this orchestrator chat. Ask the human to remove the container instead.`,
		);
	}
	if (params.archive) {
		const seen = member.review?.state === "merged" ? member : await deps.refreshReview(member);
		if (seen.review?.state !== "merged") {
			throw new Error(
				`Not archived: "${member.name}" has ${prLine(seen)}, so its work is not merged. Only a member whose PR is merged is archived; whether to archive or keep unmerged work is the human's call. Call remove_workspace without \`archive\` to leave it as a standalone workspace.`,
			);
		}
		deps.archive(member.id);
		return `Archived "${member.name}" (its PR is merged); it left the container "${container.name}".`;
	}
	await deps.leave(container.id, member.id);
	return `"${member.name}" left the container "${container.name}" and is a standalone workspace now.`;
}

function openedText(member: Workspace, result: OpenPrResult): string {
	const dirty =
		result.dirtyFiles > 0
			? ` ${result.dirtyFiles} uncommitted file(s) in the workspace are not part of it.`
			: "";
	switch (result.action) {
		case "created":
			return `Opened ${result.review ? `PR #${result.review.number}` : "the PR"} for "${member.name}"${result.url ? `: ${result.url}` : ""}.${dirty}`;
		case "updated":
			return `"${member.name}" already had ${result.review ? `PR #${result.review.number}` : "a PR"}; its branch was pushed${result.url ? `: ${result.url}` : ""}.${dirty}`;
		case "pushed":
			return `Pushed ${member.branch}; its remote is neither GitHub nor GitLab, so no PR was opened.${dirty}`;
		case "compare":
			return `Pushed ${member.branch}, but the PR could not be opened directly${result.ghProblem ? ` (gh is ${result.ghProblem})` : ""}: the human can open it at ${result.compareUrl ?? "the provider"}.${dirty}`;
	}
}

export async function openMemberPr(
	callerSessionId: string,
	params: OpenPrToolParams,
	deps: OrchestratorToolsDeps = liveDeps,
): Promise<string> {
	const scope = scopeOf(deps, callerSessionId);
	const member = memberOf(deps, scope, params.workspace);
	return openedText(member, await deps.openPr(member, params));
}

export async function mergeMemberPr(
	callerSessionId: string,
	params: MergePrToolParams,
	approve: MergeApproval,
	deps: OrchestratorToolsDeps = liveDeps,
): Promise<string> {
	const scope = scopeOf(deps, callerSessionId);
	const member = memberOf(deps, scope, params.workspace);
	const review = member.review;
	if (!review || (review.state ?? "open") !== "open")
		throw new Error(
			`"${member.name}" has ${prLine(member)}, so there is no open pull request to merge; open one with open_pr first.`,
		);
	if (review.kind !== "pull-request")
		throw new Error(`merge_pr merges GitHub pull requests; "${member.name}" has a GitLab MR.`);
	const method = params.method ?? "squash";
	const project =
		deps.projects().find((candidate) => candidate.id === member.projectId)?.name ??
		member.projectId;
	const verdict = await approve(
		[
			`Merge PR #${review.number} of ${project} · ${member.name} (${member.branch} → ${member.baseBranch}) with ${method}?`,
			`The orchestrator of "${scope.container.name}" asks to merge it. Only you can approve this; nothing is merged otherwise.`,
		].join("\n"),
	);
	if (verdict === "denied")
		throw new Error(
			`Not merged: the human declined merging PR #${review.number}. Do not merge it unless they ask.`,
		);
	if (verdict !== "approved")
		throw new Error(
			`Not merged: the human did not answer the confirmation (dismissed, timed out, or answered in the chat instead). Ask them in the chat whether to merge PR #${review.number}.`,
		);
	const result = await deps.mergePr({
		workspaceId: member.id,
		branch: member.branch,
		number: review.number,
		method,
		deleteBranch: false,
	});
	await deps.refreshReview(member);
	return result.merged
		? `Merged PR #${review.number} of "${member.name}" into ${member.baseBranch} (${method}); the branch was kept.`
		: `GitHub queued PR #${review.number} of "${member.name}" (merge queue or auto-merge) instead of merging it now.`;
}

export const orchestratorToolsHost: OrchestratorToolsHost = {
	messageChat: (caller, params) => messageChat(caller, params),
	stopChat: (caller, params) => stopChat(caller, params),
	addWorkspace: (caller, params, signal) => addWorkspace(caller, params, signal),
	removeWorkspace: (caller, params) => removeWorkspace(caller, params),
	openPr: (caller, params) => openMemberPr(caller, params),
	mergePr: (caller, params, approve) => mergeMemberPr(caller, params, approve),
};
