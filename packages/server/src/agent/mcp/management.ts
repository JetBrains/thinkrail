import { existsSync, readFileSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { McpProjectOverride, McpServerScope } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	fingerprintMcpEntry,
	globalMcpConfigPath,
	isOverrideEntry,
	isRecord,
	projectMcpConfigPath,
	validateMcpServerConfig,
} from "./config";
import {
	addMcpServerConfig,
	assertProjectMcpConfigWritable,
	McpConfigPathUnsafeError,
	removeMcpServerConfig,
	updateMcpServerConfig,
} from "./writers";

function configPath(scope: McpServerScope, worktree: string): string {
	if (scope === "user") return globalMcpConfigPath(getAgentDir());
	const path = projectMcpConfigPath(worktree);
	try {
		assertProjectMcpConfigWritable(worktree, path);
	} catch (error) {
		if (error instanceof McpConfigPathUnsafeError)
			throw new CodedError("MCP_PATH_UNSAFE", error.message);
		throw error;
	}
	return path;
}

function readEntry(path: string, name: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		const servers = isRecord(parsed) ? parsed.mcpServers : undefined;
		const entry = isRecord(servers) ? servers[name] : undefined;
		return isRecord(entry) ? entry : undefined;
	} catch {
		return undefined;
	}
}

function invalid(message: string): CodedError {
	return new CodedError("MCP_CONFIG_INVALID", message);
}

export function writeMcpServerEntry(options: {
	scope: McpServerScope;
	worktree: string;
	name: string;
	entry: Record<string, unknown>;
	mode: "add" | "update";
}): string | undefined {
	const { scope, worktree, name, entry, mode } = options;
	const validated = validateMcpServerConfig(name, entry);
	if (typeof validated === "string") throw invalid(validated);
	if (scope === "project" && "url" in validated && validated.auth) {
		throw invalid(`server "${name}": auth is only allowed in the global mcp.json`);
	}
	const path = configPath(scope, worktree);
	const exists = readEntry(path, name) !== undefined;
	if (mode === "add" && exists) throw invalid(`An MCP server named "${name}" already exists`);
	if (mode === "update" && !exists) throw invalid(`No MCP server named "${name}" in ${path}`);
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
		throw invalid(`No MCP server named "${options.name}" in ${path}`);
	}
}

export function projectMcpEntryFingerprint(worktree: string, name: string): string | undefined {
	const entry = readEntry(projectMcpConfigPath(worktree), name);
	return entry ? fingerprintMcpEntry(name, entry) : undefined;
}

export function shareMcpOverrideWithRepo(options: {
	worktree: string;
	name: string;
	override: McpProjectOverride;
	approvedFingerprint: string | undefined;
}): string {
	const { name } = options;
	const path = configPath("project", options.worktree);
	const existing = readEntry(path, name);
	if (existing && !isOverrideEntry(existing)) {
		throw invalid(
			`The repository's .pi/mcp.json already defines "${name}" — edit that entry instead.`,
		);
	}
	if (existing && fingerprintMcpEntry(name, existing) !== options.approvedFingerprint) {
		throw invalid(
			`The repository's override for "${name}" isn't approved — review it before sharing.`,
		);
	}
	updateMcpServerConfig(path, name, options.override, { override: true });
	const written = readEntry(path, name);
	if (!written) throw invalid(`Could not write the override for "${name}"`);
	return fingerprintMcpEntry(name, written);
}
