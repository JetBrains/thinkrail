import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintMcpEntry } from "./config";
import { summarizeMcpConfigErrors, summarizeMcpServers } from "./summaries";

const root = mkdtempSync(join(tmpdir(), "mcp-summaries-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("summaries cover scope, approval states, replacement, folded overrides, record overrides and errors", () => {
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	const repo = {
		command: "npx",
		args: ["-y", "repo-server", "--header", "Authorization: Bearer abc"],
	};
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				docs: { url: "https://docs.example/mcp", headers: { Authorization: `Bearer \${DOCS}` } },
				linear: { url: "https://linear.example/mcp" },
				shared: { url: "https://shared.example/mcp" },
			},
		}),
	);
	writeFileSync(
		join(cwd, ".pi", "mcp.json"),
		JSON.stringify({
			mcpServers: {
				repo,
				shared: { command: "node", args: ["local.js"] },
				linear: { exposure: "direct" },
				broken: { url: "ftp://nope" },
			},
		}),
	);
	const byName = (approvals: Record<string, string>) =>
		Object.fromEntries(
			summarizeMcpServers({
				agentDir,
				cwd,
				projectTrusted: true,
				policy: { approvals, overrides: { docs: { enabled: false, exposure: "hidden" } } },
			}).map((summary) => [`${summary.scope}:${summary.name}`, summary]),
		);

	const pending = byName({});
	expect(Object.keys(pending).sort()).toEqual([
		"project:broken",
		"project:repo",
		"project:shared",
		"user:docs",
		"user:linear",
		"user:shared",
	]);
	expect(pending["user:docs"]).toMatchObject({
		transport: "http",
		oauth: false,
		enabled: false,
		effectiveExposure: "hidden",
		projectOverride: { enabled: false, exposure: "hidden" },
	});
	expect(pending["user:linear"]).toMatchObject({
		oauth: true,
		effectiveExposure: "deferred",
		approval: { state: "pending" },
	});
	expect(pending["project:repo"]).toMatchObject({
		transport: "stdio",
		endpoint: 'npx -y repo-server --header "Authorization: ***"',
		approval: { state: "pending", fingerprint: fingerprintMcpEntry("repo", repo) },
	});
	expect(pending["project:shared"]?.replacesGlobal).toBe(true);
	expect(pending["project:broken"]?.configError).toBeDefined();

	const approved = byName({
		repo: fingerprintMcpEntry("repo", repo),
		linear: fingerprintMcpEntry("linear", { exposure: "direct" }),
		shared: "stale-fingerprint",
	});
	expect(approved["project:repo"]?.approval?.state).toBe("approved");
	expect(approved["user:linear"]).toMatchObject({
		effectiveExposure: "direct",
		approval: { state: "approved" },
	});
	expect(approved["project:shared"]?.approval?.state).toBe("changed");
});

test("an entry that is not an object keeps its row, and an unreadable file is listed with its path, masked", () => {
	const agentDir = join(root, "odd-agent");
	const cwd = join(root, "odd-project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { bad: null, docs: { url: "https://docs.example/mcp" } } }),
	);
	writeFileSync(
		join(cwd, ".pi", "mcp.json"),
		'{ "mcpServers": { "gh": { "url": "https://gh.example/mcp", "headers": { "Authorization": ghp_abcdefghijklmnopqrstuvwx1234 } } } }',
	);
	const files = { agentDir, cwd, projectTrusted: true };
	const summaries = summarizeMcpServers({ ...files, policy: { approvals: {}, overrides: {} } });
	expect(summaries.map((summary) => [summary.scope, summary.name, summary.configError])).toEqual([
		["user", "bad", 'server "bad" must be an object'],
		["user", "docs", undefined],
	]);
	const errors = summarizeMcpConfigErrors(files);
	expect(errors.map((error) => error.source)).toEqual([join(cwd, ".pi", "mcp.json")]);
	expect(errors[0]?.message).toBeTruthy();
	expect(JSON.stringify(errors)).not.toContain("abcdefghijklmnopqrstuvwx1234");
	expect(summarizeMcpConfigErrors({ ...files, projectTrusted: false })).toEqual([]);
});
