import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WsErrorCode } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { validateMcpServerConfig, validateMcpServerConfigResult } from "./config";
import { writeMcpServerEntry } from "./management";
import {
	addMcpServerConfig,
	assertProjectMcpConfigWritable,
	updateMcpServerConfig,
} from "./writers";

const root = mkdtempSync(join(tmpdir(), "mcp-validation-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const http = { url: "https://example.test/mcp" };
const stdio = { command: "unused-test-server" };
const cases: [Record<string, unknown>, WsErrorCode, Record<string, string>][] = [
	[{ ...http, exposure: "invalid" }, "MCP_FIELD_EXPOSURE_INVALID", { field: "exposure" }],
	[{ ...http, toolExposure: [] }, "MCP_TOOL_EXPOSURE_MAP_REQUIRED", {}],
	[{ ...http, toolExposure: { read: "invalid" } }, "MCP_TOOL_EXPOSURE_INVALID", { tool: "read" }],
	[{ ...http, enabled: 0 }, "MCP_FIELD_BOOLEAN_REQUIRED", { field: "enabled" }],
	[{ ...http, description: false }, "MCP_FIELD_STRING_REQUIRED", { field: "description" }],
	[{ ...http, timeout: 0 }, "MCP_FIELD_POSITIVE_SECONDS_REQUIRED", { field: "timeout" }],
	[{ ...http, type: "sse" }, "MCP_SSE_UNSUPPORTED", {}],
	[{ url: "ftp://example.test" }, "MCP_FIELD_HTTP_URL_REQUIRED", { field: "url" }],
	[
		{ ...http, headers: { Authorization: 1 } },
		"MCP_FIELD_STRING_MAP_REQUIRED",
		{ field: "headers" },
	],
	[{ ...http, oauth: [] }, "MCP_FIELD_OBJECT_REQUIRED", { field: "oauth" }],
	[{ ...http, oauth: { clientId: 1 } }, "MCP_FIELD_STRING_REQUIRED", { field: "oauth.clientId" }],
	[
		{ ...http, oauth: { clientSecret: 1 } },
		"MCP_FIELD_STRING_REQUIRED",
		{ field: "oauth.clientSecret" },
	],
	[
		{ ...http, oauth: { callbackPort: 65536 } },
		"MCP_FIELD_PORT_REQUIRED",
		{ field: "oauth.callbackPort" },
	],
	[
		{ ...http, oauth: { callbackUrl: "https://localhost/callback" } },
		"MCP_FIELD_LOOPBACK_URI_REQUIRED",
		{ field: "oauth.callbackUrl" },
	],
	[
		{ ...http, oauth: { callbackUrl: "http://localhost:1234/callback", callbackPort: 2345 } },
		"MCP_OAUTH_PORT_MISMATCH",
		{},
	],
	[{ ...http, oauth: { scope: 1 } }, "MCP_FIELD_STRING_REQUIRED", { field: "oauth.scope" }],
	[
		{ ...http, oauth: { clientName: " " } },
		"MCP_FIELD_NONEMPTY_STRING_REQUIRED",
		{ field: "oauth.clientName" },
	],
	[{ ...http, oauth: { clientRegistration: "invalid" } }, "MCP_OAUTH_REGISTRATION_INVALID", {}],
	[
		{ ...http, oauth: { clientRegistration: "cimd", clientId: "literal" } },
		"MCP_OAUTH_CIMD_CONFLICT",
		{},
	],
	[
		{ ...http, oauth: { clientRegistration: "cimd", callbackUrl: "http://localhost/wrong" } },
		"MCP_OAUTH_CIMD_CALLBACK_INVALID",
		{},
	],
	[
		{ ...http, oauth: { authServerMetadataUrl: "http://example.test" } },
		"MCP_FIELD_SECURE_URL_REQUIRED",
		{ field: "oauth.authServerMetadataUrl" },
	],
	[{ ...http, auth: {} }, "MCP_AUTH_PROVIDER_REQUIRED", {}],
	[
		{ url: "http://example.test", auth: { provider: "literal" } },
		"MCP_AUTH_SECURE_URL_REQUIRED",
		{},
	],
	[{ ...stdio, args: [1] }, "MCP_FIELD_STRING_ARRAY_REQUIRED", { field: "args" }],
	[{ ...stdio, env: { TOKEN: 1 } }, "MCP_FIELD_STRING_MAP_REQUIRED", { field: "env" }],
	[{ ...stdio, cwd: 1 }, "MCP_FIELD_STRING_REQUIRED", { field: "cwd" }],
	[{}, "MCP_TRANSPORT_REQUIRED", {}],
];

for (const [entry, code, params] of cases) {
	test(`structured validation: ${code} ${JSON.stringify(params)}`, () => {
		const result = validateMcpServerConfigResult("literal-server", entry);
		expect(result).toBeInstanceOf(CodedError);
		if (!(result instanceof CodedError)) throw new Error("Expected validation failure");
		expect(result.code).toBe(code);
		expect(result.errorParams).toEqual({ name: "literal-server", ...params });
		expect(validateMcpServerConfig("literal-server", entry)).toBe(result.message);
		expect(
			thrown(() =>
				writeMcpServerEntry({
					scope: "project",
					worktree: root,
					name: "literal-server",
					entry,
					mode: "add",
				}),
			),
		).toMatchObject({
			code,
			message: result.message,
			errorParams: { name: "literal-server", ...params },
		});
	});
}

test("invalid names and non-object entries keep distinct structured reasons", () => {
	expect(validateMcpServerConfigResult("bad name", stdio)).toMatchObject({
		code: "MCP_CONFIG_NAME_INVALID",
		errorParams: { name: "bad name" },
		message: 'invalid server name "bad name" (use letters, digits, "_" and "-")',
	});
	expect(validateMcpServerConfigResult("literal-server", null)).toMatchObject({
		code: "MCP_ENTRY_OBJECT_REQUIRED",
		errorParams: { name: "literal-server" },
		message: 'server "literal-server" must be an object',
	});
});

function thrown(run: () => void): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("Expected failure");
}

test("management failures carry name and path without changing English", () => {
	const worktree = join(root, "management");
	const options = {
		scope: "project",
		worktree,
		name: "literal-server",
		entry: stdio,
		mode: "add",
	} as const;
	expect(
		thrown(() =>
			writeMcpServerEntry({ ...options, entry: { ...http, auth: { provider: "literal" } } }),
		),
	).toMatchObject({
		code: "MCP_PROJECT_AUTH_FORBIDDEN",
		errorParams: { name: options.name },
	});
	writeMcpServerEntry(options);
	expect(thrown(() => writeMcpServerEntry(options))).toMatchObject({
		code: "MCP_SERVER_EXISTS",
		errorParams: { name: options.name },
		message: 'An MCP server named "literal-server" already exists',
	});
	expect(
		thrown(() => writeMcpServerEntry({ ...options, name: "missing", mode: "update" })),
	).toMatchObject({
		code: "MCP_SERVER_NOT_FOUND_IN_FILE",
		errorParams: { name: "missing", path: join(worktree, ".pi", "mcp.json") },
	});
});

test("each unsafe path reason carries its literal path", () => {
	const worktree = join(root, "paths");
	mkdirSync(worktree);
	const directory = join(worktree, ".pi");
	const path = join(directory, "mcp.json");
	const outside = join(root, "outside.json");
	expect(thrown(() => assertProjectMcpConfigWritable(worktree, outside))).toMatchObject({
		code: "MCP_PATH_OUTSIDE_WORKTREE",
		errorParams: { path: outside },
	});
	writeFileSync(directory, "not a directory");
	expect(thrown(() => assertProjectMcpConfigWritable(worktree, path))).toMatchObject({
		code: "MCP_PATH_DIRECTORY_UNSAFE",
		errorParams: { directory: ".pi", path: directory },
	});
	rmSync(directory);
	mkdirSync(path, { recursive: true });
	expect(thrown(() => assertProjectMcpConfigWritable(worktree, path))).toMatchObject({
		code: "MCP_PATH_FILE_UNSAFE",
		errorParams: { path },
	});
});

test("writer-owned shape errors are coded; JSON parser errors remain external", () => {
	const path = join(root, "writer.json");
	writeFileSync(path, "[]");
	expect(thrown(() => addMcpServerConfig(path, "docs", stdio))).toMatchObject({
		code: "MCP_FILE_OBJECT_REQUIRED",
		errorParams: { path },
	});
	writeFileSync(path, "{}");
	expect(thrown(() => updateMcpServerConfig(path, "docs", { enabled: false }))).toMatchObject({
		code: "MCP_FILE_SERVER_MISSING",
		errorParams: { path, name: "docs" },
	});
	writeFileSync(path, "{ malformed");
	const error = thrown(() => addMcpServerConfig(path, "docs", stdio));
	expect(error).toBeInstanceOf(SyntaxError);
	expect(error).not.toBeInstanceOf(CodedError);
});
