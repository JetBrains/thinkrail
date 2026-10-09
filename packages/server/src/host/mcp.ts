import type {
	LoginFrame,
	McpExposure,
	McpListResult,
	McpReadOutputResult,
	McpServerEntryInput,
	McpServerLog,
	McpServerScope,
	Project,
	Workspace,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	getSessionWorkspaceId,
	listMcpServers,
	liveSessionIdsOf,
	type McpProbeAction,
	mcpHandledElsewhereBy,
	mcpPolicyOf,
	projectMcpEntryFingerprint,
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
	expectedFingerprint: string | undefined,
): void {
	if (expectedFingerprint !== undefined && expectedFingerprint !== onDisk) {
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

async function managedTarget(
	workspaceId: string,
): Promise<{ workspace: Workspace; project: Project }> {
	const found = target(workspaceId);
	const by = await mcpHandledElsewhereBy({
		workspaceId: found.workspace.id,
		cwd: found.workspace.worktreePath,
		projectTrusted: found.project.piResourceTrust === "granted",
	});
	if (by !== undefined) throw handledElsewhere();
	return found;
}

function serverName(name: unknown): string {
	if (typeof name !== "string" || !SERVER_NAME.test(name)) {
		throw new CodedError("MCP_CONFIG_INVALID", "MCP server names use letters, digits, - and _");
	}
	return name;
}

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

export function mcpList(params: { workspaceId: string }): Promise<McpListResult> {
	const { workspace, project } = target(params.workspaceId);
	return listMcpServers({
		workspaceId: workspace.id,
		cwd: workspace.worktreePath,
		project,
		waitMs: LIST_WAIT_MS,
	});
}

export async function mcpWrite(
	params: {
		workspaceId: string;
		scope: McpServerScope;
		name: string;
		entry: McpServerEntryInput;
		expectedFingerprint?: string;
	},
	mode: "add" | "update",
): Promise<McpListResult> {
	const { workspace, project } = await managedTarget(params.workspaceId);
	if (params.scope === "project") assertRepositoryWritable(project);
	const name = serverName(params.name);
	const rewrite = mode === "update" && params.scope === "project";
	const onDisk = rewrite ? projectMcpEntryFingerprint(workspace.worktreePath, name) : undefined;
	if (rewrite) assertRenderedEntry(name, onDisk, params.expectedFingerprint);
	const fingerprint = writeMcpServerEntry({
		scope: params.scope,
		worktree: workspace.worktreePath,
		name,
		entry: params.entry,
		mode,
	});
	const approved =
		mode === "add" || (onDisk !== undefined && project.mcpApprovals?.[name] === onDisk);
	if (fingerprint && approved) approveProjectMcpServer(project.id, name, fingerprint);
	reloadLiveSessions(
		params.scope === "user"
			? listAllWorkspaceRecords().map((ws) => ws.id)
			: projectWorkspaces(project),
	);
	return mcpList(params);
}

export async function mcpRemove(params: {
	workspaceId: string;
	scope: McpServerScope;
	name: string;
	expectedFingerprint?: string;
}): Promise<McpListResult> {
	const { workspace, project } = await managedTarget(params.workspaceId);
	const name = serverName(params.name);
	if (params.scope === "project") {
		assertRepositoryWritable(project);
		assertRenderedEntry(
			name,
			projectMcpEntryFingerprint(workspace.worktreePath, name),
			params.expectedFingerprint,
		);
	}
	removeMcpServerEntry({ scope: params.scope, worktree: workspace.worktreePath, name });
	reloadLiveSessions(
		params.scope === "user"
			? listAllWorkspaceRecords().map((ws) => ws.id)
			: projectWorkspaces(project),
	);
	return mcpList(params);
}

export async function mcpSetProjectOverride(params: {
	workspaceId: string;
	name: string;
	enabled?: boolean;
	exposure?: Exclude<McpExposure, "codemode">;
}): Promise<McpListResult> {
	const { project } = await managedTarget(params.workspaceId);
	const name = serverName(params.name);
	const override = {
		...project.mcpOverrides?.[name],
		...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
		...(params.exposure !== undefined ? { exposure: params.exposure } : {}),
	};
	setProjectMcpOverride(project.id, name, Object.keys(override).length > 0 ? override : null);
	reloadLiveSessions(projectWorkspaces(project));
	return mcpList(params);
}

export async function mcpApprove(params: {
	workspaceId: string;
	name: string;
	fingerprint: string;
}): Promise<McpListResult> {
	const { workspace, project } = await managedTarget(params.workspaceId);
	assertRepositoryWritable(project);
	const name = serverName(params.name);
	if (projectMcpEntryFingerprint(workspace.worktreePath, name) !== params.fingerprint) {
		throw new CodedError(
			"MCP_CONFIG_INVALID",
			`The entry for "${name}" changed since it was reviewed — review it again.`,
		);
	}
	approveProjectMcpServer(project.id, name, params.fingerprint);
	reloadLiveSessions(projectWorkspaces(project));
	return mcpList(params);
}

export async function mcpShareWithRepo(params: {
	workspaceId: string;
	name: string;
}): Promise<McpListResult> {
	const { workspace, project } = await managedTarget(params.workspaceId);
	assertRepositoryWritable(project);
	const name = serverName(params.name);
	const override = project.mcpOverrides?.[name];
	if (!override) {
		throw new CodedError("MCP_CONFIG_INVALID", `"${name}" has no project setting to share.`);
	}
	const fingerprint = shareMcpOverrideWithRepo({
		worktree: workspace.worktreePath,
		name,
		override,
		approvedFingerprint: project.mcpApprovals?.[name],
	});
	approveProjectMcpServer(project.id, name, fingerprint);
	setProjectMcpOverride(project.id, name, null);
	reloadLiveSessions(projectWorkspaces(project));
	return mcpList(params);
}

export async function mcpSetSessionOverride(params: {
	workspaceId: string;
	sessionId: string;
	name: string;
	enabled: boolean;
}): Promise<{ ok: true }> {
	ownedSession(params.workspaceId, params.sessionId);
	await setSessionMcpServerEnabled(params.sessionId, serverName(params.name), params.enabled);
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
	const { workspace, project } = target(params.workspaceId);
	const name = serverName(params.name);
	const listed = await listMcpServers({
		workspaceId: workspace.id,
		cwd: workspace.worktreePath,
		project,
		waitMs: 0,
	});
	if (listed.handledElsewhere) throw handledElsewhere();
	if (
		action === "test" &&
		listed.servers.find((server) => server.name === name)?.transport !== "http"
	) {
		throw new CodedError(
			"MCP_CONFIG_INVALID",
			"Test connection applies to HTTP servers; a stdio server is verified when a chat starts it.",
		);
	}
	return startMcpProbe({
		action,
		workspaceId: workspace.id,
		cwd: workspace.worktreePath,
		projectTrusted: project.piResourceTrust === "granted",
		policy: mcpPolicyOf(project),
		serverName: name,
		ownerClientKey: clientKey,
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
