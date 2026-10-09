import { expect, test } from "bun:test";
import type { McpServerSummary } from "@thinkrail/contracts";
import {
	buildMcpEntry,
	emptyMcpDraft,
	formatCommandLine,
	hideMcpLiterals,
	importIssues,
	isConfigReference,
	MCP_HIDDEN_VALUE,
	type McpFormDraft,
	mcpApprovalFacts,
	mcpDraftWarnings,
	mcpEditedEntry,
	mcpEntryErrors,
	mcpLiteralValues,
	mcpNameIssue,
	mcpNameWarning,
	mcpRunList,
	mcpSecretIssues,
	mcpUrlCredentials,
	needsMcpReview,
	parseMcpServersJson,
	projectEntryFrom,
	reviewMcpServer,
	validateMcpDraft,
	withEnabled,
	withExposure,
} from "./mcpEntries";

const HINT = `Use \${NAME} to read it from the environment, or !command to read it from a command's output.`;

const existing: Pick<McpServerSummary, "name" | "scope">[] = [
	{ name: "linear", scope: "user" },
	{ name: "repo_tools", scope: "project" },
];

function draft(overrides: Partial<McpFormDraft>): McpFormDraft {
	return { ...emptyMcpDraft(), ...overrides };
}

test(`config references follow pi's grammar: \${VAR}, $VAR and !command, with $$ and $! escapes`, () => {
	expect(isConfigReference(`\${GITHUB_TOKEN}`)).toBe(true);
	expect(isConfigReference(`Bearer \${TOKEN}`)).toBe(true);
	expect(isConfigReference("$TOKEN")).toBe(true);
	expect(isConfigReference("!gh auth token")).toBe(true);
	expect(isConfigReference("ghp_abcdefgh12345678")).toBe(false);
	expect(isConfigReference("price$$5")).toBe(false);
	expect(isConfigReference("$!literal")).toBe(false);
	expect(isConfigReference(`\${not a name}`)).toBe(false);
	expect(isConfigReference("cost $5")).toBe(false);
	expect(isConfigReference("")).toBe(false);
});

test("literal values are found in env, headers, oauth secrets and URL credentials", () => {
	expect(
		mcpLiteralValues({
			command: "x",
			env: { API_KEY: "sk-live-123", REF: `\${REF}`, RUN: "!pass show x", EMPTY: "" },
		}),
	).toEqual(["env API_KEY"]);
	const remote = {
		url: "https://u:p@example.com/mcp?token=abc&page=2",
		headers: { Authorization: "Bearer abc", "X-Ref": `Bearer \${T}` },
		oauth: { clientSecret: "secret" },
	};
	expect(mcpLiteralValues(remote)).toEqual(["header Authorization", "oauth clientSecret"]);
	expect(mcpUrlCredentials(remote)).toEqual(["user info", 'query "token"']);
	expect(mcpSecretIssues(remote)).toEqual([
		`header Authorization and oauth clientSecret are not references. ${HINT}`,
		`The URL carries a credential (user info, query "token"). pi sends the URL as written — pass the secret in a header instead, such as Authorization: Bearer \${TOKEN}.`,
	]);
	expect(mcpSecretIssues({ command: "x", env: { A: `\${A}`, B: "!op read b" } })).toEqual([]);
});

test("values already written are not new literals; changed or added ones are", () => {
	const written = {
		url: "https://example.com/mcp?token=abc",
		headers: { Authorization: "Bearer abc" },
	};
	expect(mcpSecretIssues(written, written)).toEqual([]);
	expect(
		mcpLiteralValues({ ...written, headers: { Authorization: "Bearer xyz" } }, written),
	).toEqual(["header Authorization"]);
	expect(
		mcpLiteralValues({ ...written, headers: { ...written.headers, "X-Key": "k" } }, written),
	).toEqual(["header X-Key"]);
	expect(mcpUrlCredentials({ url: "https://other.example/mcp?token=abc" }, written)).toEqual([]);
	expect(mcpUrlCredentials({ url: "https://example.com/mcp?token=new" }, written)).toEqual([
		'query "token"',
	]);
});

test("the run list names every host command line and every !command value", () => {
	expect(formatCommandLine("bun", ["/tmp/a b/server.ts", "--flag", ""])).toBe(
		'bun "/tmp/a b/server.ts" --flag ""',
	);
	expect(
		mcpRunList({
			command: "npx",
			args: ["-y", "@scope/server"],
			env: { TOKEN: "!gh auth token", PLAIN: `\${X}` },
		}),
	).toEqual([
		{ label: "command", text: "npx -y @scope/server" },
		{ label: "env TOKEN", text: "gh auth token" },
	]);
	expect(
		mcpRunList({
			url: "https://example.com/mcp",
			headers: { Authorization: "!echo Bearer $(op read x)" },
			oauth: { clientSecret: "!pass show client" },
		}),
	).toEqual([
		{ label: "header Authorization", text: "echo Bearer $(op read x)" },
		{ label: "oauth clientSecret", text: "pass show client" },
	]);
	const quiet = reviewMcpServer("docs", { url: "https://example.com/mcp" });
	expect(quiet).toEqual({ name: "docs", runs: [] });
	expect(needsMcpReview([quiet])).toBe(false);
	expect(needsMcpReview([quiet, reviewMcpServer("cmd", { command: "x" })])).toBe(true);
});

test("names follow pi's charset, are unique per file, and never twin another name across - and _", () => {
	expect(mcpNameIssue("", "user", existing)).toBe("Name the server.");
	expect(mcpNameIssue("bad name", "user", existing)).toBe("Use letters, digits, - and _ only.");
	expect(mcpNameIssue("linear", "user", existing)).toContain("already exists");
	expect(mcpNameIssue("linear", "project", existing)).toBeUndefined();
	expect(mcpNameIssue("repo-tools", "user", existing)).toContain('Clashes with "repo_tools"');
	expect(mcpNameIssue("a-b", "user", [], ["a_b"])).toContain('Clashes with "a_b"');
	expect(mcpNameWarning("linear", "project", existing)).toContain("Replaces your user-level");
	expect(mcpNameWarning("repo_tools", "user", existing)).toContain("takes precedence");
	expect(mcpNameWarning("fresh", "user", existing)).toBeUndefined();
});

test("the form validates transport fields and value names, and builds the entry without empty rows", () => {
	expect(validateMcpDraft(draft({ name: "docs", transport: "http" }), "user", [])).toEqual({
		url: "Enter the server URL.",
	});
	expect(
		validateMcpDraft(draft({ name: "docs", transport: "http", url: "ftp://x" }), "user", []).url,
	).toBe("Use an http:// or https:// URL.");
	expect(validateMcpDraft(draft({ name: "docs" }), "user", []).command).toBe(
		"Enter the executable to run.",
	);
	expect(
		validateMcpDraft(
			draft({
				name: "docs",
				command: "bun",
				values: [
					{ id: "1", name: "", value: "x" },
					{ id: "2", name: "", value: "" },
				],
			}),
			"user",
			[],
		).values,
	).toBe("Name every variable.");
	expect(
		validateMcpDraft(
			draft({
				name: "docs",
				transport: "http",
				url: "https://x/mcp",
				values: [
					{ id: "1", name: "A", value: "1" },
					{ id: "2", name: "A", value: "2" },
				],
			}),
			"user",
			[],
		).values,
	).toBe("Each header name appears once.");
	expect(
		buildMcpEntry(
			draft({
				name: "fixture",
				command: " /usr/bin/bun ",
				args: "/abs/stdioServer.ts\n\n  --verbose  \n",
				values: [
					{ id: "1", name: "TOKEN", value: `\${TOKEN}` },
					{ id: "2", name: "", value: "" },
				],
				exposure: "direct",
				description: "  Fixture  ",
			}),
		),
	).toEqual({
		command: "/usr/bin/bun",
		args: ["/abs/stdioServer.ts", "--verbose"],
		env: { TOKEN: `\${TOKEN}` },
		exposure: "direct",
		description: "Fixture",
	});
	expect(
		buildMcpEntry(draft({ transport: "http", url: "https://x/mcp", command: "ignored" })),
	).toEqual({ url: "https://x/mcp", exposure: "deferred" });
	expect(
		validateMcpDraft(
			draft({
				name: "docs",
				transport: "http",
				url: "https://x/mcp",
				values: [
					{ id: "1", name: "Authorization", value: `Bearer \${TOKEN}` },
					{ id: "2", name: "X-Key", value: "!op read x" },
					{ id: "3", name: "X-Ref", value: "$REF" },
				],
			}),
			"user",
			[],
		),
	).toEqual({});
	expect(mcpDraftWarnings(draft({ command: "npx -y foo" }))).toHaveLength(1);
	expect(mcpDraftWarnings(draft({ transport: "http", url: "https://x/sse" }))).toEqual([
		"SSE is not supported — use the server's streamable HTTP URL (often /mcp).",
	]);
});

test("the form saves references only: a plain or empty value, or a credential in the URL, blocks it", () => {
	const values = (rows: [string, string][]) =>
		rows.map(([name, value], index) => ({ id: String(index), name, value }));
	expect(
		validateMcpDraft(
			draft({ name: "docs", command: "bun", values: values([["API_KEY", "sk-live-123"]]) }),
			"user",
			[],
		).values,
	).toBe(`"API_KEY" is not a reference. ${HINT}`);
	expect(
		validateMcpDraft(
			draft({
				name: "docs",
				command: "bun",
				values: values([
					["API_KEY", "sk-live-123"],
					["EMPTY", ""],
					["MODE", "prod"],
					["TOKEN", `\${TOKEN}`],
				]),
			}),
			"user",
			[],
		).values,
	).toBe(`"API_KEY", "EMPTY" and "MODE" are not references. ${HINT}`);
	expect(
		validateMcpDraft(
			draft({ name: "docs", transport: "http", url: "https://ada:pw@x.example/mcp?api_key=k" }),
			"user",
			[],
		).url,
	).toBe(
		`The URL carries a credential (user info, query "api_key"). pi sends the URL as written — pass the secret in a header instead, such as Authorization: Bearer \${TOKEN}.`,
	);
});

test("pasted JSON accepts the mcpServers wrapper or a bare map and reports per-server problems", () => {
	const wrapped = parseMcpServersJson(
		JSON.stringify({ mcpServers: { a: { command: "x" }, b: { url: "https://b/mcp" } } }),
	);
	expect(wrapped.ok && wrapped.servers.map((server) => [server.name, server.errors])).toEqual([
		["a", []],
		["b", []],
	]);
	const bare = parseMcpServersJson('{ "sse": { "type": "sse", "url": "https://s/sse" } }');
	expect(bare.ok && bare.servers[0]?.errors).toEqual([
		"SSE is not supported — use the streamable HTTP URL.",
	]);
	expect(parseMcpServersJson("{")).toMatchObject({ ok: false });
	expect(parseMcpServersJson("[]")).toEqual({
		ok: false,
		error: "Paste a JSON object of servers.",
	});
	expect(parseMcpServersJson("{}")).toEqual({ ok: false, error: "No servers found." });
	expect(parseMcpServersJson('{ "command": "npx", "args": [] }')).toMatchObject({
		ok: false,
		error: expect.stringContaining("one server's settings"),
	});
	expect(parseMcpServersJson('{ "mcpServers": [] }')).toEqual({
		ok: false,
		error: '"mcpServers" must be an object.',
	});
	expect(
		mcpEntryErrors({ command: "x", args: "nope", env: { A: 1 }, exposure: "loud", enabled: "y" }),
	).toEqual([
		'"args" must be a list of strings.',
		'"env" must map names to strings.',
		'"exposure" must be deferred, direct or hidden.',
		'"enabled" must be true or false.',
	]);
	expect(mcpEntryErrors({ type: "http" })).toEqual(['Needs "command" (stdio) or "url" (HTTP).']);
	expect(mcpEntryErrors({ url: "file:///x" })).toEqual(['"url" must be an http or https URL.']);
	expect(mcpEntryErrors({ command: "x", headers: "h" })).toEqual([
		'"headers" must map names to strings.',
	]);
	expect(mcpEntryErrors({ command: "x", exposure: "codemode-deferred" })).toEqual([]);
});

test("import issues add name rules for the chosen scope and the project-file auth ban", () => {
	const server = {
		name: "linear",
		entry: { url: "https://l/mcp", auth: { provider: "x" } },
		errors: [],
	};
	expect(importIssues(server, "user", existing, ["linear"])).toEqual([
		'"linear" already exists in your user servers.',
	]);
	expect(importIssues(server, "project", existing, ["linear"])).toEqual([
		'"auth" is only allowed in your user servers.',
	]);
	expect(
		importIssues({ name: "a-b", entry: { command: "x" }, errors: [] }, "user", [], ["a-b", "a_b"]),
	).toEqual(['Clashes with "a_b" — names that differ only in - and _ share tools.']);
	expect(
		importIssues(
			{
				name: "gh",
				entry: { command: "npx", env: { GITHUB_TOKEN: "ghp_abc", HOME_DIR: `\${HOME}` } },
				errors: [],
			},
			"user",
			[],
			["gh"],
		),
	).toEqual([`env GITHUB_TOKEN is not a reference. ${HINT}`]);
});

test("dialogs show plain values hidden; an untouched marker keeps the written value, anything new must be a reference", () => {
	const written = {
		command: "node",
		env: { API_KEY: "sk-live-123", REF: `\${REF}`, EMPTY: "" },
		headers: { Authorization: "!echo Bearer x" },
		oauth: { clientId: "c", clientSecret: "s3cret" },
	};
	const shown = hideMcpLiterals(written);
	expect(shown).toEqual({
		command: "node",
		env: { API_KEY: MCP_HIDDEN_VALUE, REF: `\${REF}`, EMPTY: "" },
		headers: { Authorization: "!echo Bearer x" },
		oauth: { clientId: "c", clientSecret: MCP_HIDDEN_VALUE },
	});
	expect(Object.keys(shown)).toEqual(Object.keys(written));
	expect(mcpEditedEntry({ ...shown, exposure: "direct" }, written)).toEqual({
		entry: { ...written, exposure: "direct" },
		issues: [],
	});
	const moved = mcpEditedEntry(
		{ ...shown, env: { API_TOKEN: MCP_HIDDEN_VALUE, REF: `Bearer ${MCP_HIDDEN_VALUE}` } },
		written,
	);
	expect(moved.issues).toEqual([
		`env API_TOKEN and env REF still show ${MCP_HIDDEN_VALUE}, which keeps only a value the file already has under that name. ${HINT}`,
	]);
	expect(mcpEditedEntry({ ...shown, env: { ...shown.env, MODE: "prod" } }, written).issues).toEqual(
		[`env MODE is not a reference. ${HINT}`],
	);
	expect(
		mcpEditedEntry({ ...shown, env: { ...shown.env, API_KEY: `\${API_KEY}` } }, written),
	).toEqual({
		entry: { ...written, env: { ...written.env, API_KEY: `\${API_KEY}` } },
		issues: [],
	});
});

test("project entries are read as written and toggled with pi's writer semantics", () => {
	const content = JSON.stringify({
		mcpServers: { repo: { command: "x", enabled: false }, linear: { enabled: false } },
	});
	expect(projectEntryFrom(content, "repo")).toEqual({ command: "x", enabled: false });
	expect(() => projectEntryFrom(content, "gone")).toThrow('no longer defines "gone"');
	expect(() => projectEntryFrom("{", "repo")).toThrow("not valid JSON");
	expect(withEnabled({ command: "x", enabled: false }, true)).toEqual({ command: "x" });
	expect(withEnabled({ command: "x" }, false)).toEqual({ command: "x", enabled: false });
	expect(withEnabled({ enabled: false }, true)).toEqual({ enabled: true });
	expect(withExposure({ command: "x", exposure: "codemode" }, "direct")).toEqual({
		command: "x",
		exposure: "direct",
	});
});

test("approval facts list every !command, and env/header names with references but never a plain value", () => {
	expect(
		mcpApprovalFacts({
			command: "node",
			args: ["server.js", "--api-key", "s3cr3t"],
			cwd: "tools",
			env: { TOKEN: "!vault read token", MODE: "prod", HOME_DIR: `\${HOME}` },
		}),
	).toEqual({
		defines: "command",
		runs: [{ label: "env TOKEN", text: "vault read token" }],
		cwd: "tools",
		env: [
			{ name: "TOKEN", value: "!vault read token" },
			{ name: "MODE", value: MCP_HIDDEN_VALUE },
			{ name: "HOME_DIR", value: `\${HOME}` },
		],
		headers: [],
		overrides: [],
	});
	expect(
		mcpApprovalFacts({
			url: "https://x/mcp",
			headers: { Authorization: `Bearer \${T}`, "X-Key": "plain" },
		}),
	).toMatchObject({
		defines: "url",
		headers: [
			{ name: "Authorization", value: `Bearer \${T}` },
			{ name: "X-Key", value: MCP_HIDDEN_VALUE },
		],
		runs: [],
	});
	expect(mcpApprovalFacts({ enabled: false, exposure: "direct", env: { K: "v" } })).toMatchObject({
		defines: null,
		overrides: ["enabled: false", 'exposure: "direct"'],
		env: [{ name: "K", value: MCP_HIDDEN_VALUE }],
	});
});
