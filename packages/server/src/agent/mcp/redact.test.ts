import { describe, expect, test } from "bun:test";
import { maskMcpEndpoint, redactMcpText } from "./redact";

describe("redactMcpText", () => {
	test("masks Bearer and Basic credentials in any case", () => {
		expect(redactMcpText("Authorization: Bearer abc.def-123 rejected")).toBe(
			"Authorization: Bearer *** rejected",
		);
		expect(redactMcpText("authorization: basic dXNlcjpwYXNz")).toBe("authorization: basic ***");
		expect(redactMcpText("BEARER x")).toBe("BEARER ***");
	});

	test("masks credential-named key=value pairs and keeps the rest", () => {
		expect(
			redactMcpText(
				"token=abc api_key=k1 apikey=k2 password=hunter2 secret=s ACCESS_TOKEN=xyz --client-secret=c region=eu",
			),
		).toBe(
			"token=*** api_key=*** apikey=*** password=*** secret=*** ACCESS_TOKEN=*** --client-secret=*** region=eu",
		);
	});

	test("masks JSON-ish quoted pairs, single or double quoted, without touching nested objects", () => {
		expect(redactMcpText('{"api_key": "abc", "region": "eu"}')).toBe(
			'{"api_key": "***", "region": "eu"}',
		);
		expect(redactMcpText("{'password': 'hunter2', 'user': 'ada'}")).toBe(
			"{'password': '***', 'user': 'ada'}",
		);
		expect(redactMcpText('{"token":12345}')).toBe('{"token":***}');
		expect(redactMcpText('{"Secret": "a \\" b"}')).toBe('{"Secret": "***"}');
		expect(redactMcpText('"oauth": {"clientId": "x"}')).toBe('"oauth": {"clientId": "x"}');
	});

	test("masks URL user info and credential-named query values, and leaves other URLs exactly as written", () => {
		expect(redactMcpText("POST https://user:pw@api.example/mcp?token=abc&region=eu failed")).toBe(
			"POST https://***:***@api.example/mcp?token=***&region=eu failed",
		);
		expect(redactMcpText("connect postgresql://admin:s3cret@db.local/app")).toBe(
			"connect postgresql://***:***@db.local/app",
		);
		expect(redactMcpText("fetch https://example.com failed (see https://x.dev/docs).")).toBe(
			"fetch https://example.com failed (see https://x.dev/docs).",
		);
	});

	test("masks token-shaped literals and long hex or mixed-case runs", () => {
		for (const token of [
			"ghp_abcdefghijklmnop1234",
			"github_pat_11ABCDEFG0123456789_abcdef",
			"sk-proj-abcdefghijkl",
			"xoxb-1234-5678-abcdefgh",
			"glpat-abcdefghijklmnopqrst",
			"AKIAIOSFODNN7EXAMPLE",
			"0123456789abcdef0123456789abcdef",
			"Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZg==",
		]) {
			expect(redactMcpText(`stderr: ${token} rejected`)).toBe("stderr: *** rejected");
		}
		expect(
			redactMcpText(
				"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
			),
		).toBe("***.***.***");
	});

	test("keeps ordinary diagnostics: paths, package names, slugs and separators", () => {
		for (const text of [
			"spawn npx ENOENT",
			"docs: failed (deferred)\nConnection closed",
			"Cannot find module /Users/ada/.thinkrail/worktrees/thinkrail-copy/workspace-40/packages/server/src/agent/mcp/fixtures/stdioServer.ts",
			"npx -y @modelcontextprotocol/server-filesystem-extension",
			"branch research-mcp-hooks-2026-10-08-follow-up-work",
			"--------------------------------------------",
		]) {
			expect(redactMcpText(text)).toBe(text);
		}
	});

	test("is deterministic and idempotent", () => {
		const text =
			'failed: {"api_key":"sk-abcdefghijkl"} at https://u:p@h.example/x?session=1 Bearer zzz ghp_abcdefghijklmnop';
		const once = redactMcpText(text);
		expect(once).toBe(
			'failed: {"api_key":"***"} at https://***:***@h.example/x?session=*** Bearer *** ***',
		);
		expect(redactMcpText(once)).toBe(once);
	});
});

describe("maskMcpEndpoint", () => {
	test("masks credentials in URLs and arguments but keeps references and plain values", () => {
		expect(maskMcpEndpoint({ url: "https://user:pw@api.example/mcp?token=abc&region=eu" })).toBe(
			"https://***:***@api.example/mcp?token=***&region=eu",
		);
		expect(maskMcpEndpoint({ url: "https://example.com" })).toBe("https://example.com");
		expect(
			maskMcpEndpoint({
				command: "npx",
				args: [
					"-y",
					"server",
					"--api-key",
					"s3cr3t",
					"--token=xyz",
					"ghp_abcdefghijklmnop",
					`\${TOKEN}`,
					"API_KEY=k",
					"region=eu",
				],
			}),
		).toBe(`npx -y server --api-key *** --token=*** *** \${TOKEN} API_KEY=*** region=eu`);
	});

	test("masks URL-shaped arguments, including assignment values", () => {
		expect(
			maskMcpEndpoint({
				command: "npx",
				args: ["mcp-remote", "https://user:pw@host/mcp?token=abc", "--url=https://h/x?api_key=k"],
			}),
		).toBe("npx mcp-remote https://***:***@host/mcp?token=*** --url=https://h/x?api_key=***");
		expect(
			maskMcpEndpoint({
				command: "npx",
				args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://admin:pw@db/app"],
			}),
		).toBe("npx -y @modelcontextprotocol/server-postgres postgresql://***:***@db/app");
	});

	test("masks header arguments' values after -H / --header, and credential headers anywhere", () => {
		expect(
			maskMcpEndpoint({
				command: "npx",
				args: [
					"mcp-remote",
					"https://host/mcp",
					"--header",
					"Authorization: Bearer x",
					"-H",
					"X-Org: acme",
					"Authorization:Bearer x",
					"--header=X-Api-Key: k",
					"Content-Type:application/json",
				],
			}),
		).toBe(
			'npx mcp-remote https://host/mcp --header "Authorization: ***" -H "X-Org: ***" Authorization:*** "--header=X-Api-Key: ***" Content-Type:application/json',
		);
		expect(
			maskMcpEndpoint({
				command: "npx",
				args: ["mcp-remote", "https://host/mcp", "--header", `Authorization:\${AUTH_HEADER}`],
			}),
		).toBe(`npx mcp-remote https://host/mcp --header Authorization:\${AUTH_HEADER}`);
	});

	test("quotes arguments with spaces, quotes or nothing in them so the line is unambiguous", () => {
		expect(maskMcpEndpoint({ command: "bun", args: ["/tmp/a b/server.ts", "--flag", ""] })).toBe(
			'bun "/tmp/a b/server.ts" --flag ""',
		);
		expect(maskMcpEndpoint({ exposure: "direct" })).toBe("");
	});
});
