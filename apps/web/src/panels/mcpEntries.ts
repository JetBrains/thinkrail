import type {
	McpExposure,
	McpServerEntryInput,
	McpServerScope,
	McpServerSummary,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, t } from "@thinkrail/locales/react";

export type McpEditableExposure = Exclude<McpExposure, "codemode">;

export const MCP_EXPOSURES: readonly McpEditableExposure[] = ["deferred", "direct", "hidden"];

export const MCP_EXPOSURE_HINT = {
	deferred: "mcp.exposure.deferredHint",
	direct: "mcp.exposure.directHint",
	hidden: "mcp.exposure.hiddenHint",
} as const satisfies Readonly<Record<McpEditableExposure, MessageKey>>;

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_NAME_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*/;
const SECRET_NAME = /token|secret|passw(or)?d|api[-_]?key|auth|bearer|credential|session/i;
const TYPES = new Set(["stdio", "http", "streamable-http"]);

export const MCP_HIDDEN_VALUE = "<literal value hidden>";

interface McpValueRow {
	id: string;
	name: string;
	value: string;
}

export interface McpFormDraft {
	name: string;
	transport: "http" | "stdio";
	url: string;
	command: string;
	args: string;
	values: McpValueRow[];
	exposure: McpEditableExposure;
	description: string;
}

interface McpFormIssues {
	name?: string;
	url?: string;
	command?: string;
	values?: string;
}

interface McpRunItem {
	label: string;
	text: string;
}

export interface McpServerReview {
	name: string;
	runs: McpRunItem[];
}

interface McpValueFact {
	name: string;
	value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringEntries(value: unknown): [string, string][] {
	return isRecord(value)
		? Object.entries(value).flatMap(([key, entry]) =>
				typeof entry === "string" ? [[key, entry] as [string, string]] : [],
			)
		: [];
}

function valueIn(map: unknown, name: string): unknown {
	return isRecord(map) && Object.hasOwn(map, name) ? map[name] : undefined;
}

function mapValues(
	map: Record<string, unknown>,
	fn: (name: string, value: unknown) => unknown,
): Record<string, unknown> {
	return Object.fromEntries(Object.entries(map).map(([name, value]) => [name, fn(name, value)]));
}

function joinLabels(t: Translator, labels: readonly string[]): string {
	return labels.length < 2
		? (labels[0] ?? "")
		: t("mcp.entries.labelList", { head: labels.slice(0, -1).join(", "), last: labels.at(-1) });
}

function namespaceOf(name: string): string {
	return name.replace(/-/g, "_");
}

export function isConfigReference(value: string): boolean {
	if (value.startsWith("!")) return true;
	for (let index = value.indexOf("$"); index >= 0; index = value.indexOf("$", index + 1)) {
		const next = value[index + 1];
		if (next === "$" || next === "!") {
			index += 1;
			continue;
		}
		if (next === "{") {
			const end = value.indexOf("}", index + 2);
			if (end >= 0) {
				if (ENV_NAME.test(value.slice(index + 2, end))) return true;
				index = end;
			}
			continue;
		}
		if (ENV_NAME_PREFIX.test(value.slice(index + 1))) return true;
	}
	return false;
}

function isLiteral(value: string): boolean {
	return value !== "" && !isConfigReference(value);
}

export function mcpLiteralValues(
	entry: McpServerEntryInput,
	written?: McpServerEntryInput,
): string[] {
	const fresh = (map: unknown, name: string, value: string) =>
		isLiteral(value) && valueIn(map, name) !== value;
	const labels = [
		...stringEntries(entry.env)
			.filter(([name, value]) => fresh(written?.env, name, value))
			.map(([name]) => `env ${name}`),
		...stringEntries(entry.headers)
			.filter(([name, value]) => fresh(written?.headers, name, value))
			.map(([name]) => `header ${name}`),
	];
	const secret = isRecord(entry.oauth) ? entry.oauth.clientSecret : undefined;
	if (typeof secret === "string" && fresh(written?.oauth, "clientSecret", secret)) {
		labels.push("oauth clientSecret");
	}
	return labels;
}

function urlCredentials(url: unknown): Map<string, string> {
	const parts = new Map<string, string>();
	if (typeof url !== "string" || !URL.canParse(url)) return parts;
	const parsed = new URL(url);
	if (parsed.username || parsed.password) {
		parts.set("user info", `${parsed.username}:${parsed.password}`);
	}
	for (const [key, value] of parsed.searchParams) {
		if (value && SECRET_NAME.test(key)) parts.set(`query "${key}"`, value);
	}
	return parts;
}

export function mcpUrlCredentials(
	entry: McpServerEntryInput,
	written?: McpServerEntryInput,
): string[] {
	const kept = urlCredentials(written?.url);
	return [...urlCredentials(entry.url)]
		.filter(([label, value]) => kept.get(label) !== value)
		.map(([label]) => label);
}

function literalIssue(t: Translator, labels: readonly string[]): string | undefined {
	if (labels.length === 0) return undefined;
	return t("mcp.entries.notReference", {
		count: labels.length,
		labels: joinLabels(t, labels),
		hint: t("mcp.entries.referenceHint"),
	});
}

function urlIssue(t: Translator, labels: readonly string[]): string | undefined {
	return labels.length === 0
		? undefined
		: t("mcp.entries.urlCredential", { labels: labels.join(", ") });
}

function present(...issues: (string | undefined)[]): string[] {
	return issues.filter((issue): issue is string => issue !== undefined);
}

export function mcpSecretIssues(
	t: Translator,
	entry: McpServerEntryInput,
	written?: McpServerEntryInput,
): string[] {
	return present(
		literalIssue(t, mcpLiteralValues(entry, written)),
		urlIssue(t, mcpUrlCredentials(entry, written)),
	);
}

export function formatCommandLine(command: string, args: readonly string[]): string {
	return [command, ...args]
		.map((part) => (part === "" || /[\s"'\\]/.test(part) ? JSON.stringify(part) : part))
		.join(" ");
}

function shellRuns(entry: McpServerEntryInput): McpRunItem[] {
	const runs: McpRunItem[] = [];
	const shell = (label: string, value: string) => {
		if (value.startsWith("!")) runs.push({ label, text: value.slice(1).trim() });
	};
	for (const [key, value] of stringEntries(entry.env)) shell(`env ${key}`, value);
	for (const [key, value] of stringEntries(entry.headers)) shell(`header ${key}`, value);
	if (isRecord(entry.oauth) && typeof entry.oauth.clientSecret === "string") {
		shell("oauth clientSecret", entry.oauth.clientSecret);
	}
	return runs;
}

export function mcpRunList(entry: McpServerEntryInput): McpRunItem[] {
	if (typeof entry.command !== "string") return shellRuns(entry);
	const args = Array.isArray(entry.args)
		? entry.args.filter((arg): arg is string => typeof arg === "string")
		: [];
	return [{ label: "command", text: formatCommandLine(entry.command, args) }, ...shellRuns(entry)];
}

export function reviewMcpServer(name: string, entry: McpServerEntryInput): McpServerReview {
	return { name, runs: mcpRunList(entry) };
}

export function needsMcpReview(reviews: readonly McpServerReview[]): boolean {
	return reviews.some((review) => review.runs.length > 0);
}

export function hasMcpValueCommands(reviews: readonly McpServerReview[]): boolean {
	return reviews.some((review) => review.runs.some((run) => run.label !== "command"));
}

function shownValue(value: unknown): string {
	return typeof value === "string" && (value === "" || isConfigReference(value))
		? value
		: MCP_HIDDEN_VALUE;
}

function isHidden(value: unknown): boolean {
	return shownValue(value) === MCP_HIDDEN_VALUE;
}

export function hideMcpLiterals(entry: McpServerEntryInput): McpServerEntryInput {
	const hide = (_name: string, value: unknown) => (isHidden(value) ? MCP_HIDDEN_VALUE : value);
	const shown: McpServerEntryInput = { ...entry };
	if (isRecord(entry.env)) shown.env = mapValues(entry.env, hide);
	if (isRecord(entry.headers)) shown.headers = mapValues(entry.headers, hide);
	if (isRecord(entry.oauth) && Object.hasOwn(entry.oauth, "clientSecret")) {
		shown.oauth = { ...entry.oauth, clientSecret: hide("clientSecret", entry.oauth.clientSecret) };
	}
	return shown;
}

export function mcpEditedEntry(
	t: Translator,
	next: McpServerEntryInput,
	written: McpServerEntryInput,
): { entry: McpServerEntryInput; issues: string[] } {
	const unresolved: string[] = [];
	const restore = (label: string, source: unknown) => (name: string, value: unknown) => {
		if (typeof value !== "string" || !value.includes(MCP_HIDDEN_VALUE)) return value;
		const original = valueIn(source, name);
		if (value === MCP_HIDDEN_VALUE && original !== undefined && isHidden(original)) return original;
		unresolved.push(`${label} ${name}`);
		return value;
	};
	const entry: McpServerEntryInput = { ...next };
	if (isRecord(next.env)) entry.env = mapValues(next.env, restore("env", written.env));
	if (isRecord(next.headers)) {
		entry.headers = mapValues(next.headers, restore("header", written.headers));
	}
	if (isRecord(next.oauth) && Object.hasOwn(next.oauth, "clientSecret")) {
		entry.oauth = {
			...next.oauth,
			clientSecret: restore("oauth", written.oauth)("clientSecret", next.oauth.clientSecret),
		};
	}
	const hidden =
		unresolved.length === 0
			? undefined
			: t("mcp.entries.stillHidden", {
					count: unresolved.length,
					labels: joinLabels(t, unresolved),
					hidden: MCP_HIDDEN_VALUE,
					hint: t("mcp.entries.referenceHint"),
				});
	return {
		entry,
		issues: present(
			hidden,
			literalIssue(
				t,
				mcpLiteralValues(entry, written).filter((label) => !unresolved.includes(label)),
			),
			urlIssue(t, mcpUrlCredentials(entry, written)),
		),
	};
}

export const SCOPE_LABEL = {
	user: "mcp.scope.user",
	project: "mcp.scope.project",
} as const satisfies Readonly<Record<McpServerScope, MessageKey>>;

export function mcpNameIssue(
	t: Translator,
	name: string,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
	siblings: readonly string[] = [],
): string | undefined {
	if (!name) return t("mcp.entries.nameRequired");
	if (!SERVER_NAME.test(name)) return t("mcp.entries.nameInvalid");
	if (existing.some((server) => server.scope === scope && server.name === name)) {
		return scope === "user"
			? t("mcp.entries.nameExistsUser", { name })
			: t("mcp.entries.nameExistsProject", { name });
	}
	const twin = [...existing.map((server) => server.name), ...siblings].find(
		(other) => other !== name && namespaceOf(other) === namespaceOf(name),
	);
	return twin ? t("mcp.entries.nameClash", { twin }) : undefined;
}

export function mcpNameWarning(
	t: Translator,
	name: string,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
): string | undefined {
	const other = existing.find((server) => server.name === name && server.scope !== scope);
	if (!other) return undefined;
	return scope === "project"
		? t("mcp.entries.replacesUser", { name })
		: t("mcp.entries.projectTakesPrecedence", { name });
}

export function emptyMcpDraft(): McpFormDraft {
	return {
		name: "",
		transport: "stdio",
		url: "",
		command: "",
		args: "",
		values: [],
		exposure: "deferred",
		description: "",
	};
}

function draftArgs(draft: McpFormDraft): string[] {
	return draft.args
		.split("\n")
		.map((arg) => arg.trim())
		.filter(Boolean);
}

export function buildMcpEntry(draft: McpFormDraft): McpServerEntryInput {
	const values = Object.fromEntries(
		draft.values.map((row) => [row.name.trim(), row.value] as const),
	);
	const hasValues = Object.keys(values).length > 0;
	const args = draftArgs(draft);
	const description = draft.description.trim();
	return {
		...(draft.transport === "http"
			? { url: draft.url.trim(), ...(hasValues ? { headers: values } : {}) }
			: {
					command: draft.command.trim(),
					...(args.length > 0 ? { args } : {}),
					...(hasValues ? { env: values } : {}),
				}),
		exposure: draft.exposure,
		...(description ? { description } : {}),
	};
}

export function validateMcpDraft(
	t: Translator,
	draft: McpFormDraft,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
): McpFormIssues {
	const issues: McpFormIssues = {};
	const name = mcpNameIssue(t, draft.name.trim(), scope, existing);
	if (name) issues.name = name;
	if (draft.transport === "http") {
		const url = draft.url.trim();
		if (!url) issues.url = t("mcp.entries.urlRequired");
		else if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
			issues.url = t("mcp.entries.urlInvalid");
		} else {
			const credential = urlIssue(t, mcpUrlCredentials({ url }));
			if (credential) issues.url = credential;
		}
	} else if (!draft.command.trim()) {
		issues.command = t("mcp.entries.commandRequired");
	}
	const rows = draft.values;
	const http = draft.transport === "http";
	const names = rows.map((row) => row.name.trim());
	const plain = literalIssue(
		t,
		rows.filter((row) => !isConfigReference(row.value)).map((row) => `"${row.name.trim()}"`),
	);
	if (names.some((entry) => entry === "")) {
		issues.values = http
			? t("mcp.entries.headerNameRequired")
			: t("mcp.entries.variableNameRequired");
	} else if (new Set(names).size !== names.length) {
		issues.values = http
			? t("mcp.entries.headerNameDuplicate")
			: t("mcp.entries.variableNameDuplicate");
	} else if (plain) issues.values = plain;
	return issues;
}

export function mcpDraftWarnings(t: Translator, draft: McpFormDraft): string[] {
	const warnings: string[] = [];
	if (draft.transport === "stdio" && /\s/.test(draft.command.trim())) {
		warnings.push(t("mcp.entries.commandHasArguments"));
	}
	if (draft.transport === "http" && /\/sse\/?$/.test(draft.url.trim())) {
		warnings.push(t("mcp.entries.sseUrlUnsupported"));
	}
	return warnings;
}

interface McpImportServer {
	name: string;
	entry: McpServerEntryInput;
	errors: string[];
}

type McpImportResult = { ok: true; servers: McpImportServer[] } | { ok: false; error: string };

export function mcpEntryErrors(t: Translator, entry: unknown): string[] {
	if (!isRecord(entry)) return [t("mcp.entries.entryNotObject")];
	const errors: string[] = [];
	const type = entry.type;
	if (type === "sse") errors.push(t("mcp.entries.sseUnsupported"));
	else if (type !== undefined && (typeof type !== "string" || !TYPES.has(type))) {
		errors.push(t("mcp.entries.typeInvalid"));
	}
	const hasUrl = typeof entry.url === "string";
	if (hasUrl) {
		const url = entry.url as string;
		if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
			errors.push(t("mcp.entries.urlNotHttp"));
		}
	} else if (typeof entry.command !== "string" || entry.command === "") {
		errors.push(t("mcp.entries.commandOrUrlRequired"));
	}
	if (
		entry.args !== undefined &&
		!(Array.isArray(entry.args) && entry.args.every((arg) => typeof arg === "string"))
	) {
		errors.push(t("mcp.entries.argsInvalid"));
	}
	for (const key of ["env", "headers"] as const) {
		const value = entry[key];
		if (
			value !== undefined &&
			(!isRecord(value) || stringEntries(value).length !== Object.keys(value).length)
		) {
			errors.push(t("mcp.entries.mapInvalid", { key }));
		}
	}
	if (
		entry.exposure !== undefined &&
		!["codemode", "codemode-deferred", ...MCP_EXPOSURES].includes(String(entry.exposure))
	) {
		errors.push(t("mcp.entries.exposureInvalid"));
	}
	if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") {
		errors.push(t("mcp.entries.enabledInvalid"));
	}
	return errors;
}

export function parseMcpServersJson(t: Translator, text: string): McpImportResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			error: t("mcp.entries.invalidJson", {
				error: error instanceof Error ? error.message : String(error),
			}),
		};
	}
	if (!isRecord(parsed)) return { ok: false, error: t("mcp.entries.serversNotObject") };
	const map = "mcpServers" in parsed ? parsed.mcpServers : parsed;
	if (!isRecord(map)) return { ok: false, error: t("mcp.entries.mcpServersNotObject") };
	if (["command", "url", "type"].some((key) => key in map && !isRecord(map[key]))) {
		return { ok: false, error: t("mcp.entries.unnamedServer") };
	}
	const servers = Object.entries(map).map(([name, entry]) => ({
		name,
		entry: isRecord(entry) ? entry : {},
		errors: mcpEntryErrors(t, entry),
	}));
	if (servers.length === 0) return { ok: false, error: t("mcp.entries.noServers") };
	return { ok: true, servers };
}

export function importIssues(
	t: Translator,
	server: McpImportServer,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
	siblings: readonly string[],
): string[] {
	const name = mcpNameIssue(
		t,
		server.name,
		scope,
		existing,
		siblings.filter((sibling) => sibling !== server.name),
	);
	return [
		...(name ? [name] : []),
		...server.errors,
		...(scope === "project" && server.entry.auth !== undefined
			? [t("mcp.entries.authUserOnly")]
			: []),
		...mcpSecretIssues(t, server.entry),
	];
}

interface McpApprovalFacts {
	defines: "command" | "url" | null;
	runs: McpRunItem[];
	cwd?: string;
	env: McpValueFact[];
	headers: McpValueFact[];
	overrides: string[];
}

function valueFacts(map: unknown): McpValueFact[] {
	return isRecord(map)
		? Object.entries(map).map(([name, value]) => ({ name, value: shownValue(value) }))
		: [];
}

export function mcpApprovalFacts(entry: McpServerEntryInput): McpApprovalFacts {
	return {
		defines:
			typeof entry.url === "string" ? "url" : typeof entry.command === "string" ? "command" : null,
		runs: shellRuns(entry),
		...(typeof entry.cwd === "string" ? { cwd: entry.cwd } : {}),
		env: valueFacts(entry.env),
		headers: valueFacts(entry.headers),
		overrides: isOverrideEntry(entry)
			? Object.entries(hideMcpLiterals(entry))
					.filter(([key]) => key !== "env" && key !== "headers")
					.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			: [],
	};
}

export function mcpEndpointOf(entry: McpServerEntryInput): string {
	if (typeof entry.url === "string") return entry.url;
	const [first] = mcpRunList(entry);
	return first?.label === "command" ? first.text : "";
}

export function projectEntryFrom(content: string, name: string): McpServerEntryInput {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(t("mcp.entries.projectInvalidJson"));
	}
	const servers = isRecord(parsed) ? parsed.mcpServers : undefined;
	const entry = isRecord(servers) ? servers[name] : undefined;
	if (!isRecord(entry)) throw new Error(t("mcp.entries.projectMissingServer", { name }));
	return entry;
}

function isOverrideEntry(entry: McpServerEntryInput): boolean {
	return entry.command === undefined && entry.url === undefined && entry.type === undefined;
}

export function withEnabled(entry: McpServerEntryInput, enabled: boolean): McpServerEntryInput {
	const { enabled: _previous, ...rest } = entry;
	return enabled && !isOverrideEntry(entry) ? rest : { ...rest, enabled };
}

export function withExposure(
	entry: McpServerEntryInput,
	exposure: McpEditableExposure,
): McpServerEntryInput {
	return { ...entry, exposure };
}
