import type {
	LoginFrame,
	McpExposure,
	McpListResult,
	McpReadOutputResult,
	McpRenderedTarget,
	McpServerEntryInput,
	McpServerLog,
	McpServerScope,
	Project,
	Workspace,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	effectiveMcpServerConfig,
	getSessionWorkspaceId,
	listMcpServers,
	liveSessionIdsOf,
	type McpProbeAction,
	mcpEntryFingerprint,
	mcpOwnershipGuard,
	mcpPolicyOf,
	readMcpServerLog,
	readMcpToolOutput,
	reconcileMcpSessions,
	reconnectMcpServer,
	refreshMcpStatus,
	removeMcpServerEntry,
	setSessionMcpServerEnabled,
	shareMcpOverrideWithRepo,
	startMcpProbe,
	writeMcpServerEntry,
} from "../agent";
import { logger } from "../log";
import { approveProjectMcpServer, getProjects, setProjectMcpOverride } from "../projects";
import { getWorkspace, listAllWorkspaceRecords, listWorkspaceRecords } from "../workspaces";

const log = logger("host");
const LIST_WAIT_MS = 1500;
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

function target(workspaceId: string): { workspace: Workspace; project: Project } {
	const workspace = getWorkspace(workspaceId);
	const project = getProjects().find((candidate) => candidate.id === workspace.projectId);
	if (!project) throw new Error(`Unknown project: ${workspace.projectId}`);
	return { workspace, project };
}

const handledElsewhere = (): CodedError =>
	new CodedError("MCP_HANDLED_ELSEWHERE", "MCP is not managed by ThinkRail here.");

function assertRenderedEntry(
	name: string,
	onDisk: string | undefined,
	expectedFingerprint: string,
): void {
	if (expectedFingerprint !== onDisk) {
		throw new CodedError(
			"MCP_CONFIG_INVALID",
			`The entry for "${name}" changed since it was opened — review it again.`,
		);
	}
}

function assertRepositoryWritable(project: Project): void {
	if (project.piResourceTrust !== "granted") {
		throw new CodedError(
			"MCP_CONFIG_INVALID",
			"This project isn't trusted — trust it before changing the MCP servers its repository defines.",
		);
	}
}

type Target = { workspace: Workspace; project: Project };

async function admitManaged<T>(
	workspaceId: string,
	admit: (found: Target) => T | Promise<T>,
): Promise<T> {
	const before = target(workspaceId);
	const ownedElsewhere = await mcpOwnershipGuard({
		workspaceId: before.workspace.id,
		cwd: before.workspace.worktreePath,
		projectTrusted: before.project.piResourceTrust === "granted",
	});
	const current = target(workspaceId);
	if (
		current.project.id !== before.project.id ||
		current.workspace.worktreePath !== before.workspace.worktreePath ||
		(current.project.piResourceTrust === "granted") !==
			(before.project.piResourceTrust === "granted")
	) {
		throw new CodedError(
			"MCP_CONFIG_INVALID",
			"The workspace or project trust changed — retry with its current settings.",
		);
	}
	if (ownedElsewhere() !== undefined) throw handledElsewhere();
	return admit(current);
}

function mutateManaged(
	workspaceId: string,
	mutation: (found: Target) => readonly string[],
): Promise<McpListResult> {
	return admitManaged(workspaceId, (found) => {
		reloadLiveSessions(mutation(found));
		return mcpList({ workspaceId });
	});
}

function serverName(name: unknown): string {
	if (typeof name !== "string" || !SERVER_NAME.test(name)) {
		throw new CodedError("MCP_CONFIG_INVALID", "MCP server names use letters, digits, - and _");
	}
	return name;
}

function serverEnabled(enabled: unknown): boolean {
	if (typeof enabled !== "boolean") {
		throw new CodedError("MCP_CONFIG_INVALID", "MCP server enabled must be a boolean");
	}
	return enabled;
}

function serverScope(scope: unknown): McpServerScope {
	if (scope !== "user" && scope !== "project") throw new Error("Invalid MCP server scope");
	return scope;
}

function renderedTarget(params: unknown): McpRenderedTarget {
	const scope = serverScope(isRecord(params) ? params.scope : undefined);
	const expectedFingerprint = isRecord(params) ? params.expectedFingerprint : undefined;
	if (typeof expectedFingerprint !== "string") {
		throw new CodedError(
			"MCP_CONFIG_INVALID",
			"An entry is rewritten or removed only with the fingerprint it was rendered with.",
		);
	}
	return { scope, expectedFingerprint };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function ownedSession(workspaceId: string, sessionId: string): void {
	if (getSessionWorkspaceId(sessionId) !== workspaceId) {
		throw new CodedError("RESOURCE_UNAVAILABLE", "Session resources unavailable");
	}
}

function reloadLiveSessions(workspaceIds: readonly string[]): void {
	const sessionIds = workspaceIds.flatMap((workspaceId) => liveSessionIdsOf(workspaceId));
	void reconcileMcpSessions(sessionIds).catch((error) => {
		log.warn("MCP config change was not applied to the open chats", error as Error);
	});
}

const projectWorkspaces = (project: Project): string[] =>
	listWorkspaceRecords(project.id).map((workspace) => workspace.id);
const allWorkspaces = (): string[] => listAllWorkspaceRecords().map((workspace) => workspace.id);

export function mcpList(params: { workspaceId: string }): Promise<McpListResult> {
	const { workspace, project } = target(params.workspaceId);
	return listMcpServers({
		workspaceId: workspace.id,
		cwd: workspace.worktreePath,
		project,
		waitMs: LIST_WAIT_MS,
	});
}

export function mcpAdd(params: {
	workspaceId: string;
	scope: McpServerScope;
	name: string;
	entry: McpServerEntryInput;
}): Promise<McpListResult> {
	const scope = serverScope(params.scope);
	const name = serverName(params.name);
	return mutateManaged(params.workspaceId, ({ workspace, project }) => {
		if (scope === "project") assertRepositoryWritable(project);
		const fingerprint = writeMcpServerEntry({
			scope,
			worktree: workspace.worktreePath,
			name,
			entry: params.entry,
			mode: "add",
		});
		if (fingerprint) approveProjectMcpServer(project.id, name, fingerprint);
		return scope === "user" ? allWorkspaces() : projectWorkspaces(project);
	});
}

/** A rewrite or removal runs only against the entry the client rendered, at either scope. */
function renderedEntry(
	params: { workspaceId: string; name: string },
	write: (
		options: { scope: McpServerScope; worktree: string; name: string },
		onDisk: string | undefined,
		project: Project,
	) => void,
): Promise<McpListResult> {
	const target = renderedTarget(params);
	const name = serverName(params.name);
	return mutateManaged(params.workspaceId, ({ workspace, project }) => {
		if (target.scope === "project") assertRepositoryWritable(project);
		const onDisk = mcpEntryFingerprint(target.scope, workspace.worktreePath, name);
		assertRenderedEntry(name, onDisk, target.expectedFingerprint);
		write({ scope: target.scope, worktree: workspace.worktreePath, name }, onDisk, project);
		return target.scope === "user" ? allWorkspaces() : projectWorkspaces(project);
	});
}

export function mcpUpdate(params: {
	workspaceId: string;
	name: string;
	entry: McpServerEntryInput;
}): Promise<McpListResult> {
	return renderedEntry(params, (options, onDisk, project) => {
		const fingerprint = writeMcpServerEntry({ ...options, entry: params.entry, mode: "update" });
		if (
			fingerprint &&
			onDisk !== undefined &&
			mcpPolicyOf(project).approvals[options.name] === onDisk
		)
			approveProjectMcpServer(project.id, options.name, fingerprint);
	});
}

export function mcpRemove(params: { workspaceId: string; name: string }): Promise<McpListResult> {
	return renderedEntry(params, (options) => removeMcpServerEntry(options));
}

export function mcpSetProjectOverride(params: {
	workspaceId: string;
	name: string;
	enabled?: boolean;
	exposure?: Exclude<McpExposure, "codemode">;
}): Promise<McpListResult> {
	const name = serverName(params.name);
	return mutateManaged(params.workspaceId, ({ project }) => {
		setProjectMcpOverride(project.id, name, {
			...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
			...(params.exposure !== undefined ? { exposure: params.exposure } : {}),
		});
		return projectWorkspaces(project);
	});
}

export function mcpApprove(params: {
	workspaceId: string;
	name: string;
	fingerprint: string;
}): Promise<McpListResult> {
	const name = serverName(params.name);
	return mutateManaged(params.workspaceId, ({ workspace, project }) => {
		assertRepositoryWritable(project);
		if (mcpEntryFingerprint("project", workspace.worktreePath, name) !== params.fingerprint) {
			throw new CodedError(
				"MCP_CONFIG_INVALID",
				`The entry for "${name}" changed since it was reviewed — review it again.`,
			);
		}
		approveProjectMcpServer(project.id, name, params.fingerprint);
		return projectWorkspaces(project);
	});
}

export function mcpShareWithRepo(params: {
	workspaceId: string;
	name: string;
}): Promise<McpListResult> {
	const name = serverName(params.name);
	return mutateManaged(params.workspaceId, ({ workspace, project }) => {
		assertRepositoryWritable(project);
		const { approvals, overrides } = mcpPolicyOf(project);
		const override = overrides[name];
		if (!override) {
			throw new CodedError("MCP_CONFIG_INVALID", `"${name}" has no project setting to share.`);
		}
		const fingerprint = shareMcpOverrideWithRepo({
			worktree: workspace.worktreePath,
			name,
			override,
			approvedFingerprint: approvals[name],
		});
		approveProjectMcpServer(project.id, name, fingerprint);
		setProjectMcpOverride(project.id, name, null);
		return projectWorkspaces(project);
	});
}

export async function mcpSetSessionOverride(params: {
	workspaceId: string;
	sessionId: string;
	name: string;
	enabled: boolean;
}): Promise<{ ok: true }> {
	const enabled = serverEnabled(params.enabled);
	ownedSession(params.workspaceId, params.sessionId);
	await setSessionMcpServerEnabled(params.sessionId, serverName(params.name), enabled);
	return { ok: true };
}

export async function mcpReconnect(params: {
	workspaceId: string;
	sessionId: string;
	name: string;
}): Promise<{ ok: true }> {
	ownedSession(params.workspaceId, params.sessionId);
	const name = serverName(params.name);
	try {
		await reconnectMcpServer(params.sessionId, name);
	} finally {
		await refreshMcpStatus(params.sessionId, LIST_WAIT_MS);
	}
	return { ok: true };
}

async function probe(
	action: McpProbeAction,
	params: { workspaceId: string; name: string },
	clientKey: string,
): Promise<{ loginId: string; done: Promise<LoginFrame> }> {
	const name = serverName(params.name);
	return admitManaged(params.workspaceId, ({ workspace, project }) => {
		const projectTrusted = project.piResourceTrust === "granted";
		const policy = mcpPolicyOf(project);
		const effective = effectiveMcpServerConfig({
			cwd: workspace.worktreePath,
			projectTrusted,
			policy,
			name,
		});
		if (!effective) {
			throw new CodedError("MCP_CONFIG_INVALID", `No admitted MCP server named "${name}".`);
		}
		if (action === "test" && !("url" in effective)) {
			throw new CodedError(
				"MCP_CONFIG_INVALID",
				"Test connection applies to HTTP servers; a stdio server is verified when a chat starts it.",
			);
		}
		return startMcpProbe({
			action,
			workspaceId: workspace.id,
			cwd: workspace.worktreePath,
			projectTrusted,
			policy,
			serverName: name,
			ownerClientKey: clientKey,
		});
	});
}

export async function mcpLogin(
	params: { workspaceId: string; name: string },
	clientKey: string,
): Promise<{ loginId: string }> {
	const { loginId } = await probe("login", params, clientKey);
	return { loginId };
}

export async function mcpTestConnection(
	params: { workspaceId: string; name: string },
	clientKey: string,
): Promise<{ loginId: string }> {
	const { loginId } = await probe("test", params, clientKey);
	return { loginId };
}

export async function mcpLogout(
	params: { workspaceId: string; name: string },
	clientKey: string,
): Promise<{ ok: true }> {
	const last = await (await probe("logout", params, clientKey)).done;
	if (last.kind === "error") throw new Error(last.message);
	return { ok: true };
}

export function mcpReadLog(params: { workspaceId: string; name: string }): Promise<McpServerLog> {
	target(params.workspaceId);
	return readMcpServerLog(serverName(params.name));
}

export function mcpReadOutput(params: {
	workspaceId: string;
	sessionId: string;
	toolCallId: string;
}): Promise<McpReadOutputResult> {
	ownedSession(params.workspaceId, params.sessionId);
	return readMcpToolOutput(
		params.workspaceId,
		params.sessionId,
		params.toolCallId,
		getWorkspace(params.workspaceId).worktreePath,
	);
}
