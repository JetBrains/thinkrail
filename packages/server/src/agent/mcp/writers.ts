import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	type Stats,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { McpExposure } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { isOverrideEntry, isRecord } from "./config";

export class McpConfigPathUnsafeError extends Error {
	readonly code = "MCP_PATH_UNSAFE" as const;
}

function lstatOrNull(path: string): Stats | null {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}

export function assertProjectMcpConfigWritable(worktreePath: string, configPath: string): void {
	const rel = relative(resolve(worktreePath), resolve(configPath));
	if (rel.startsWith("..") || isAbsolute(rel)) {
		throw new McpConfigPathUnsafeError(
			`refusing to write MCP config outside the worktree: ${configPath}`,
		);
	}
	const configDir = join(worktreePath, CONFIG_DIR_NAME);
	const dir = lstatOrNull(configDir);
	if (dir && (!dir.isDirectory() || dir.isSymbolicLink())) {
		throw new McpConfigPathUnsafeError(
			`refusing to write MCP config through a non-directory or symlinked ${CONFIG_DIR_NAME}: ${configDir}`,
		);
	}
	const file = lstatOrNull(configPath);
	if (file && (!file.isFile() || file.isSymbolicLink())) {
		throw new McpConfigPathUnsafeError(
			`refusing to write MCP config through a non-regular file: ${configPath}`,
		);
	}
}

type McpServersObject = Record<string, unknown>;

// `__proto__` is a legal server name: read and write it as an own property, never through the prototype.
const ownEntry = (servers: McpServersObject | undefined, name: string): unknown =>
	servers && Object.hasOwn(servers, name) ? servers[name] : undefined;
function setOwnEntry(servers: McpServersObject, name: string, value: unknown): void {
	Object.defineProperty(servers, name, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

function editMcpServers(
	path: string,
	edit: (servers: McpServersObject | undefined, parsed: Record<string, unknown>) => boolean,
): void {
	const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
	const parsed: unknown = text === undefined ? {} : JSON.parse(text);
	if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
		throw new Error(`${path}: expected an object with an "mcpServers" object`);
	}
	const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : undefined;
	if (!edit(servers, parsed)) return;
	const indent = (text && /^([ \t]+)\S/m.exec(text)?.[1]) || "  ";
	mkdirSync(dirname(path), { recursive: true });
	const mode = lstatOrNull(path)?.mode;
	const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(parsed, null, indent)}\n`, {
		...(mode !== undefined ? { mode: mode & 0o777 } : {}),
	});
	renameSync(temporary, path);
}

export interface McpServerConfigPatch {
	enabled?: boolean;
	exposure?: McpExposure;
}

export function updateMcpServerConfig(
	path: string,
	name: string,
	patch: McpServerConfigPatch,
	options: { override?: boolean } = {},
): void {
	editMcpServers(path, (servers, parsed) => {
		let server = ownEntry(servers, name);
		if (server === undefined && options.override) {
			server = {};
			const target = servers ?? {};
			setOwnEntry(target, name, server);
			parsed.mcpServers = target;
		}
		if (!isRecord(server)) throw new Error(`${path} does not define MCP server "${name}"`);
		const keepDefaults = isOverrideEntry(server);
		if (patch.enabled !== undefined) {
			if (patch.enabled && !keepDefaults) delete server.enabled;
			else server.enabled = patch.enabled;
		}
		if (patch.exposure !== undefined) {
			if (patch.exposure === "codemode" && !keepDefaults) delete server.exposure;
			else server.exposure = patch.exposure;
		}
		return true;
	});
}

export function addMcpServerConfig(
	path: string,
	name: string,
	entry: Record<string, unknown>,
): boolean {
	let replaced = false;
	editMcpServers(path, (servers, parsed) => {
		const target = servers ?? {};
		replaced = ownEntry(target, name) !== undefined;
		setOwnEntry(target, name, entry);
		parsed.mcpServers = target;
		return true;
	});
	return replaced;
}

export function removeMcpServerConfig(path: string, name: string): boolean {
	if (!existsSync(path)) return false;
	let removed = false;
	editMcpServers(path, (servers) => {
		if (ownEntry(servers, name) === undefined || !servers) return false;
		delete servers[name];
		removed = true;
		return true;
	});
	return removed;
}
