import { existsSync, readFileSync } from "node:fs";
import { getAgentDir, type McpServerConfig } from "@earendil-works/pi-coding-agent";
import type { McpProjectOverride, McpServerScope } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	fingerprintMcpEntry,
	globalMcpConfigPath,
	isOverrideEntry,
	isRecord,
	loadHostMcpConfig,
	type McpProjectPolicy,
	projectMcpConfigPath,
	validateMcpServerConfigResult,
} from "./config";
import {
	addMcpServerConfig,
	assertProjectMcpConfigWritable,
	removeMcpServerConfig,
	updateMcpServerConfig,
} from "./writers";

export function effectiveMcpServerConfig(options: {
	cwd: string;
	projectTrusted: boolean;
	policy: McpProjectPolicy;
	name: string;
}): McpServerConfig | undefined {
	return loadHostMcpConfig({ ...options, agentDir: getAgentDir() }).servers.find(
		(server) => server.name === options.name,
	)?.config;
}

function configPath(scope: McpServerScope, worktree: string): string {
	if (scope === "user") return globalMcpConfigPath(getAgentDir());
	const path = projectMcpConfigPath(worktree);
	assertProjectMcpConfigWritable(worktree, path);
	return path;
}

function readRawEntry(path: string, name: string): unknown {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
		const servers = isRecord(parsed) ? parsed.mcpServers : undefined;
		return isRecord(servers) && Object.hasOwn(servers, name) ? servers[name] : undefined;
	} catch {
		return undefined;
	}
}

function readEntry(path: string, name: string): Record<string, unknown> | undefined {
	const entry = readRawEntry(path, name);
	return isRecord(entry) ? entry : undefined;
}

export function writeMcpServerEntry(options: {
	scope: McpServerScope;
	worktree: string;
	name: string;
	entry: Record<string, unknown>;
	mode: "add" | "update";
}): string | undefined {
	const { scope, worktree, name, entry, mode } = options;
	const validated = validateMcpServerConfigResult(name, entry);
	if (validated instanceof CodedError) throw validated;
	if (scope === "project" && "url" in validated && validated.auth) {
		throw new CodedError(
			"MCP_PROJECT_AUTH_FORBIDDEN",
			`server "${name}": auth is only allowed in the global mcp.json`,
			{ name },
		);
	}
	const path = configPath(scope, worktree);
	const existing = readRawEntry(path, name);
	if (mode === "add" && existing !== undefined)
		throw new CodedError("MCP_SERVER_EXISTS", `An MCP server named "${name}" already exists`, {
			name,
		});
	if (mode === "update" && !isRecord(existing))
		throw new CodedError(
			"MCP_SERVER_NOT_FOUND_IN_FILE",
			`No MCP server named "${name}" in ${path}`,
			{ name, path },
		);
	addMcpServerConfig(path, name, entry);
	return scope === "project" ? fingerprintMcpEntry(name, entry) : undefined;
}

export function removeMcpServerEntry(options: {
	scope: McpServerScope;
	worktree: string;
	name: string;
}): void {
	const path = configPath(options.scope, options.worktree);
	if (!removeMcpServerConfig(path, options.name)) {
		throw new CodedError(
			"MCP_SERVER_NOT_FOUND_IN_FILE",
			`No MCP server named "${options.name}" in ${path}`,
			{ name: options.name, path },
		);
	}
}

export function mcpEntryFingerprint(
	scope: McpServerScope,
	worktree: string,
	name: string,
): string | undefined {
	const path =
		scope === "user" ? globalMcpConfigPath(getAgentDir()) : projectMcpConfigPath(worktree);
	const entry = readRawEntry(path, name);
	return entry === undefined ? undefined : fingerprintMcpEntry(name, entry);
}

export function shareMcpOverrideWithRepo(options: {
	worktree: string;
	name: string;
	override: McpProjectOverride;
	approvedFingerprint: string | undefined;
}): string {
	const { name } = options;
	const userEntry = readEntry(globalMcpConfigPath(getAgentDir()), name);
	if (!userEntry || isOverrideEntry(userEntry)) {
		throw new CodedError(
			"MCP_SHARE_SOURCE_MISSING",
			`"${name}" is no longer defined in your mcp.json — nothing to share.`,
			{ name },
		);
	}
	const path = configPath("project", options.worktree);
	const existing = readRawEntry(path, name);
	if (existing !== undefined && (!isRecord(existing) || !isOverrideEntry(existing))) {
		throw new CodedError(
			"MCP_SHARE_ENTRY_EXISTS",
			`The repository's .pi/mcp.json already defines "${name}" — edit that entry instead.`,
			{ name },
		);
	}
	if (
		existing !== undefined &&
		fingerprintMcpEntry(name, existing) !== options.approvedFingerprint
	) {
		throw new CodedError(
			"MCP_SHARE_OVERRIDE_UNAPPROVED",
			`The repository's override for "${name}" isn't approved — review it before sharing.`,
			{ name },
		);
	}
	updateMcpServerConfig(path, name, options.override, { override: true });
	const written = readEntry(path, name);
	if (!written)
		throw new CodedError(
			"MCP_OVERRIDE_WRITE_FAILED",
			`Could not write the override for "${name}"`,
			{ name },
		);
	return fingerprintMcpEntry(name, written);
}
