import type {
	McpExposure,
	McpServerEntryInput,
	McpServerScope,
	McpServerSummary,
} from "@thinkrail/contracts";

export type McpEditableExposure = Exclude<McpExposure, "codemode">;

export const MCP_EXPOSURES: readonly McpEditableExposure[] = ["deferred", "direct", "hidden"];

export const MCP_EXPOSURE_HINT: Readonly<Record<McpEditableExposure, string>> = {
	deferred: "Loaded through tool search when the model needs them.",
	direct: "Declared to the model up front, like a built-in tool.",
	hidden: "Registered but unreachable by the model.",
};

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_NAME_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*/;
const SECRET_NAME = /token|secret|passw(or)?d|api[-_]?key|auth|bearer|credential|session/i;
const TYPES = new Set(["stdio", "http", "streamable-http"]);
const REFERENCE_HINT = `Use \${NAME} to read it from the environment, or !command to read it from a command's output.`;

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

function joinLabels(labels: readonly string[]): string {
	return labels.length < 2
		? (labels[0] ?? "")
		: `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
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
			if (end >= 0 && ENV_NAME.test(value.slice(index + 2, end))) return true;
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

function literalIssue(labels: readonly string[]): string | undefined {
	if (labels.length === 0) return undefined;
	const verb = labels.length === 1 ? "is not a reference" : "are not references";
	return `${joinLabels(labels)} ${verb}. ${REFERENCE_HINT}`;
}

function urlIssue(labels: readonly string[]): string | undefined {
	return labels.length === 0
		? undefined
		: `The URL carries a credential (${labels.join(", ")}). pi sends the URL as written — pass the secret in a header instead, such as Authorization: Bearer \${TOKEN}.`;
}

function present(...issues: (string | undefined)[]): string[] {
	return issues.filter((issue): issue is string => issue !== undefined);
}

export function mcpSecretIssues(
	entry: McpServerEntryInput,
	written?: McpServerEntryInput,
): string[] {
	return present(
		literalIssue(mcpLiteralValues(entry, written)),
		urlIssue(mcpUrlCredentials(entry, written)),
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
			: `${joinLabels(unresolved)} still ${unresolved.length === 1 ? "shows" : "show"} ${MCP_HIDDEN_VALUE}, which keeps only a value the file already has under that name. ${REFERENCE_HINT}`;
	return {
		entry,
		issues: present(
			hidden,
			literalIssue(mcpLiteralValues(entry, written).filter((label) => !unresolved.includes(label))),
			urlIssue(mcpUrlCredentials(entry, written)),
		),
	};
}

export const SCOPE_LABEL: Readonly<Record<McpServerScope, string>> = {
	user: "User",
	project: "Project",
};

export function mcpNameIssue(
	name: string,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
	siblings: readonly string[] = [],
): string | undefined {
	if (!name) return "Name the server.";
	if (!SERVER_NAME.test(name)) return "Use letters, digits, - and _ only.";
	if (existing.some((server) => server.scope === scope && server.name === name)) {
		return `"${name}" already exists in ${scope === "user" ? "your user servers" : "this project"}.`;
	}
	const twin = [...existing.map((server) => server.name), ...siblings].find(
		(other) => other !== name && namespaceOf(other) === namespaceOf(name),
	);
	return twin
		? `Clashes with "${twin}" — names that differ only in - and _ share tools.`
		: undefined;
}

export function mcpNameWarning(
	name: string,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
): string | undefined {
	const other = existing.find((server) => server.name === name && server.scope !== scope);
	if (!other) return undefined;
	return scope === "project"
		? `Replaces your user-level "${name}" in this project.`
		: `This project's own "${name}" takes precedence here.`;
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

function draftValues(draft: McpFormDraft): McpValueRow[] {
	return draft.values.filter((row) => row.name.trim() !== "" || row.value !== "");
}

export function buildMcpEntry(draft: McpFormDraft): McpServerEntryInput {
	const values = Object.fromEntries(
		draftValues(draft).map((row) => [row.name.trim(), row.value] as const),
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
	draft: McpFormDraft,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
): McpFormIssues {
	const issues: McpFormIssues = {};
	const name = mcpNameIssue(draft.name.trim(), scope, existing);
	if (name) issues.name = name;
	if (draft.transport === "http") {
		const url = draft.url.trim();
		if (!url) issues.url = "Enter the server URL.";
		else if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
			issues.url = "Use an http:// or https:// URL.";
		} else {
			const credential = urlIssue(mcpUrlCredentials({ url }));
			if (credential) issues.url = credential;
		}
	} else if (!draft.command.trim()) {
		issues.command = "Enter the executable to run.";
	}
	const rows = draftValues(draft);
	const kind = draft.transport === "http" ? "header" : "variable";
	const names = rows.map((row) => row.name.trim());
	const plain = literalIssue(
		rows.filter((row) => !isConfigReference(row.value)).map((row) => `"${row.name.trim()}"`),
	);
	if (names.some((entry) => entry === "")) issues.values = `Name every ${kind}.`;
	else if (new Set(names).size !== names.length) issues.values = `Each ${kind} name appears once.`;
	else if (plain) issues.values = plain;
	return issues;
}

export function mcpDraftWarnings(draft: McpFormDraft): string[] {
	const warnings: string[] = [];
	if (draft.transport === "stdio" && /\s/.test(draft.command.trim())) {
		warnings.push("The command is one executable — put each argument on its own line below.");
	}
	if (draft.transport === "http" && /\/sse\/?$/.test(draft.url.trim())) {
		warnings.push("SSE is not supported — use the server's streamable HTTP URL (often /mcp).");
	}
	return warnings;
}

interface McpImportServer {
	name: string;
	entry: McpServerEntryInput;
	errors: string[];
}

type McpImportResult = { ok: true; servers: McpImportServer[] } | { ok: false; error: string };

export function mcpEntryErrors(entry: unknown): string[] {
	if (!isRecord(entry)) return ["The entry must be an object."];
	const errors: string[] = [];
	const type = entry.type;
	if (type === "sse") errors.push("SSE is not supported — use the streamable HTTP URL.");
	else if (type !== undefined && (typeof type !== "string" || !TYPES.has(type))) {
		errors.push('"type" must be stdio, http or streamable-http.');
	}
	const hasUrl = typeof entry.url === "string";
	if (hasUrl) {
		const url = entry.url as string;
		if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
			errors.push('"url" must be an http or https URL.');
		}
	} else if (typeof entry.command !== "string" || entry.command === "") {
		errors.push('Needs "command" (stdio) or "url" (HTTP).');
	}
	if (
		entry.args !== undefined &&
		!(Array.isArray(entry.args) && entry.args.every((arg) => typeof arg === "string"))
	) {
		errors.push('"args" must be a list of strings.');
	}
	for (const key of ["env", "headers"] as const) {
		const value = entry[key];
		if (
			value !== undefined &&
			(!isRecord(value) || stringEntries(value).length !== Object.keys(value).length)
		) {
			errors.push(`"${key}" must map names to strings.`);
		}
	}
	if (
		entry.exposure !== undefined &&
		!["codemode", "codemode-deferred", ...MCP_EXPOSURES].includes(String(entry.exposure))
	) {
		errors.push('"exposure" must be deferred, direct or hidden.');
	}
	if (entry.enabled !== undefined && typeof entry.enabled !== "boolean") {
		errors.push('"enabled" must be true or false.');
	}
	return errors;
}

export function parseMcpServersJson(text: string): McpImportResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!isRecord(parsed)) return { ok: false, error: "Paste a JSON object of servers." };
	const map = "mcpServers" in parsed ? parsed.mcpServers : parsed;
	if (!isRecord(map)) return { ok: false, error: '"mcpServers" must be an object.' };
	if (["command", "url", "type"].some((key) => key in map && !isRecord(map[key]))) {
		return {
			ok: false,
			error: 'This looks like one server\'s settings — name it: { "docs": { … } }.',
		};
	}
	const servers = Object.entries(map).map(([name, entry]) => ({
		name,
		entry: isRecord(entry) ? entry : {},
		errors: mcpEntryErrors(entry),
	}));
	if (servers.length === 0) return { ok: false, error: "No servers found." };
	return { ok: true, servers };
}

export function importIssues(
	server: McpImportServer,
	scope: McpServerScope,
	existing: readonly Pick<McpServerSummary, "name" | "scope">[],
	siblings: readonly string[],
): string[] {
	const name = mcpNameIssue(
		server.name,
		scope,
		existing,
		siblings.filter((sibling) => sibling !== server.name),
	);
	return [
		...(name ? [name] : []),
		...server.errors,
		...(scope === "project" && server.entry.auth !== undefined
			? ['"auth" is only allowed in your user servers.']
			: []),
		...mcpSecretIssues(server.entry),
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
		throw new Error("The project's .pi/mcp.json is not valid JSON.");
	}
	const servers = isRecord(parsed) ? parsed.mcpServers : undefined;
	const entry = isRecord(servers) ? servers[name] : undefined;
	if (!isRecord(entry)) throw new Error(`The project's .pi/mcp.json no longer defines "${name}".`);
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
