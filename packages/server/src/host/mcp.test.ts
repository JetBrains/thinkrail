import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpListResult, McpServerLog, McpServerSummary } from "@thinkrail/contracts";
import {
	approveProjectMcpServer,
	getProjects,
	grantProjectMcpTool,
	setProjectMcpOverride,
	setProjectTrust,
} from "../projects";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "test-client" };
const malformedEntries = [42, "invalid", 0, false, null, []];
const saved = { data: process.env.THINKRAIL_DATA_DIR, agent: process.env.PI_CODING_AGENT_DIR };
let root: string;
let repo: string;
let agentDir: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "host-mcp-"));
	repo = join(root, "repo");
	agentDir = join(root, "agent");
	mkdirSync(repo, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	process.env.THINKRAIL_DATA_DIR = join(root, "data");
	process.env.PI_CODING_AGENT_DIR = agentDir;
	mkdirSync(join(root, "data"), { recursive: true });
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify([
			{
				id: "p1",
				name: "repo",
				path: repo,
				slug: "repo",
				lastOpened: 1,
				piResourceTrust: "granted",
			},
		]),
	);
	writeFileSync(
		join(root, "data", "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				kind: "default",
				name: "Default",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
			},
		]),
	);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (saved.data === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = saved.data;
	if (saved.agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved.agent;
});

const request = (method: string, params: unknown) =>
	handleRequest(method, params, CTX) as Promise<McpListResult>;

const find = (result: McpListResult, scope: McpServerSummary["scope"], name: string) =>
	result.servers.find((server) => server.scope === scope && server.name === name);

const codeOf = (promise: Promise<unknown>) =>
	promise.then(
		() => "resolved",
		(error: { code?: string }) => error.code ?? "uncoded",
	);

test("config writes land in the defining file, validate like pi, and a project server added in ThinkRail is approved", async () => {
	const added = await request("mcp.add", {
		workspaceId: "w1",
		scope: "user",
		name: "docs",
		entry: { url: "https://docs.example/mcp" },
	});
	expect(find(added, "user", "docs")).toMatchObject({ transport: "http", oauth: true });
	expect(JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8")).mcpServers.docs).toEqual({
		url: "https://docs.example/mcp",
	});
	expect(
		await codeOf(
			request("mcp.add", {
				workspaceId: "w1",
				scope: "user",
				name: "docs",
				entry: { url: "https://x" },
			}),
		),
	).toBe("MCP_CONFIG_INVALID");
	expect(
		await codeOf(
			request("mcp.add", {
				workspaceId: "w1",
				scope: "user",
				name: "legacy",
				entry: { url: "https://x", type: "sse" },
			}),
		),
	).toBe("MCP_CONFIG_INVALID");
	expect(
		await codeOf(
			request("mcp.add", {
				workspaceId: "w1",
				scope: "project",
				name: "tokened",
				entry: { url: "https://x", auth: { provider: "anthropic" } },
			}),
		),
	).toBe("MCP_CONFIG_INVALID");

	const project = await request("mcp.add", {
		workspaceId: "w1",
		scope: "project",
		name: "repo-tool",
		entry: { command: "npx", args: ["-y", "repo-tool"] },
	});
	expect(find(project, "project", "repo-tool")?.approval?.state).toBe("approved");

	const removed = await request("mcp.remove", {
		workspaceId: "w1",
		scope: "user",
		name: "docs",
		expectedFingerprint: find(project, "user", "docs")?.fingerprint,
	});
	expect(find(removed, "user", "docs")).toBeUndefined();
});

test("a user entry is rewritten or removed only as rendered: a stale or missing fingerprint refuses and leaves the file as it is", async () => {
	const file = join(agentDir, "mcp.json");
	const rendered = find(
		await request("mcp.add", {
			workspaceId: "w1",
			scope: "user",
			name: "docs",
			entry: { url: "https://docs.example/mcp" },
		}),
		"user",
		"docs",
	);
	expect(rendered?.fingerprint).toBeString();
	expect(rendered?.approval).toBeUndefined();

	writeFileSync(
		file,
		JSON.stringify({ mcpServers: { docs: { command: "npx", args: ["-y", "replaced"] } } }),
	);
	const replaced = readFileSync(file, "utf8");
	const stale = { workspaceId: "w1", scope: "user", name: "docs" };
	for (const params of [
		{ ...stale, expectedFingerprint: rendered?.fingerprint },
		stale,
		{ ...stale, expectedFingerprint: 42 },
	]) {
		expect(
			await codeOf(request("mcp.update", { ...params, entry: { url: "https://docs.example/v2" } })),
		).toBe("MCP_CONFIG_INVALID");
		expect(await codeOf(request("mcp.remove", params))).toBe("MCP_CONFIG_INVALID");
		expect(readFileSync(file, "utf8")).toBe(replaced);
	}
	await expect(
		request("mcp.remove", { ...stale, expectedFingerprint: rendered?.fingerprint }),
	).rejects.toThrow('The entry for "docs" changed since it was opened — review it again.');

	const current = find(await request("mcp.list", { workspaceId: "w1" }), "user", "docs");
	expect(current?.fingerprint).not.toBe(rendered?.fingerprint);
	const updated = find(
		await request("mcp.update", {
			...stale,
			entry: { url: "https://docs.example/v2" },
			expectedFingerprint: current?.fingerprint,
		}),
		"user",
		"docs",
	);
	expect(updated?.endpoint).toBe("https://docs.example/v2");
	expect(updated?.fingerprint).not.toBe(current?.fingerprint);
	const removed = await request("mcp.remove", {
		...stale,
		expectedFingerprint: updated?.fingerprint,
	});
	expect(find(removed, "user", "docs")).toBeUndefined();
	expect(JSON.parse(readFileSync(file, "utf8")).mcpServers.docs).toBeUndefined();
});

for (const scope of ["user", "project"] as const) {
	test.each(
		malformedEntries.map((entry) => [entry] as const),
	)(`add refuses a ${scope} name occupied by %j after the client listed it as absent`, async (entry) => {
		approveProjectMcpServer("p1", "other", "other-fingerprint");
		expect(find(await request("mcp.list", { workspaceId: "w1" }), scope, "docs")).toBeUndefined();
		mkdirSync(join(repo, ".pi"));
		const file = join(scope === "user" ? agentDir : join(repo, ".pi"), "mcp.json");
		writeFileSync(file, `${JSON.stringify({ mcpServers: { docs: entry } }, null, "\t")}\n`);
		const before = readFileSync(file, "utf8");
		const projectsFile = join(root, "data", "projects.json");
		const projectsBefore = readFileSync(projectsFile, "utf8");

		expect(
			await codeOf(
				request("mcp.add", {
					workspaceId: "w1",
					scope,
					name: "docs",
					entry: { url: "https://docs.example/mcp" },
				}),
			),
		).toBe("MCP_CONFIG_INVALID");
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(readFileSync(projectsFile, "utf8")).toBe(projectsBefore);

		const current = find(await request("mcp.list", { workspaceId: "w1" }), scope, "docs");
		expect(current?.configError).toBe('server "docs" must be an object');
		expect(
			await codeOf(
				request("mcp.update", {
					workspaceId: "w1",
					scope,
					name: "docs",
					entry: { url: "https://docs.example/mcp" },
					expectedFingerprint: current?.fingerprint,
				}),
			),
		).toBe("MCP_CONFIG_INVALID");
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(readFileSync(projectsFile, "utf8")).toBe(projectsBefore);
	});

	test(`add at ${scope} scope only treats own properties as occupied`, async () => {
		mkdirSync(join(repo, ".pi"));
		const file = join(scope === "user" ? agentDir : join(repo, ".pi"), "mcp.json");
		writeFileSync(file, JSON.stringify({ mcpServers: {} }));
		const added = await request("mcp.add", {
			workspaceId: "w1",
			scope,
			name: "__proto__",
			entry: { url: "https://proto.example/mcp" },
		});
		expect(find(added, scope, "__proto__")).toMatchObject({ transport: "http" });
		if (scope === "project")
			expect(find(added, scope, "__proto__")?.approval?.state).toBe("approved");
		const servers = JSON.parse(readFileSync(file, "utf8")).mcpServers;
		expect(Object.hasOwn(servers, "__proto__")).toBe(true);
		expect(servers).toEqual({ ["__proto__"]: { url: "https://proto.example/mcp" } });
	});
}

test("a repo-side change lapses approval, and approving needs the fingerprint that is on disk now", async () => {
	mkdirSync(join(repo, ".pi"));
	const write = (args: string[]) =>
		writeFileSync(
			join(repo, ".pi", "mcp.json"),
			JSON.stringify({ mcpServers: { repo: { command: "npx", args } } }),
		);
	write(["-y", "good"]);
	const pending = find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo");
	expect(pending?.approval?.state).toBe("pending");
	const approved = await request("mcp.approve", {
		workspaceId: "w1",
		name: "repo",
		fingerprint: pending?.approval?.fingerprint,
	});
	expect(find(approved, "project", "repo")?.approval?.state).toBe("approved");

	write(["-y", "evil"]);
	const changed = find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo");
	expect(changed?.approval?.state).toBe("changed");
	expect(
		await codeOf(
			request("mcp.approve", {
				workspaceId: "w1",
				name: "repo",
				fingerprint: pending?.approval?.fingerprint,
			}),
		),
	).toBe("MCP_CONFIG_INVALID");
});

test("an update never approves a pending or changed repository entry, and carries approval only from an entry approved as it is on disk", async () => {
	mkdirSync(join(repo, ".pi"));
	const file = join(repo, ".pi", "mcp.json");
	const writeRepo = (args: string[]) =>
		writeFileSync(file, JSON.stringify({ mcpServers: { repo: { command: "npx", args } } }));
	const update = (entry: object, expectedFingerprint?: string) =>
		request("mcp.update", {
			workspaceId: "w1",
			scope: "project",
			name: "repo",
			entry,
			...(expectedFingerprint ? { expectedFingerprint } : {}),
		}).then((result) => find(result, "project", "repo"));

	writeRepo(["-y", "good"]);
	const pending = find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo");
	const toggled = await update(
		{ command: "npx", args: ["-y", "good"], enabled: false },
		pending?.approval?.fingerprint,
	);
	expect(toggled).toMatchObject({ enabled: false, approval: { state: "pending" } });

	await request("mcp.approve", {
		workspaceId: "w1",
		name: "repo",
		fingerprint: toggled?.approval?.fingerprint,
	});
	const reenabled = await update(
		{ command: "npx", args: ["-y", "good"] },
		toggled?.approval?.fingerprint,
	);
	expect(reenabled).toMatchObject({ enabled: true, approval: { state: "approved" } });
	expect(reenabled?.approval?.fingerprint).not.toBe(toggled?.approval?.fingerprint);

	writeRepo(["-y", "evil"]);
	expect(await codeOf(update({ command: "npx", args: ["-y", "evil"], enabled: false }))).toBe(
		"MCP_CONFIG_INVALID",
	);
	const changed = find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo");
	const rewritten = await update(
		{ command: "npx", args: ["-y", "evil"], enabled: false },
		changed?.approval?.fingerprint,
	);
	expect(rewritten).toMatchObject({ enabled: false, approval: { state: "changed" } });
	for (const method of ["mcp.add", "mcp.update", "mcp.remove"]) {
		expect(
			await codeOf(
				request(method, { workspaceId: "w1", scope: "repo", name: "x", entry: { command: "x" } }),
			),
		).toBe("uncoded");
	}
	expect(JSON.parse(readFileSync(file, "utf8")).mcpServers.x).toBeUndefined();
});

test("an update or removal rendered from an entry that changed on disk since is refused and leaves the file as it is", async () => {
	mkdirSync(join(repo, ".pi"));
	const file = join(repo, ".pi", "mcp.json");
	await request("mcp.add", {
		workspaceId: "w1",
		scope: "project",
		name: "repo",
		entry: { command: "npx", args: ["-y", "good"] },
	});
	const rendered = find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo");
	expect(rendered?.approval?.state).toBe("approved");

	writeFileSync(
		file,
		JSON.stringify({ mcpServers: { repo: { command: "npx", args: ["-y", "evil"] } } }),
	);
	const checkedOut = readFileSync(file, "utf8");
	expect(
		await codeOf(
			request("mcp.update", {
				workspaceId: "w1",
				scope: "project",
				name: "repo",
				entry: { command: "npx", args: ["-y", "evil"], enabled: false },
				expectedFingerprint: rendered?.approval?.fingerprint,
			}),
		),
	).toBe("MCP_CONFIG_INVALID");
	expect(readFileSync(file, "utf8")).toBe(checkedOut);
	expect(
		find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo")?.approval?.state,
	).toBe("changed");
	expect(
		await codeOf(
			request("mcp.remove", {
				workspaceId: "w1",
				scope: "project",
				name: "repo",
				expectedFingerprint: rendered?.approval?.fingerprint,
			}),
		),
	).toBe("MCP_CONFIG_INVALID");
	expect(readFileSync(file, "utf8")).toBe(checkedOut);
	const current = find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo");
	const removed = await request("mcp.remove", {
		workspaceId: "w1",
		scope: "project",
		name: "repo",
		expectedFingerprint: current?.approval?.fingerprint,
	});
	expect(find(removed, "project", "repo")).toBeUndefined();
});

test("always-allowed tools are listed on their server row and revoked one by one", async () => {
	const url = "https://linear.example/mcp";
	const target = createHash("sha256").update(JSON.stringify({ url })).digest("hex");
	writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { linear: { url } } }));
	grantProjectMcpTool("p1", "linear", target, "mcp__linear__create_issue");
	grantProjectMcpTool("p1", "linear", target, "mcp__linear__comment");
	const listed = await request("mcp.list", { workspaceId: "w1" });
	expect(find(listed, "user", "linear")?.alwaysAllowed).toEqual([
		{ tool: "mcp__linear__create_issue", label: "create_issue" },
		{ tool: "mcp__linear__comment", label: "comment" },
	]);
	const revoked = await request("mcp.revokeToolGrant", {
		workspaceId: "w1",
		name: "linear",
		tool: "mcp__linear__create_issue",
	});
	expect(find(revoked, "user", "linear")?.alwaysAllowed).toEqual([
		{ tool: "mcp__linear__comment", label: "comment" },
	]);
	expect(getProjects()[0]?.mcpToolGrants?.linear?.tools).toEqual(["mcp__linear__comment"]);
	expect(
		await codeOf(request("mcp.revokeToolGrant", { workspaceId: "w1", name: "linear", tool: 7 })),
	).toBe("MCP_CONFIG_INVALID");
});

test("share refuses a repository entry of that name that is a full definition or an unapproved override", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { linear: { url: "https://linear.example/mcp" } } }),
	);
	await request("mcp.setProjectOverride", { workspaceId: "w1", name: "linear", enabled: false });
	mkdirSync(join(repo, ".pi"));
	const file = join(repo, ".pi", "mcp.json");
	const share = () => request("mcp.shareWithRepo", { workspaceId: "w1", name: "linear" });
	const refusedLeavesFile = async (entry: object) => {
		writeFileSync(file, JSON.stringify({ mcpServers: { linear: entry } }));
		const before = readFileSync(file, "utf8");
		expect(await codeOf(share())).toBe("MCP_CONFIG_INVALID");
		expect(readFileSync(file, "utf8")).toBe(before);
	};

	await refusedLeavesFile({ url: "https://repo.example/mcp" });
	await refusedLeavesFile({ exposure: "direct" });

	const pending = find(await request("mcp.list", { workspaceId: "w1" }), "user", "linear");
	expect(pending?.approval?.state).toBe("pending");
	await request("mcp.approve", {
		workspaceId: "w1",
		name: "linear",
		fingerprint: pending?.approval?.fingerprint,
	});
	const shared = await share();
	expect(JSON.parse(readFileSync(file, "utf8")).mcpServers.linear).toEqual({
		exposure: "direct",
		enabled: false,
	});
	expect(find(shared, "user", "linear")).toMatchObject({
		enabled: false,
		approval: { state: "approved" },
	});
});

test.each(
	malformedEntries.map((entry) => [entry] as const),
)("share refuses a repository name occupied by %j regardless of approval", async (entry) => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { linear: { url: "https://linear.example/mcp" } } }),
	);
	await request("mcp.setProjectOverride", { workspaceId: "w1", name: "linear", enabled: false });
	mkdirSync(join(repo, ".pi"));
	const file = join(repo, ".pi", "mcp.json");
	writeFileSync(file, `${JSON.stringify({ mcpServers: { linear: entry } }, null, "\t")}\n`);
	const before = readFileSync(file, "utf8");
	const projectsFile = join(root, "data", "projects.json");
	for (const approved of [false, true]) {
		if (approved) {
			const current = find(await request("mcp.list", { workspaceId: "w1" }), "project", "linear");
			await request("mcp.approve", {
				workspaceId: "w1",
				name: "linear",
				fingerprint: current?.approval?.fingerprint,
			});
		}
		const projectsBefore = readFileSync(projectsFile, "utf8");
		expect(await codeOf(request("mcp.shareWithRepo", { workspaceId: "w1", name: "linear" }))).toBe(
			"MCP_CONFIG_INVALID",
		);
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(readFileSync(projectsFile, "utf8")).toBe(projectsBefore);
	}
});

test("project settings for a user server merge into the record field by field until shared with the repo", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { linear: { url: "https://linear.example/mcp" } } }),
	);
	await request("mcp.setProjectOverride", {
		workspaceId: "w1",
		name: "linear",
		exposure: "direct",
	});
	const overridden = await request("mcp.setProjectOverride", {
		workspaceId: "w1",
		name: "linear",
		enabled: false,
	});
	expect(find(overridden, "user", "linear")).toMatchObject({
		enabled: false,
		projectOverride: { enabled: false, exposure: "direct" },
	});
	const shared = await request("mcp.shareWithRepo", { workspaceId: "w1", name: "linear" });
	expect(JSON.parse(readFileSync(join(repo, ".pi", "mcp.json"), "utf8")).mcpServers.linear).toEqual(
		{
			enabled: false,
			exposure: "direct",
		},
	);
	expect(find(shared, "user", "linear")).toMatchObject({
		enabled: false,
		approval: { state: "approved" },
	});
	expect(find(shared, "user", "linear")?.projectOverride).toBeUndefined();
	expect(await codeOf(request("mcp.shareWithRepo", { workspaceId: "w1", name: "linear" }))).toBe(
		"MCP_CONFIG_INVALID",
	);
});

test("share requires the user-level server to remain an object definition", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { linear: { url: "https://linear.example/mcp" } } }),
	);
	await request("mcp.setProjectOverride", { workspaceId: "w1", name: "linear", enabled: false });
	const projectsFile = join(root, "data", "projects.json");
	const projectsBefore = readFileSync(projectsFile, "utf8");
	for (const entry of [undefined, ...malformedEntries, { enabled: false }]) {
		const userFile = join(agentDir, "mcp.json");
		writeFileSync(userFile, JSON.stringify({ mcpServers: { linear: entry } }));
		const before = readFileSync(userFile, "utf8");
		expect(await codeOf(request("mcp.shareWithRepo", { workspaceId: "w1", name: "linear" }))).toBe(
			"MCP_CONFIG_INVALID",
		);
		expect(existsSync(join(repo, ".pi", "mcp.json"))).toBe(false);
		expect(readFileSync(userFile, "utf8")).toBe(before);
		expect(readFileSync(projectsFile, "utf8")).toBe(projectsBefore);
	}
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { linear: { url: "https://linear.example/mcp" } } }),
	);
	const linear = find(await request("mcp.list", { workspaceId: "w1" }), "user", "linear");
	expect(linear).toMatchObject({ enabled: false, projectOverride: { enabled: false } });
	expect(linear?.approval).toBeUndefined();
});

test("project writes refuse a symlinked .pi, and per-chat calls need a session of that workspace", async () => {
	const elsewhere = join(root, "elsewhere");
	mkdirSync(elsewhere);
	symlinkSync(elsewhere, join(repo, ".pi"));
	expect(
		await codeOf(
			request("mcp.add", {
				workspaceId: "w1",
				scope: "project",
				name: "x",
				entry: { command: "npx" },
			}),
		),
	).toBe("MCP_PATH_UNSAFE");
	expect(
		await codeOf(
			request("mcp.setSessionOverride", {
				workspaceId: "w1",
				sessionId: "01a11840-3318-7548-baaf-c5a7a0729057",
				name: "x",
				enabled: false,
			}),
		),
	).toBe("RESOURCE_UNAVAILABLE");
	expect(
		await codeOf(
			request("mcp.add", { workspaceId: "w1", scope: "user", name: "bad name", entry: {} }),
		),
	).toBe("MCP_CONFIG_INVALID");
});

test("with builtin:mcp turned off in pi settings, sign-in, sign-out, Test connection and every mutation are refused", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { url: "https://docs.example/mcp" } } }),
	);
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["-builtin:mcp"] }));
	expect((await request("mcp.list", { workspaceId: "w1" })).handledElsewhere).toEqual({
		by: "pi settings (-builtin:mcp)",
	});
	for (const method of ["mcp.login", "mcp.logout", "mcp.testConnection"]) {
		expect(await codeOf(request(method, { workspaceId: "w1", name: "docs" }))).toBe(
			"MCP_HANDLED_ELSEWHERE",
		);
	}
	const before = readFileSync(join(agentDir, "mcp.json"), "utf8");
	const docs = find(await request("mcp.list", { workspaceId: "w1" }), "user", "docs");
	const mutations: [string, object][] = [
		["mcp.add", { scope: "user", name: "more", entry: { url: "https://more.example/mcp" } }],
		[
			"mcp.update",
			{
				scope: "user",
				name: "docs",
				entry: { url: "https://docs.example/v2" },
				expectedFingerprint: docs?.fingerprint,
			},
		],
		["mcp.remove", { scope: "user", name: "docs", expectedFingerprint: docs?.fingerprint }],
		["mcp.setProjectOverride", { name: "docs", enabled: false }],
		["mcp.approve", { name: "docs", fingerprint: "f" }],
		["mcp.shareWithRepo", { name: "docs" }],
	];
	for (const [method, params] of mutations) {
		expect(await codeOf(request(method, { workspaceId: "w1", ...params }))).toBe(
			"MCP_HANDLED_ELSEWHERE",
		);
	}
	expect(readFileSync(join(agentDir, "mcp.json"), "utf8")).toBe(before);
	expect(existsSync(join(repo, ".pi", "mcp.json"))).toBe(false);
	rmSync(join(agentDir, "settings.json"));
	expect(
		find(
			await request("mcp.setProjectOverride", { workspaceId: "w1", name: "docs", enabled: false }),
			"user",
			"docs",
		)?.enabled,
	).toBe(false);
});

test("a server's log is its own masked lines from pi's mcp.log and its rotated copy, empty before anything was logged", async () => {
	const readLog = (name: string) =>
		handleRequest("mcp.readLog", { workspaceId: "w1", name }, CTX) as Promise<McpServerLog>;
	const path = join(agentDir, "mcp.log");
	expect(await readLog("docs")).toEqual({ path, text: "" });
	writeFileSync(`${path}.1`, "2026-10-08T08:59:59.000Z [docs] info before rotation\n");
	writeFileSync(
		path,
		[
			"2026-10-08T09:00:00.000Z [docs] error upstream said: Bearer fixture-log-secret",
			"    retry with api_key=fixture-key-secret",
			"2026-10-08T09:00:01.000Z [other] info unrelated",
			"",
		].join("\n"),
	);
	const log = await readLog("docs");
	expect(log.path).toBe(path);
	expect(log.text).toBe(
		[
			"2026-10-08T08:59:59.000Z [docs] info before rotation",
			"2026-10-08T09:00:00.000Z [docs] error upstream said: Bearer ***",
			"    retry with api_key=***",
		].join("\n"),
	);
	expect(await codeOf(readLog("../docs"))).toBe("MCP_CONFIG_INVALID");
});

test("an unreadable mcp.json is listed as a file problem with its path, and an entry that is not an object keeps its row", async () => {
	const file = join(agentDir, "mcp.json");
	writeFileSync(file, "{ not json");
	const broken = await request("mcp.list", { workspaceId: "w1" });
	expect(broken.servers).toEqual([]);
	expect(broken.configErrors?.map((error) => error.source)).toEqual([file]);
	expect(broken.configErrors?.[0]?.message).toBeTruthy();
	writeFileSync(file, JSON.stringify({ mcpServers: { bad: null } }));
	const odd = await request("mcp.list", { workspaceId: "w1" });
	expect(odd.configErrors).toBeUndefined();
	expect(find(odd, "user", "bad")?.configError).toBe('server "bad" must be an object');
});

test("an untrusted project refuses writes to the MCP servers its repository defines", async () => {
	mkdirSync(join(repo, ".pi"));
	const file = join(repo, ".pi", "mcp.json");
	writeFileSync(
		file,
		JSON.stringify({ mcpServers: { repo: { command: "npx", args: ["-y", "x"] } } }),
	);
	const pending = find(await request("mcp.list", { workspaceId: "w1" }), "project", "repo");
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { linear: { url: "https://linear.example/mcp" } } }),
	);
	await request("mcp.setProjectOverride", { workspaceId: "w1", name: "linear", enabled: false });
	await handleRequest("project.setTrust", { id: "p1", trusted: false }, CTX);
	const before = readFileSync(file, "utf8");
	const refused: [string, object][] = [
		["mcp.approve", { name: "repo", fingerprint: pending?.approval?.fingerprint }],
		[
			"mcp.update",
			{ scope: "project", name: "repo", entry: { command: "npx", args: ["-y", "y"] } },
		],
		["mcp.add", { scope: "project", name: "fresh", entry: { command: "npx" } }],
		["mcp.remove", { scope: "project", name: "repo" }],
		["mcp.shareWithRepo", { name: "linear" }],
	];
	for (const [method, params] of refused) {
		expect(await codeOf(request(method, { workspaceId: "w1", ...params }))).toBe(
			"MCP_CONFIG_INVALID",
		);
	}
	expect(readFileSync(file, "utf8")).toBe(before);
	const listed = await request("mcp.list", { workspaceId: "w1" });
	expect(find(listed, "project", "repo")).toBeUndefined();
	expect(find(listed, "user", "linear")?.enabled).toBe(false);
	expect(
		find(
			await request("mcp.setProjectOverride", { workspaceId: "w1", name: "linear", enabled: true }),
			"user",
			"linear",
		)?.enabled,
	).toBe(true);
});

test("Test connection judges the effective server of a name, not the shadowed one", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { command: "docs-stdio" } } }),
	);
	mkdirSync(join(repo, ".pi"));
	writeFileSync(
		join(repo, ".pi", "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { url: "http://127.0.0.1:1/mcp" } } }),
	);
	const test = () =>
		handleRequest("mcp.testConnection", { workspaceId: "w1", name: "docs" }, CTX) as Promise<{
			loginId: string;
		}>;
	expect(await codeOf(test())).toBe("MCP_CONFIG_INVALID");
	const pending = find(await request("mcp.list", { workspaceId: "w1" }), "project", "docs");
	await request("mcp.approve", {
		workspaceId: "w1",
		name: "docs",
		fingerprint: pending?.approval?.fingerprint,
	});
	const started = await test();
	expect(typeof started.loginId).toBe("string");
	await request("provider.loginCancel", { loginId: started.loginId });
});

test("a user server named __proto__ keeps its project setting as an own record entry", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { ["__proto__"]: { url: "https://proto.example/mcp" } } }),
	);
	const listed = await request("mcp.setProjectOverride", {
		workspaceId: "w1",
		name: "__proto__",
		enabled: false,
	});
	expect(find(listed, "user", "__proto__")).toMatchObject({
		enabled: false,
		projectOverride: { enabled: false },
	});
	const stored = JSON.parse(readFileSync(join(root, "data", "projects.json"), "utf8"))[0];
	expect(Object.hasOwn(stored.mcpOverrides, "__proto__")).toBe(true);
	expect(find(await request("mcp.list", { workspaceId: "w1" }), "user", "__proto__")?.enabled).toBe(
		false,
	);
});

test("concurrent project override patches preserve both fields and unrelated settings", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { url: "http://127.0.0.1:1/mcp" } } }),
	);
	await request("mcp.setProjectOverride", { workspaceId: "w1", name: "other", enabled: false });
	await Promise.all([
		request("mcp.setProjectOverride", { workspaceId: "w1", name: "docs", enabled: false }),
		request("mcp.setProjectOverride", { workspaceId: "w1", name: "docs", exposure: "direct" }),
	]);
	expect(getProjects()[0]?.mcpOverrides).toEqual({
		other: { enabled: false },
		docs: { enabled: false, exposure: "direct" },
	});
	expect(find(await request("mcp.list", { workspaceId: "w1" }), "user", "docs")).toMatchObject({
		enabled: false,
		effectiveExposure: "direct",
	});
});

test("sharing uses the latest project override after ownership resolves", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { command: "unused-test-server" } } }),
	);
	setProjectMcpOverride("p1", "docs", { enabled: false });
	const pending = request("mcp.shareWithRepo", { workspaceId: "w1", name: "docs" });
	setProjectMcpOverride("p1", "docs", { exposure: "direct" });
	const result = await pending;
	expect(JSON.parse(readFileSync(join(repo, ".pi", "mcp.json"), "utf8")).mcpServers.docs).toEqual({
		enabled: false,
		exposure: "direct",
	});
	expect(find(result, "user", "docs")).toMatchObject({
		enabled: false,
		effectiveExposure: "direct",
		approval: { state: "approved" },
	});
	expect(getProjects()[0]?.mcpOverrides).toBeUndefined();
});

test("trust revoked during ownership resolution refuses every repository mutation", async () => {
	const added = await request("mcp.add", {
		workspaceId: "w1",
		scope: "project",
		name: "repo",
		entry: { command: "unused-test-server" },
	});
	const fingerprint = find(added, "project", "repo")?.approval?.fingerprint;
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { url: "http://127.0.0.1:1/mcp" } } }),
	);
	await request("mcp.setProjectOverride", { workspaceId: "w1", name: "docs", enabled: false });
	const file = join(repo, ".pi", "mcp.json");
	const before = readFileSync(file, "utf8");
	const approvals = getProjects()[0]?.mcpApprovals;
	const mutations: [string, object][] = [
		["mcp.add", { scope: "project", name: "new", entry: { command: "unused-test-server" } }],
		[
			"mcp.update",
			{
				scope: "project",
				name: "repo",
				entry: { command: "changed-test-server" },
				expectedFingerprint: fingerprint,
			},
		],
		["mcp.remove", { scope: "project", name: "repo", expectedFingerprint: fingerprint }],
		["mcp.approve", { name: "repo", fingerprint }],
		["mcp.shareWithRepo", { name: "docs" }],
	];
	for (const [method, params] of mutations) {
		setProjectTrust("p1", true, undefined, { resources: true });
		const pending = request(method, { workspaceId: "w1", ...params });
		setProjectTrust("p1", false);
		expect(await codeOf(pending)).toBe("MCP_CONFIG_INVALID");
		expect(readFileSync(file, "utf8")).toBe(before);
		expect(getProjects()[0]).toMatchObject({
			piResourceTrust: "untrusted",
			mcpApprovals: approvals,
			mcpOverrides: { docs: { enabled: false } },
		});
	}
});

test("ownership resolved for a previous cwd or project cannot admit a mutation", async () => {
	const path = join(root, "data", "workspaces.json");
	const original = readFileSync(path, "utf8");
	const workspace = JSON.parse(original)[0];
	const otherRepo = join(root, "other-repo");
	mkdirSync(otherRepo);
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify([...getProjects(), { ...getProjects()[0], id: "p2" }]),
	);
	for (const replacement of [
		{ ...workspace, worktreePath: otherRepo },
		{ ...workspace, projectId: "p2" },
	]) {
		writeFileSync(path, original);
		const pending = request("mcp.add", {
			workspaceId: "w1",
			scope: "user",
			name: "docs",
			entry: { command: "unused-test-server" },
		});
		writeFileSync(path, JSON.stringify([replacement]));
		expect(await codeOf(pending)).toBe("MCP_CONFIG_INVALID");
		expect(existsSync(join(agentDir, "mcp.json"))).toBe(false);
	}
});

test("an update carries only the approval current at synchronous admission", async () => {
	const added = await request("mcp.add", {
		workspaceId: "w1",
		scope: "project",
		name: "repo",
		entry: { command: "unused-test-server" },
	});
	const pending = request("mcp.update", {
		workspaceId: "w1",
		scope: "project",
		name: "repo",
		expectedFingerprint: find(added, "project", "repo")?.approval?.fingerprint,
		entry: { command: "unused-test-server", enabled: false },
	});
	const projects = getProjects();
	for (const project of projects) delete project.mcpApprovals;
	writeFileSync(join(root, "data", "projects.json"), JSON.stringify(projects));
	expect(find(await pending, "project", "repo")?.approval?.state).toBe("pending");
	expect(getProjects()[0]?.mcpApprovals).toBeUndefined();
});

test("wire overrides reject invalid enablement and exposure before changing project or session state", async () => {
	await request("mcp.setProjectOverride", { workspaceId: "w1", name: "docs", enabled: false });
	const projectsPath = join(root, "data", "projects.json");
	const before = readFileSync(projectsPath, "utf8");
	for (const enabled of ["false", 0, 1, null, {}, []]) {
		expect(
			await codeOf(request("mcp.setProjectOverride", { workspaceId: "w1", name: "docs", enabled })),
		).toBe("MCP_CONFIG_INVALID");
		expect(
			await codeOf(
				request("mcp.setSessionOverride", {
					workspaceId: "w1",
					sessionId: "01a11840-3318-7548-baaf-c5a7a0729057",
					name: "docs",
					enabled,
				}),
			),
		).toBe("MCP_CONFIG_INVALID");
		expect(readFileSync(projectsPath, "utf8")).toBe(before);
	}
	for (const exposure of ["codemode", "codemode-deferred", "DIRECT", "", true, 0, null, {}, []]) {
		expect(
			await codeOf(
				request("mcp.setProjectOverride", {
					workspaceId: "w1",
					name: "docs",
					enabled: true,
					exposure,
				}),
			),
		).toBe("MCP_CONFIG_INVALID");
		expect(readFileSync(projectsPath, "utf8")).toBe(before);
	}
	expect(
		await codeOf(
			request("mcp.setSessionOverride", { workspaceId: "w1", sessionId: "missing", name: "docs" }),
		),
	).toBe("MCP_CONFIG_INVALID");
});

test("probes refuse trust revoked while ownership is resolving", async () => {
	await request("mcp.add", {
		workspaceId: "w1",
		scope: "project",
		name: "docs",
		entry: { url: "http://127.0.0.1:1/mcp" },
	});
	for (const method of ["mcp.login", "mcp.logout", "mcp.testConnection"]) {
		setProjectTrust("p1", true, undefined, { resources: true });
		const pending = request(method, { workspaceId: "w1", name: "docs" });
		setProjectTrust("p1", false);
		expect(await codeOf(pending)).toBe("MCP_CONFIG_INVALID");
	}
});

test("probes reject ownership resolved for a previous cwd or project", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { url: "http://127.0.0.1:1/mcp" } } }),
	);
	const path = join(root, "data", "workspaces.json");
	const original = readFileSync(path, "utf8");
	const workspace = JSON.parse(original)[0];
	const otherRepo = join(root, "other-repo");
	mkdirSync(otherRepo);
	writeFileSync(
		join(root, "data", "projects.json"),
		JSON.stringify([...getProjects(), { ...getProjects()[0], id: "p2" }]),
	);
	for (const replacement of [
		{ ...workspace, worktreePath: otherRepo },
		{ ...workspace, projectId: "p2" },
	]) {
		for (const method of ["mcp.login", "mcp.logout", "mcp.testConnection"]) {
			writeFileSync(path, original);
			const pending = request(method, { workspaceId: "w1", name: "docs" });
			writeFileSync(path, JSON.stringify([replacement]));
			await expect(pending).rejects.toThrow("workspace or project trust changed");
		}
	}
});

test("Test connection reads the current approval rather than a pre-ownership snapshot", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { command: "unused-test-server" } } }),
	);
	await request("mcp.add", {
		workspaceId: "w1",
		scope: "project",
		name: "docs",
		entry: { url: "http://127.0.0.1:1/mcp" },
	});
	const pending = request("mcp.testConnection", { workspaceId: "w1", name: "docs" });
	approveProjectMcpServer("p1", "docs", "revoked-fingerprint");
	expect(await codeOf(pending)).toBe("MCP_CONFIG_INVALID");
});

test("Test connection ignores an approved invalid HTTP project entry over a valid user stdio server", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { command: "unused-test-server" } } }),
	);
	mkdirSync(join(repo, ".pi"));
	writeFileSync(
		join(repo, ".pi", "mcp.json"),
		JSON.stringify({ mcpServers: { docs: { url: "http://127.0.0.1:1/mcp", enabled: "false" } } }),
	);
	const invalid = find(await request("mcp.list", { workspaceId: "w1" }), "project", "docs");
	await request("mcp.approve", {
		workspaceId: "w1",
		name: "docs",
		fingerprint: invalid?.approval?.fingerprint,
	});
	expect(await codeOf(request("mcp.testConnection", { workspaceId: "w1", name: "docs" }))).toBe(
		"MCP_CONFIG_INVALID",
	);
});

test("Test connection admits the user HTTP server beneath an approved invalid project stdio entry", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { fallback: { url: "http://127.0.0.1:1/mcp" } } }),
	);
	mkdirSync(join(repo, ".pi"));
	writeFileSync(
		join(repo, ".pi", "mcp.json"),
		JSON.stringify({ mcpServers: { fallback: { command: "unused-test-server", args: false } } }),
	);
	const invalid = find(await request("mcp.list", { workspaceId: "w1" }), "project", "fallback");
	await request("mcp.approve", {
		workspaceId: "w1",
		name: "fallback",
		fingerprint: invalid?.approval?.fingerprint,
	});
	const started = (await handleRequest(
		"mcp.testConnection",
		{ workspaceId: "w1", name: "fallback" },
		CTX,
	)) as { loginId: string };
	expect(typeof started.loginId).toBe("string");
	await request("provider.loginCancel", { loginId: started.loginId });
});

test("probes refuse names with no admitted valid config", async () => {
	writeFileSync(
		join(agentDir, "mcp.json"),
		JSON.stringify({ mcpServers: { invalid: { url: "not-http" } } }),
	);
	for (const name of ["missing", "invalid"]) {
		for (const method of ["mcp.login", "mcp.logout", "mcp.testConnection"]) {
			expect(await codeOf(request(method, { workspaceId: "w1", name }))).toBe("MCP_CONFIG_INVALID");
		}
	}
});
