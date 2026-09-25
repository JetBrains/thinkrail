import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { WorkspaceRef } from "@thinkrail/ext";
import { createExtHost } from "./index";

const REPO = resolve(import.meta.dir, "../../../..");

interface Drift {
	key: string;
	kind: string;
}

interface Channel {
	root: string;
	status: { state: string };
	graph?: {
		modules: { id: string; files: number }[];
		edges: { from: string; to: string; declared: boolean; structural: boolean; bypass: number }[];
		drift: Drift[];
	};
}

const spec = (id: string, dependsOn: string[] = []) =>
	`---\nid: ${id}\ntype: module-design\nstatus: active\ntitle: ${id} — fixture module\ndepends-on: [${dependsOn.join(", ")}]\n---\n\n## Responsibility\n\nFixture.\n`;

const FIXTURE: Record<string, string> = {
	"packages/core/SPEC.md": spec("core"),
	"packages/core/index.ts": 'export { value } from "./internal";\n',
	"packages/core/internal.ts": "export const value = 1;\n",
	"packages/util/SPEC.md": spec("util"),
	"packages/util/index.ts": "export const util = 2;\n",
	"packages/api/SPEC.md": spec("api", ["core", "util"]),
	"packages/api/index.ts":
		'import { value } from "../core";\nimport { value as raw } from "../core/internal";\n\nexport const api = value + raw;\n',
	"packages/api/api.test.ts": 'import { value } from "../core/internal";\nvoid value;\n',
	"packages/shared/SPEC.md": spec("shared"),
	"packages/shared/package.json": JSON.stringify({
		name: "@fx/shared",
		exports: { ".": "./src/index.ts", "./paths": "./src/paths.ts" },
	}),
	"packages/shared/src/index.ts": "export const shared = 3;\n",
	"packages/shared/src/paths.ts": "export const home = '/';\n",
	"packages/ui/SPEC.md": spec("ui", ["shared"]),
	"packages/ui/index.ts":
		'import { api } from "../api";\nimport { home } from "@fx/shared/paths";\n\nexport const ui = [api, home];\n',
	"tools/orphan.ts": 'import { value } from "../packages/core";\nvoid value;\n',
};

const EXPECTED_DRIFT = [
	"undeclared:ui>api",
	"bypass:packages/api/index.ts>packages/core/internal.ts",
	"unused:api>util",
	"no-spec:tools",
];

let base: string;
let fixture: string;

const writeFixture = (files: Record<string, string>) => {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(fixture, path)), { recursive: true });
		writeFileSync(join(fixture, path), content);
	}
};

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "railmap-ext-")));
	fixture = join(base, "repo");
	writeFixture(FIXTURE);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const workspace = (path: string): WorkspaceRef => ({
	workspaceId: "w1",
	projectId: "p1",
	name: "Default",
	branch: "main",
	path,
});

const makeHost = (root: string) =>
	createExtHost({
		userDir: join(base, "user"),
		storeDir: join(base, "store"),
		sessions: { list: () => [], get: () => undefined, stats: () => ({}) as never },
		workspaces: {
			list: () => [workspace(root)],
			get: (id) => (id === "w1" ? workspace(root) : undefined),
		},
	});

type Host = ReturnType<typeof makeHost>;

const load = async (root = fixture) => {
	const host = makeHost(root);
	await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
	expect(host.get("railmap")).toMatchObject({ status: "active" });
	return host;
};

const channel = (host: Host) =>
	host.snapshot(["railmap:graph:w1"])["railmap:graph:w1"] as Channel | undefined;

const until = async (check: () => boolean, tries = 400) => {
	for (let i = 0; i < tries && !check(); i++) await Bun.sleep(10);
	expect(check()).toBe(true);
};

const watchReady = async (host: Host) => {
	await host.invokeAction({ ext: "railmap", id: "watch", ctx: { workspaceId: "w1" } });
	await until(() => channel(host)?.status.state === "ready");
	const graph = channel(host)?.graph;
	if (!graph) throw new Error("no graph");
	return graph;
};

const driftKeys = (host: Host) =>
	(channel(host)?.graph?.drift ?? []).map((item) => item.key).sort();

interface CapturedPi {
	tools: Map<string, ToolDefinition>;
	handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
}

const capturePi = (host: Host): CapturedPi => {
	const tools = new Map<string, ToolDefinition>();
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) =>
			handlers.set(event, handler),
	};
	for (const factory of host.piFactories()) void factory(pi as unknown as ExtensionAPI);
	return { tools, handlers };
};

const mayImport = async (pi: CapturedPi, from: string, to: string, cwd = fixture) => {
	const tool = pi.tools.get("may_import");
	if (!tool) throw new Error("may_import not registered");
	const result = await tool.execute("c1", { from, to } as never, undefined, undefined, {
		cwd,
	} as never);
	return result.details as { verdict: string; reason: string };
};

describe("railmap example extension", () => {
	test("maps declared, undeclared, bypass, unused, and no-spec drift of a fixture repo", async () => {
		const host = await load();
		const graph = await watchReady(host);
		expect(graph.modules.map((module) => module.id).sort()).toEqual([
			"api",
			"core",
			"shared",
			"ui",
			"util",
		]);
		expect(driftKeys(host)).toEqual([...EXPECTED_DRIFT].sort());
		expect(graph.edges).toContainEqual(
			expect.objectContaining({ from: "api", to: "core", declared: true, bypass: 1 }),
		);
		expect(graph.edges).toContainEqual(
			expect.objectContaining({ from: "ui", to: "shared", declared: true, bypass: 0 }),
		);

		const files = (await host.invokeAction({
			ext: "railmap",
			id: "files",
			payload: { module: "api" },
			ctx: { workspaceId: "w1" },
		})) as { files: { path: string }[] };
		expect(files.files.map((file) => file.path)).toEqual([
			"packages/api/api.test.ts",
			"packages/api/index.ts",
		]);
		const sites = (await host.invokeAction({
			ext: "railmap",
			id: "sites",
			payload: { pairs: [["ui", "api"]] },
			ctx: { workspaceId: "w1" },
		})) as { sites: { file: string; line: number }[]; total: number };
		expect(sites).toMatchObject({ total: 1, sites: [{ file: "packages/ui/index.ts", line: 1 }] });
		await host.dispose();
	});

	test("reparses changed files from the fs watcher", async () => {
		const host = await load();
		await watchReady(host);
		writeFixture({
			"packages/ui/extra.ts": 'import { value } from "../core/internal";\nvoid value;\n',
		});
		await until(() => driftKeys(host).includes("undeclared:ui>core"));
		expect(driftKeys(host)).toContain("bypass:packages/ui/extra.ts>packages/core/internal.ts");
		rmSync(join(fixture, "tools"), { recursive: true });
		await until(() => !driftKeys(host).includes("no-spec:tools"));
		await host.dispose();
	});

	test("may_import answers from the spec graph", async () => {
		const host = await load();
		const pi = capturePi(host);
		expect(await mayImport(pi, "packages/api/index.ts", "core")).toMatchObject({
			verdict: "allowed",
		});
		expect(await mayImport(pi, "ui", "api")).toMatchObject({ verdict: "undeclared" });
		expect(await mayImport(pi, "packages/ui/index.ts", "../core/internal")).toMatchObject({
			verdict: "bypass",
		});
		expect(await mayImport(pi, "packages/ui", "@fx/shared/paths")).toMatchObject({
			verdict: "allowed",
		});
		expect(await mayImport(pi, "nowhere", "core")).toMatchObject({ verdict: "unknown" });
		await host.dispose();
	});

	test("the settle hook appends only drift this run introduced", async () => {
		const host = await load();
		const pi = capturePi(host);
		const ctx = { cwd: fixture };
		const settle = pi.handlers.get("agent_before_settle");
		const start = pi.handlers.get("agent_start");
		if (!settle || !start) throw new Error("hooks missing");
		const boundary = { type: "agent_before_settle", entries: [], continue: false };

		start({ type: "agent_start" }, ctx);
		expect(await settle(boundary, ctx)).toBeUndefined();

		writeFixture({
			"packages/util/index.ts": 'import { ui } from "../ui";\nexport const util = ui;\n',
		});
		pi.handlers.get("tool_result")?.(
			{ type: "tool_result", toolName: "edit", input: { path: "packages/util/index.ts" } },
			ctx,
		);
		const result = (await settle(boundary, ctx)) as {
			entries: { customType: string; details: { items: Drift[] } }[];
		};
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]?.customType).toBe("railmap-drift");
		expect(result.entries[0]?.details.items.map((item) => item.key)).toEqual([
			"undeclared:util>ui",
		]);
		expect(await settle(boundary, ctx)).toBeUndefined();

		pi.handlers.get("agent_settled")?.({ type: "agent_settled" }, ctx);
		start({ type: "agent_start" }, ctx);
		expect(await settle(boundary, ctx)).toBeUndefined();
		await host.dispose();
	});

	test("a reload drops the channel and a new watch brings it back", async () => {
		const host = await load();
		await watchReady(host);
		const stale = capturePi(host);
		await host.reload("railmap");
		expect(channel(host)).toBeUndefined();
		expect(await mayImport(stale, "ui", "api")).toMatchObject({ verdict: "undeclared" });
		expect(channel(host)).toBeUndefined();
		await watchReady(host);
		await host.dispose();
	});

	test("never drops a watched root for other roots", async () => {
		const host = await load();
		await watchReady(host);
		const pi = capturePi(host);
		for (const name of ["o1", "o2", "o3", "o4", "o5"]) {
			const other = join(base, name);
			mkdirSync(join(other, "m"), { recursive: true });
			writeFileSync(join(other, "m/SPEC.md"), spec(name));
			writeFileSync(join(other, "m/index.ts"), "export const m = 1;\n");
			expect(await mayImport(pi, "m", "m", other)).toMatchObject({ verdict: "allowed" });
		}
		expect(channel(host)?.status.state).toBe("ready");
		await host.dispose();
	});

	test("matches touched and absolute paths under a symlinked workspace path", async () => {
		const link = join(base, "link");
		symlinkSync(fixture, link);
		const host = await load(link);
		const pi = capturePi(host);
		const ctx = { cwd: link };
		const settle = pi.handlers.get("agent_before_settle");
		pi.handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
		const boundary = { type: "agent_before_settle", entries: [], continue: false };
		expect(await settle?.(boundary, ctx)).toBeUndefined();
		writeFixture({
			"packages/util/index.ts": 'import { ui } from "../ui";\nexport const util = ui;\n',
		});
		pi.handlers.get("tool_result")?.(
			{ type: "tool_result", toolName: "write", input: { path: "packages/util/index.ts" } },
			ctx,
		);
		const result = (await settle?.(boundary, ctx)) as {
			entries: { details: { items: Drift[]; total: number } }[];
		};
		expect(result.entries[0]?.details).toMatchObject({
			total: 1,
			items: [{ key: "undeclared:util>ui" }],
		});
		expect(
			await mayImport(pi, join(link, "packages/ui/index.ts"), "../core/internal", link),
		).toMatchObject({ verdict: "bypass" });
		await host.dispose();
	});

	test("skips the drift baseline outside workspace checkouts", async () => {
		const host = await load();
		const pi = capturePi(host);
		const ctx = { cwd: join(fixture, "packages") };
		const settle = pi.handlers.get("agent_before_settle");
		const boundary = { type: "agent_before_settle", entries: [], continue: false };
		pi.handlers.get("agent_start")?.({ type: "agent_start" }, ctx);
		expect(await settle?.(boundary, ctx)).toBeUndefined();
		writeFixture({
			"packages/util/index.ts": 'import { ui } from "../ui";\nexport const util = ui;\n',
		});
		pi.handlers.get("tool_result")?.(
			{ type: "tool_result", toolName: "write", input: { path: "util/index.ts" } },
			ctx,
		);
		expect(await settle?.(boundary, ctx)).toBeUndefined();
		await host.dispose();
	});

	test("smoke: builds this repository's own graph", async () => {
		const host = await load(REPO);
		const started = performance.now();
		const graph = await watchReady(host);
		expect(performance.now() - started).toBeLessThan(10_000);
		expect(graph.modules.length).toBeGreaterThan(60);
		expect(graph.modules.find((module) => module.id === "ext-railmap")?.files).toBeGreaterThan(5);
		expect(graph.edges).toContainEqual(
			expect.objectContaining({
				from: "submodule-server-ext",
				to: "module-contracts",
				declared: true,
			}),
		);
		await host.dispose();
	});
});
