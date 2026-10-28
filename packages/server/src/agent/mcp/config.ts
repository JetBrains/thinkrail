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
import type { McpProjectOverride, McpToolGrant, Project } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

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

function validateOAuth(name: string, value: unknown): CodedError | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value))
		return new CodedError(
			"MCP_FIELD_OBJECT_REQUIRED",
			`server "${name}": oauth must be an object`,
			{ name, field: "oauth" },
		);
	if (value.clientId !== undefined && typeof value.clientId !== "string") {
		return new CodedError(
			"MCP_FIELD_STRING_REQUIRED",
			`server "${name}": oauth.clientId must be a string`,
			{ name, field: "oauth.clientId" },
		);
	}
	if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") {
		return new CodedError(
			"MCP_FIELD_STRING_REQUIRED",
			`server "${name}": oauth.clientSecret must be a string`,
			{ name, field: "oauth.clientSecret" },
		);
	}
	const port = value.callbackPort;
	if (
		port !== undefined &&
		(typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)
	) {
		return new CodedError(
			"MCP_FIELD_PORT_REQUIRED",
			`server "${name}": oauth.callbackPort must be a port number`,
			{ name, field: "oauth.callbackPort" },
		);
	}
	if (value.callbackUrl !== undefined) {
		if (typeof value.callbackUrl !== "string" || !isLoopbackRedirectUri(value.callbackUrl)) {
			return new CodedError(
				"MCP_FIELD_LOOPBACK_URI_REQUIRED",
				`server "${name}": oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment`,
				{ name, field: "oauth.callbackUrl" },
			);
		}
		const urlPort = new URL(value.callbackUrl).port;
		if (urlPort && port !== undefined && Number(urlPort) !== port) {
			return new CodedError(
				"MCP_OAUTH_PORT_MISMATCH",
				`server "${name}": oauth.callbackUrl and oauth.callbackPort name different ports`,
				{ name },
			);
		}
	}
	if (value.scope !== undefined && typeof value.scope !== "string")
		return new CodedError(
			"MCP_FIELD_STRING_REQUIRED",
			`server "${name}": oauth.scope must be a string`,
			{ name, field: "oauth.scope" },
		);
	if (
		value.clientName !== undefined &&
		(typeof value.clientName !== "string" || !value.clientName.trim())
	) {
		return new CodedError(
			"MCP_FIELD_NONEMPTY_STRING_REQUIRED",
			`server "${name}": oauth.clientName must be a non-empty string`,
			{ name, field: "oauth.clientName" },
		);
	}
	if (value.clientRegistration !== undefined && value.clientRegistration !== "dcr") {
		if (value.clientRegistration !== "cimd") {
			return new CodedError(
				"MCP_OAUTH_REGISTRATION_INVALID",
				`server "${name}": oauth.clientRegistration must be "dcr" or "cimd"`,
				{ name },
			);
		}
		if (value.clientId !== undefined || value.clientName !== undefined) {
			return new CodedError(
				"MCP_OAUTH_CIMD_CONFLICT",
				`server "${name}": oauth.clientRegistration "cimd" cannot be combined with oauth.clientId or oauth.clientName`,
				{ name },
			);
		}
		const callback = typeof value.callbackUrl === "string" ? new URL(value.callbackUrl) : undefined;
		if (callback && (callback.hostname === "[::1]" || callback.pathname !== "/callback")) {
			return new CodedError(
				"MCP_OAUTH_CIMD_CALLBACK_INVALID",
				`server "${name}": oauth.clientRegistration "cimd" requires oauth.callbackUrl on localhost or 127.0.0.1 with path /callback`,
				{ name },
			);
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
			return new CodedError(
				"MCP_FIELD_SECURE_URL_REQUIRED",
				`server "${name}": oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]`,
				{ name, field: "oauth.authServerMetadataUrl" },
			);
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

export function validateMcpServerConfig(name: string, raw: unknown): McpServerConfig | string {
	const result = validateMcpServerConfigResult(name, raw);
	return result instanceof CodedError ? result.message : result;
}

export function validateMcpServerConfigResult(
	name: string,
	raw: unknown,
): McpServerConfig | CodedError {
	if (!SERVER_NAME.test(name))
		return new CodedError(
			"MCP_CONFIG_NAME_INVALID",
			`invalid server name "${name}" (use letters, digits, "_" and "-")`,
			{ name },
		);
	if (!isRecord(raw))
		return new CodedError("MCP_ENTRY_OBJECT_REQUIRED", `server "${name}" must be an object`, {
			name,
		});
	const value = resolveExposureAliases(raw);
	const { type, exposure, enabled, timeout, toolExposure, description } = value;
	const exposures = MCP_EXPOSURES.map((entry) => `"${entry}"`).join(", ");
	if (exposure !== undefined && !isExposure(exposure)) {
		return new CodedError(
			"MCP_FIELD_EXPOSURE_INVALID",
			`server "${name}": exposure must be one of ${exposures}`,
			{ name, field: "exposure" },
		);
	}
	if (toolExposure !== undefined) {
		if (!isRecord(toolExposure))
			return new CodedError(
				"MCP_TOOL_EXPOSURE_MAP_REQUIRED",
				`server "${name}": toolExposure must map tool names to exposures`,
				{ name },
			);
		for (const [tool, entry] of Object.entries(toolExposure)) {
			if (!isExposure(entry))
				return new CodedError(
					"MCP_TOOL_EXPOSURE_INVALID",
					`server "${name}": toolExposure "${tool}" must be one of ${exposures}`,
					{ name, tool },
				);
		}
	}
	if (enabled !== undefined && typeof enabled !== "boolean") {
		return new CodedError(
			"MCP_FIELD_BOOLEAN_REQUIRED",
			`server "${name}": enabled must be a boolean`,
			{ name, field: "enabled" },
		);
	}
	if (description !== undefined && typeof description !== "string") {
		return new CodedError(
			"MCP_FIELD_STRING_REQUIRED",
			`server "${name}": description must be a string`,
			{ name, field: "description" },
		);
	}
	if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
		return new CodedError(
			"MCP_FIELD_POSITIVE_SECONDS_REQUIRED",
			`server "${name}": timeout must be a positive number of seconds`,
			{ name, field: "timeout" },
		);
	}
	if (type === "sse") {
		return new CodedError(
			"MCP_SSE_UNSUPPORTED",
			`server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`,
			{ name },
		);
	}
	if (
		typeof value.url === "string" &&
		(type === undefined || type === "http" || type === "streamable-http")
	) {
		if (!URL.canParse(value.url) || !/^https?:$/.test(new URL(value.url).protocol)) {
			return new CodedError(
				"MCP_FIELD_HTTP_URL_REQUIRED",
				`server "${name}": url must be an http or https URL`,
				{ name, field: "url" },
			);
		}
		if (value.headers !== undefined && !isStringRecord(value.headers)) {
			return new CodedError(
				"MCP_FIELD_STRING_MAP_REQUIRED",
				`server "${name}": headers must map names to strings`,
				{ name, field: "headers" },
			);
		}
		const oauthError = validateOAuth(name, value.oauth);
		if (oauthError) return oauthError;
		if (value.auth !== undefined) {
			if (
				!isRecord(value.auth) ||
				typeof value.auth.provider !== "string" ||
				!value.auth.provider
			) {
				return new CodedError(
					"MCP_AUTH_PROVIDER_REQUIRED",
					`server "${name}": auth.provider must be a provider name`,
					{ name },
				);
			}
			const url = new URL(value.url);
			if (url.protocol !== "https:" && !LOOPBACK_HOSTS.includes(url.hostname)) {
				return new CodedError(
					"MCP_AUTH_SECURE_URL_REQUIRED",
					`server "${name}": auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]`,
					{ name },
				);
			}
		}
		return value as unknown as McpServerConfig;
	}
	if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
		if (
			value.args !== undefined &&
			!(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))
		) {
			return new CodedError(
				"MCP_FIELD_STRING_ARRAY_REQUIRED",
				`server "${name}": args must be an array of strings`,
				{ name, field: "args" },
			);
		}
		if (value.env !== undefined && !isStringRecord(value.env)) {
			return new CodedError(
				"MCP_FIELD_STRING_MAP_REQUIRED",
				`server "${name}": env must map names to strings`,
				{ name, field: "env" },
			);
		}
		if (value.cwd !== undefined && typeof value.cwd !== "string") {
			return new CodedError("MCP_FIELD_STRING_REQUIRED", `server "${name}": cwd must be a string`, {
				name,
				field: "cwd",
			});
		}
		return value as unknown as McpServerConfig;
	}
	return new CodedError(
		"MCP_TRANSPORT_REQUIRED",
		`server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`,
		{ name },
	);
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
		parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
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

export function mcpTargetOf(config: McpServerConfig): string {
	const target =
		"url" in config && typeof config.url === "string"
			? { url: config.url }
			: {
					command: "command" in config ? config.command : null,
					args: "args" in config ? (config.args ?? []) : [],
				};
	return createHash("sha256").update(JSON.stringify(target)).digest("hex");
}

export function mcpToolLabel(server: string, tool: string): string {
	const prefix = `${mcpNamespace(server)}__`;
	return tool.startsWith(prefix) ? tool.slice(prefix.length) : tool;
}

export function grantedMcpTools(
	policy: McpProjectPolicy,
	server: string,
	config: McpServerConfig,
): readonly string[] {
	const grant = policy.toolGrants[server];
	return grant && grant.target === mcpTargetOf(config) ? grant.tools : [];
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
	toolGrants: Readonly<Record<string, McpToolGrant>>;
}

// Null-prototype copies, so a server named `__proto__` never reads Object.prototype as its policy.
const ownEntries = <T>(record: Record<string, T> | undefined): Record<string, T> =>
	Object.assign(Object.create(null) as Record<string, T>, record);

export function mcpPolicyOf(
	project: Pick<Project, "mcpApprovals" | "mcpOverrides" | "mcpToolGrants"> | undefined,
): McpProjectPolicy {
	return {
		approvals: ownEntries(project?.mcpApprovals),
		overrides: ownEntries(project?.mcpOverrides),
		toolGrants: ownEntries(project?.mcpToolGrants),
	};
}

export function loadHostMcpConfig(options: {
	agentDir: string;
	cwd: string;
	projectTrusted: boolean;
	policy: McpProjectPolicy;
	disabledInChat?: ReadonlySet<string>;
}): LoadedMcpFiles {
	const { policy, disabledInChat } = options;
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
		if (disabledInChat?.has(server.name)) config.enabled = false;
		return { ...server, config: normalizeExposureForHost(config) };
	});
	return { ...loaded, servers };
}
