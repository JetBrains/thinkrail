import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintMcpEntry, mcpTargetOf } from "./config";
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
				linear: {
					url: "https://linear.example/mcp",
					description: "Linear issues; use token=sk-live-secret",
				},
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
				policy: {
					approvals,
					overrides: { docs: { enabled: false, exposure: "hidden" } },
					toolGrants: {},
				},
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
	expect(pending["user:linear"]?.description).toBe("Linear issues; use token=***");
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
		fingerprint: fingerprintMcpEntry("linear", {
			url: "https://linear.example/mcp",
			description: "Linear issues; use token=sk-live-secret",
		}),
		approval: {
			state: "pending",
			fingerprint: fingerprintMcpEntry("linear", { exposure: "direct" }),
		},
	});
	expect(pending["project:repo"]).toMatchObject({
		transport: "stdio",
		endpoint: 'npx -y repo-server --header "Authorization: ***"',
		fingerprint: fingerprintMcpEntry("repo", repo),
		approval: { state: "pending", fingerprint: fingerprintMcpEntry("repo", repo) },
	});
	expect(pending["user:docs"]?.fingerprint).toBe(
		fingerprintMcpEntry("docs", {
			headers: { Authorization: `Bearer \${DOCS}` },
			url: "https://docs.example/mcp",
		}),
	);
	expect(byName({})["user:docs"]?.fingerprint).toBe(pending["user:docs"]?.fingerprint);
	expect(pending["project:shared"]?.replacesGlobal).toBe(true);
	expect(pending["project:shared"]?.effective).toBe(false);
	expect(pending["user:shared"]?.effective).toBe(true);
	expect(pending["project:broken"]?.configError).toBeDefined();

	const approved = byName({
		repo: fingerprintMcpEntry("repo", repo),
		linear: fingerprintMcpEntry("linear", { exposure: "direct" }),
		shared: "stale-fingerprint",
	});
	expect(approved["project:repo"]?.approval?.state).toBe("approved");
	expect(approved["project:repo"]?.effective).toBe(true);
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
	const summaries = summarizeMcpServers({
		...files,
		policy: { approvals: {}, overrides: {}, toolGrants: {} },
	});
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

test("folded project overrides retain validation errors regardless of approval", () => {
	const agentDir = join(root, "invalid-override-agent");
	const cwd = join(root, "invalid-override-project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	const overrides = {
		enabled: { enabled: "false" },
		exposure: { exposure: "invalid" },
		tools: { toolExposure: { "token=fixture-secret": "invalid" } },
		extra: { enabled: false, headers: {} },
		invalidBase: { enabled: false },
	};
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				enabled: { url: "https://docs.example/mcp" },
				exposure: { command: "unused" },
				tools: { command: "unused" },
				extra: { command: "unused" },
				invalidBase: null,
			},
		}),
	);
	writeFileSync(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: overrides }));
	for (const approved of [false, true]) {
		const approvals = approved
			? Object.fromEntries(
					Object.entries(overrides).map(([name, entry]) => [
						name,
						fingerprintMcpEntry(name, entry),
					]),
				)
			: {};
		const rows = summarizeMcpServers({
			agentDir,
			cwd,
			projectTrusted: true,
			policy: { approvals, overrides: {}, toolGrants: {} },
		});
		expect(rows).toHaveLength(5);
		for (const row of rows) {
			expect(row.scope).toBe("user");
			expect(row.effective).toBe(row.name !== "invalidBase");
			expect(row.approval?.state).toBe(approved ? "approved" : "pending");
			expect(row.configError).toBeTruthy();
			expect(row.enabled).toBe(true);
			expect(row.effectiveExposure).toBe("deferred");
		}
		expect(rows.find((row) => row.name === "enabled")?.configError).toBe(
			'server "enabled": enabled must be a boolean',
		);
		expect(rows.find((row) => row.name === "exposure")?.configError).toContain(
			"exposure must be one of",
		);
		expect(rows.find((row) => row.name === "tools")?.configError).toContain("toolExposure");
		expect(rows.find((row) => row.name === "extra")?.configError).toContain(
			"an override can only set enabled, exposure, toolExposure",
		);
		expect(rows.find((row) => row.name === "invalidBase")?.configError).toBe(
			'server "invalidBase" must be an object\nserver "invalidBase" needs "command" or "url", or a global server to override',
		);
		expect(JSON.stringify(rows)).not.toContain("fixture-secret");
	}
});

test("always-allowed tools are listed only while the server keeps the command or URL they were granted for", () => {
	const agentDir = join(root, "grant-agent");
	const cwd = join(root, "grant-project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	const write = (url: string, headers: Record<string, string>) =>
		writeFileSync(
			join(agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { "my-docs": { url, headers } } }),
		);
	const grantedFor = (url: string) => mcpTargetOf({ url });
	const listed = (target: string) =>
		summarizeMcpServers({
			agentDir,
			cwd,
			projectTrusted: false,
			policy: {
				approvals: {},
				overrides: {},
				toolGrants: { "my-docs": { target, tools: ["mcp__my_docs__search_all"] } },
			},
		})[0]?.alwaysAllowed;

	write("https://docs.example/mcp", { "X-Team": "a" });
	const target = grantedFor("https://docs.example/mcp");
	expect(listed(target)).toEqual([{ tool: "mcp__my_docs__search_all", label: "search_all" }]);
	write("https://docs.example/mcp", { "X-Team": "b" });
	expect(listed(target)).toEqual([{ tool: "mcp__my_docs__search_all", label: "search_all" }]);
	write("https://elsewhere.example/mcp", { "X-Team": "b" });
	expect(listed(target)).toBeUndefined();
});
