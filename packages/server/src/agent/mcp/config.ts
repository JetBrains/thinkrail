import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	LoadedMcpConfig,
	McpExposure,
	McpServerConfig,
	McpServerEntry,
} from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import type { McpProjectOverride, Project } from "@thinkrail/contracts";

// Port of pi's `core/mcp-servers.ts` and `extensions/mcp/config.ts` (MIT, Earendil Works).

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const MCP_EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];
const MCP_EXPOSURE_ALIASES: Record<string, McpExposure> = { "codemode-deferred": "codemode" };
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"] as const;

export type McpConfigScope = "global" | "project";

export function globalMcpConfigPath(agentDir: string): string {
	return join(agentDir, "mcp.json");
}

export function projectMcpConfigPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "mcp.json");
}

export function mcpNamespace(server: string): string {
	return `mcp__${server.replace(/-/g, "_")}`;
}

function toolPatternRegExp(pattern: string): RegExp {
	const source = pattern
		.split("*")
		.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${source}$`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

export function isOverrideEntry(value: Record<string, unknown>): boolean {
	return value.command === undefined && value.url === undefined && value.type === undefined;
}

export function isLoopbackRedirectUri(value: string): boolean {
	if (!URL.canParse(value)) return false;
	const url = new URL(value);
	return (
		url.protocol === "http:" &&
		LOOPBACK_HOSTS.includes(url.hostname) &&
		url.search === "" &&
		url.hash === ""
	);
}

function validateOAuth(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return "oauth must be an object";
	if (value.clientId !== undefined && typeof value.clientId !== "string") {
		return "oauth.clientId must be a string";
	}
	if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") {
		return "oauth.clientSecret must be a string";
	}
	const port = value.callbackPort;
	if (
		port !== undefined &&
		(typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
	) {
		return "oauth.callbackPort must be a port number";
	}
	if (value.callbackUrl !== undefined) {
		if (typeof value.callbackUrl !== "string" || !isLoopbackRedirectUri(value.callbackUrl)) {
			return "oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment";
		}
		const urlPort = new URL(value.callbackUrl).port;
		if (urlPort && port !== undefined && Number(urlPort) !== port) {
			return "oauth.callbackUrl and oauth.callbackPort name different ports";
		}
	}
	if (value.scope !== undefined && typeof value.scope !== "string")
		return "oauth.scope must be a string";
	if (
		value.clientName !== undefined &&
		(typeof value.clientName !== "string" || !value.clientName.trim())
	) {
		return "oauth.clientName must be a non-empty string";
	}
	if (value.clientRegistration !== undefined && value.clientRegistration !== "dcr") {
		if (value.clientRegistration !== "cimd") {
			return 'oauth.clientRegistration must be "dcr" or "cimd"';
		}
		if (value.clientId !== undefined || value.clientName !== undefined) {
			return 'oauth.clientRegistration "cimd" cannot be combined with oauth.clientId or oauth.clientName';
		}
		const callback = typeof value.callbackUrl === "string" ? new URL(value.callbackUrl) : undefined;
		if (callback && (callback.hostname === "[::1]" || callback.pathname !== "/callback")) {
			return 'oauth.clientRegistration "cimd" requires oauth.callbackUrl on localhost or 127.0.0.1 with path /callback';
		}
	}
	const metadataUrl = value.authServerMetadataUrl;
	if (metadataUrl !== undefined) {
		const url =
			typeof metadataUrl === "string" && URL.canParse(metadataUrl)
				? new URL(metadataUrl)
				: undefined;
		if (
			!url ||
			!(
				url.protocol === "https:" ||
				(url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname))
			)
		) {
			return "oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]";
		}
	}
	return undefined;
}

function isExposure(value: unknown): value is McpExposure {
	return typeof value === "string" && (MCP_EXPOSURES as readonly string[]).includes(value);
}

function resolveExposureAlias(value: unknown): unknown {
	return typeof value === "string" ? (MCP_EXPOSURE_ALIASES[value] ?? value) : value;
}

function resolveExposureAliases(value: Record<string, unknown>): Record<string, unknown> {
	const { exposure, toolExposure } = value;
	const resolved = { ...value };
	if (exposure !== undefined) resolved.exposure = resolveExposureAlias(exposure);
	if (isRecord(toolExposure)) {
		resolved.toolExposure = Object.fromEntries(
			Object.entries(toolExposure).map(([tool, entry]) => [tool, resolveExposureAlias(entry)]),
		);
	}
	return resolved;
}

export function getMcpToolExposure(config: McpServerConfig, toolName: string): McpExposure {
	const overrides = config.toolExposure ?? {};
	const exact = overrides[toolName];
	if (exact !== undefined) return exact;
	for (const [pattern, exposure] of Object.entries(overrides)) {
		if (pattern.includes("*") && toolPatternRegExp(pattern).test(toolName)) return exposure;
	}
	return config.exposure ?? "codemode";
}

export function validateMcpServerConfig(name: string, raw: unknown): McpServerConfig | string {
	if (!SERVER_NAME.test(name))
		return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
	if (!isRecord(raw)) return `server "${name}" must be an object`;
	const value = resolveExposureAliases(raw);
	const { type, exposure, enabled, timeout, toolExposure, description } = value;
	const exposures = MCP_EXPOSURES.map((entry) => `"${entry}"`).join(", ");
	if (exposure !== undefined && !isExposure(exposure)) {
		return `server "${name}": exposure must be one of ${exposures}`;
	}
	if (toolExposure !== undefined) {
		if (!isRecord(toolExposure))
			return `server "${name}": toolExposure must map tool names to exposures`;
		for (const [tool, entry] of Object.entries(toolExposure)) {
			if (!isExposure(entry))
				return `server "${name}": toolExposure "${tool}" must be one of ${exposures}`;
		}
	}
	if (enabled !== undefined && typeof enabled !== "boolean") {
		return `server "${name}": enabled must be a boolean`;
	}
	if (description !== undefined && typeof description !== "string") {
		return `server "${name}": description must be a string`;
	}
	if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
		return `server "${name}": timeout must be a positive number of seconds`;
	}
	if (type === "sse") {
		return `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`;
	}
	if (
		typeof value.url === "string" &&
		(type === undefined || type === "http" || type === "streamable-http")
	) {
		if (!URL.canParse(value.url) || !/^https?:$/.test(new URL(value.url).protocol)) {
			return `server "${name}": url must be an http or https URL`;
		}
		if (value.headers !== undefined && !isStringRecord(value.headers)) {
			return `server "${name}": headers must map names to strings`;
		}
		const oauthError = validateOAuth(value.oauth);
		if (oauthError) return `server "${name}": ${oauthError}`;
		if (value.auth !== undefined) {
			if (
				!isRecord(value.auth) ||
				typeof value.auth.provider !== "string" ||
				!value.auth.provider
			) {
				return `server "${name}": auth.provider must be a provider name`;
			}
			const url = new URL(value.url);
			if (url.protocol !== "https:" && !LOOPBACK_HOSTS.includes(url.hostname)) {
				return `server "${name}": auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]`;
			}
		}
		return value as unknown as McpServerConfig;
	}
	if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
		if (
			value.args !== undefined &&
			!(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))
		) {
			return `server "${name}": args must be an array of strings`;
		}
		if (value.env !== undefined && !isStringRecord(value.env)) {
			return `server "${name}": env must map names to strings`;
		}
		if (value.cwd !== undefined && typeof value.cwd !== "string") {
			return `server "${name}": cwd must be a string`;
		}
		return value as unknown as McpServerConfig;
	}
	return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

export interface McpConfigFileEntry {
	name: string;
	raw: unknown;
	path: string;
	scope: McpConfigScope;
	override: boolean;
}

export interface LoadedMcpFiles extends LoadedMcpConfig {
	entries: McpConfigFileEntry[];
	fileErrors: { path: string; message: string }[];
}

interface LoadState {
	servers: Map<string, McpServerEntry>;
	errors: string[];
	entries: McpConfigFileEntry[];
	fileErrors: LoadedMcpFiles["fileErrors"];
	autoEnableCodemode?: boolean;
	admitProjectEntry?: (entry: McpConfigFileEntry) => boolean;
}

function readConfigFile(path: string, scope: McpConfigScope, state: LoadState): void {
	const { servers, errors } = state;
	const fileError = (message: string) => {
		errors.push(`${path}: ${message}`);
		state.fileErrors.push({ path, message });
	};
	if (!existsSync(path)) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fileError(error instanceof Error ? error.message : String(error));
		return;
	}
	if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
		fileError('expected an object with an "mcpServers" object');
		return;
	}
	if (typeof parsed.autoEnableCodemode === "boolean") {
		state.autoEnableCodemode = parsed.autoEnableCodemode;
	} else if (parsed.autoEnableCodemode !== undefined) {
		fileError("autoEnableCodemode must be a boolean");
	}
	const mcpServers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
	for (const [name, value] of Object.entries(mcpServers)) {
		const entry: McpConfigFileEntry = {
			name,
			raw: value,
			path,
			scope,
			override: scope === "project" && isRecord(value) && isOverrideEntry(value),
		};
		state.entries.push(entry);
		if (scope === "project" && isRecord(value) && state.admitProjectEntry?.(entry) === false) {
			continue;
		}
		if (scope === "project" && isRecord(value) && isOverrideEntry(value)) {
			const base = servers.get(name);
			const extra = Object.keys(value).filter(
				(key) => !(OVERRIDE_KEYS as readonly string[]).includes(key),
			);
			if (!base) {
				errors.push(
					`${path}: server "${name}" needs "command" or "url", or a global server to override`,
				);
			} else if (extra.length > 0) {
				errors.push(
					`${path}: server "${name}": an override can only set ${OVERRIDE_KEYS.join(", ")}`,
				);
			} else {
				const config = validateMcpServerConfig(name, { ...base.config, ...value });
				if (typeof config === "string") errors.push(`${path}: ${config}`);
				else servers.set(name, { ...base, config, override: path });
			}
			continue;
		}
		const config = validateMcpServerConfig(name, value);
		if (typeof config === "string") {
			errors.push(`${path}: ${config}`);
			continue;
		}
		const clash = [...servers.keys()].find(
			(other) => other !== name && mcpNamespace(other) === mcpNamespace(name),
		);
		if (clash) {
			errors.push(`${path}: server "${name}" conflicts with "${clash}"`);
			continue;
		}
		if (scope === "project" && "url" in config && config.auth) {
			errors.push(`${path}: server "${name}": auth is only allowed in the global mcp.json`);
			continue;
		}
		servers.set(name, { name, config, source: path, scope });
	}
}

export function loadMcpConfigFiles(options: {
	agentDir: string;
	cwd: string;
	projectTrusted: boolean;
	admitProjectEntry?: (entry: McpConfigFileEntry) => boolean;
}): LoadedMcpFiles {
	const state: LoadState = {
		servers: new Map(),
		errors: [],
		entries: [],
		fileErrors: [],
		...(options.admitProjectEntry ? { admitProjectEntry: options.admitProjectEntry } : {}),
	};
	readConfigFile(globalMcpConfigPath(options.agentDir), "global", state);
	const projectConfig = options.projectTrusted ? projectMcpConfigPath(options.cwd) : undefined;
	if (projectConfig) readConfigFile(projectConfig, "project", state);
	return {
		servers: [...state.servers.values()],
		...(state.autoEnableCodemode === undefined
			? {}
			: { autoEnableCodemode: state.autoEnableCodemode }),
		errors: state.errors,
		...(projectConfig ? { projectConfig } : {}),
		entries: state.entries,
		fileErrors: state.fileErrors,
	};
}

function canonicalJson(value: unknown, preserveOrder = false): string {
	if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
	if (isRecord(value)) {
		const keys = Object.keys(value);
		if (!preserveOrder) keys.sort();
		return `{${keys
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], key === "toolExposure")}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

export function fingerprintMcpEntry(name: string, raw: unknown): string {
	return createHash("sha256")
		.update(`${JSON.stringify(name)}:${canonicalJson(raw)}`)
		.digest("hex");
}

export function normalizeExposureForHost(config: McpServerConfig): McpServerConfig {
	const normalized: McpServerConfig = { ...config };
	if (config.exposure === undefined || config.exposure === "codemode")
		normalized.exposure = "deferred";
	if (config.toolExposure) {
		normalized.toolExposure = Object.fromEntries(
			Object.entries(config.toolExposure).map(([tool, exposure]) => [
				tool,
				exposure === "codemode" ? "deferred" : exposure,
			]),
		);
	}
	return normalized;
}

export interface McpProjectPolicy {
	approvals: Readonly<Record<string, string>>;
	overrides: Readonly<Record<string, McpProjectOverride>>;
}

export function mcpPolicyOf(
	project: Pick<Project, "mcpApprovals" | "mcpOverrides"> | undefined,
): McpProjectPolicy {
	return { approvals: project?.mcpApprovals ?? {}, overrides: project?.mcpOverrides ?? {} };
}

export function loadHostMcpConfig(options: {
	agentDir: string;
	cwd: string;
	projectTrusted: boolean;
	policy: McpProjectPolicy;
}): LoadedMcpFiles {
	const { policy } = options;
	const loaded = loadMcpConfigFiles({
		agentDir: options.agentDir,
		cwd: options.cwd,
		projectTrusted: options.projectTrusted,
		admitProjectEntry: (entry) =>
			policy.approvals[entry.name] === fingerprintMcpEntry(entry.name, entry.raw),
	});
	const servers = loaded.servers.map((server) => {
		const override = server.scope === "global" ? policy.overrides[server.name] : undefined;
		const config: McpServerConfig = { ...server.config };
		if (override?.enabled !== undefined) config.enabled = override.enabled;
		if (override?.exposure !== undefined) config.exposure = override.exposure;
		return { ...server, config: normalizeExposureForHost(config) };
	});
	return { ...loaded, servers };
}
