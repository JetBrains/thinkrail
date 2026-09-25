import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionInfo, SessionStats } from "@thinkrail/contracts";
import type { SessionRef } from "@thinkrail/ext";
import type { ExtHostOptions } from "./host";
import { createExtHost, projectExtensionsDir } from "./index";
import { parseManifest } from "./manifest";

const SESSION: SessionRef = {
	sessionId: "s1",
	workspaceId: "w1",
	title: "Chat",
	isStreaming: false,
};
const STATS: SessionStats = {
	sessionId: "s1",
	totalMessages: 2,
	tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
	cost: 0.5,
};

const HOST_HALF = `
import { defineExtension } from "@thinkrail/ext";
const trace = (globalThis.__extTrace ??= []);
export default defineExtension((tr) => {
	const tag = "__TAG__";
	trace.push("start:" + tag);
	tr.publish("tag", tag);
	tr.on("agent_settled", (_ev, s) => trace.push("settled:" + tag + ":" + s.sessionId));
	tr.pi(() => {});
	tr.action("echo", async (payload, ctx) => ({ tag, payload, ctx }));
	tr.action("remember", async (payload) => tr.store.set("memo", payload));
	tr.action("recall", () => tr.store.get("memo"));
	tr.action("stats", () => tr.sessions.stats("s1"));
	tr.action("sessions", () => tr.sessions.list());
	tr.every(10, () => trace.push("tick:" + tag));
	tr.log("loaded", tag);
	return () => trace.push("dispose:" + tag);
});
`;

const MANIFEST = {
	name: "demo",
	title: "Demo",
	surfaces: [{ id: "main", slot: "panel" }],
	permissions: ["sessions:read"],
};

const trace = (): string[] => {
	const value: unknown = Reflect.get(globalThis, "__extTrace");
	return Array.isArray(value) ? value.map(String) : [];
};

const clearTrace = () => {
	const value: unknown = Reflect.get(globalThis, "__extTrace");
	if (Array.isArray(value)) value.splice(0);
};

const writeExtension = (root: string, tag: string, body = HOST_HALF, manifest = MANIFEST) => {
	const dir = join(root, manifest.name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "extension.json"), JSON.stringify(manifest));
	writeFileSync(join(dir, "index.ts"), body.replace("__TAG__", tag));
	for (const surface of manifest.surfaces)
		writeFileSync(join(dir, `${surface.id}.tsx`), "export default () => null;\n");
	return dir;
};

const until = async (check: () => boolean) => {
	for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(5);
	expect(check()).toBe(true);
};

let base: string;
let userDir: string;
let storeDir: string;
let events: { changed: ExtensionInfo[]; channels: [string, unknown][]; piChanges: number };

const makeHost = (extra: Partial<ExtHostOptions> = {}) =>
	createExtHost({
		userDir,
		storeDir,
		sessions: {
			list: () => [SESSION],
			get: (id) => (id === "s1" ? SESSION : undefined),
			stats: () => STATS,
		},
		onChanged: (info) => events.changed.push(info),
		onChannel: (key, value) => events.channels.push([key, value]),
		onPiFactoriesChanged: () => {
			events.piChanges++;
		},
		...extra,
	});

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "tr-ext-"));
	userDir = join(base, "extensions");
	storeDir = join(base, "ext-store");
	mkdirSync(userDir, { recursive: true });
	events = { changed: [], channels: [], piChanges: 0 };
	Reflect.set(globalThis, "__extTrace", []);
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

describe("ext host", () => {
	test("loads a user extension and runs its registrations", async () => {
		writeExtension(userDir, "g1");
		const host = makeHost();
		await host.rescan();
		const [info] = host.list();
		expect(info).toMatchObject({
			name: "demo",
			title: "Demo",
			scope: "user",
			status: "active",
			surfaces: [{ id: "main", slot: "panel" }],
			permissions: ["sessions:read"],
		});
		expect(info?.generation).toBeNumber();
		expect(host.piFactories()).toHaveLength(1);
		expect(events.piChanges).toBe(1);
		host.observe({ sessionId: "s1", event: { type: "agent_settled", terminal: null } });
		host.observe({ sessionId: "missing", event: { type: "agent_settled", terminal: null } });
		expect(trace()).toContain("settled:g1:s1");
		expect(trace().filter((line) => line.startsWith("settled"))).toHaveLength(1);
		await until(() => trace().includes("tick:g1"));
		expect(host.logs("demo").some((entry) => entry.message === "loaded g1")).toBe(true);
		await host.dispose();
	});

	test("channels keep the last value, prefixed by extension name", async () => {
		writeExtension(userDir, "g1");
		const host = makeHost();
		await host.rescan();
		expect(host.snapshot()).toEqual({ "demo:tag": "g1" });
		expect(host.snapshot(["demo:tag", "demo:none"])).toEqual({ "demo:tag": "g1" });
		expect(events.channels).toEqual([["demo:tag", "g1"]]);
		writeExtension(userDir, "g2");
		await host.reload("demo");
		expect(host.snapshot()).toEqual({ "demo:tag": "g2" });
		await host.dispose();
		expect(host.snapshot()).toEqual({});
	});

	test("unpublish drops one key from the snapshot and tells clients", async () => {
		writeExtension(
			userDir,
			"g1",
			HOST_HALF.replace(
				'tr.publish("tag", tag);',
				'tr.publish("tag", tag); tr.publish("early", 1); tr.unpublish("early"); tr.publish("later", 2); tr.action("forget", () => tr.unpublish("later"));',
			),
		);
		const dropped: [string, string[]][] = [];
		const host = makeHost({ onChannelsDropped: (name, keys) => dropped.push([name, keys]) });
		await host.rescan();
		expect(host.snapshot()).toEqual({ "demo:tag": "g1", "demo:later": 2 });
		await host.invokeAction({ ext: "demo", id: "forget", payload: undefined, ctx: {} });
		expect(host.snapshot()).toEqual({ "demo:tag": "g1" });
		expect(dropped).toEqual([["demo", ["demo:later"]]]);
		await host.invokeAction({ ext: "demo", id: "forget", payload: undefined, ctx: {} });
		expect(dropped).toHaveLength(1);
		await host.dispose();
	});

	test("actions round trip payload, context, and session reads", async () => {
		writeExtension(userDir, "g1");
		const host = makeHost();
		await host.rescan();
		expect(
			await host.invokeAction({
				ext: "demo",
				id: "echo",
				payload: { n: 1 },
				ctx: { sessionId: "s1" },
			}),
		).toEqual({ tag: "g1", payload: { n: 1 }, ctx: { sessionId: "s1" } });
		expect(await host.invokeAction({ ext: "demo", id: "stats" })).toEqual(STATS);
		expect(await host.invokeAction({ ext: "demo", id: "sessions" })).toEqual([SESSION]);
		expect(host.invokeAction({ ext: "demo", id: "nope" })).rejects.toThrow('has no action "nope"');
		expect(host.invokeAction({ ext: "ghost", id: "echo" })).rejects.toThrow("not loaded");
		await host.dispose();
	});

	test("a failed reload keeps the old generation running", async () => {
		const dir = writeExtension(userDir, "g1");
		const host = makeHost();
		await host.rescan();
		const first = host.get("demo")?.generation;
		writeFileSync(
			join(dir, "index.ts"),
			`${HOST_HALF.replace("__TAG__", "g2")}\nthrow new Error("boom");`,
		);
		const failed = await host.reload("demo");
		expect(failed.status).toBe("error");
		expect(failed.error).toContain("boom");
		expect(failed.generation).toBe(first ?? null);
		expect((await host.invokeAction({ ext: "demo", id: "echo" })) as { tag: string }).toMatchObject(
			{
				tag: "g1",
			},
		);

		writeFileSync(
			join(dir, "index.ts"),
			HOST_HALF.replace("__TAG__", "g3").replace(
				'tr.log("loaded", tag);',
				'throw new Error("factory");',
			),
		);
		const threw = await host.reload("demo");
		expect(threw).toMatchObject({ status: "error", generation: first });
		expect(threw.error).toContain("factory threw: factory");
		expect(trace()).not.toContain("dispose:g1");
		await Bun.sleep(30);
		expect(trace()).not.toContain("tick:g3");
		expect(host.snapshot()).toEqual({ "demo:tag": "g1" });

		writeFileSync(
			join(dir, "extension.json"),
			JSON.stringify({ ...MANIFEST, surfaces: [{ id: "main", slot: "pannel" }] }),
		);
		const invalid = await host.reload("demo");
		expect(invalid.error).toBe(
			'surfaces[0].slot "pannel" unknown; allowed: tab, panel, status, toolCard, message',
		);
		expect(invalid.generation).toBe(first ?? null);
		await host.dispose();
	});

	test("reloading a deleted extension unloads it", async () => {
		const dir = writeExtension(userDir, "g1");
		const removed: string[] = [];
		const host = makeHost({ onRemoved: (name) => removed.push(name) });
		await host.rescan();
		rmSync(dir, { recursive: true, force: true });
		expect(host.reload("demo")).rejects.toThrow('extension "demo" not found');
		await until(() => removed.includes("demo"));
		expect(host.get("demo")).toBeUndefined();
		expect(host.snapshot()).toEqual({});
		await host.dispose();
	});

	test("a successful reload disposes every registration of the old generation", async () => {
		writeExtension(userDir, "g1");
		const host = makeHost();
		await host.rescan();
		const [oldFactory] = host.piFactories();
		writeExtension(userDir, "g2");
		const next = await host.reload("demo");
		expect(next.status).toBe("active");
		expect(trace()).toContain("dispose:g1");
		expect(host.piFactories()).toHaveLength(1);
		expect(host.piFactories()[0]).not.toBe(oldFactory);
		expect(events.piChanges).toBe(2);

		clearTrace();
		host.observe({ sessionId: "s1", event: { type: "agent_settled", terminal: null } });
		expect(trace()).toEqual(["settled:g2:s1"]);
		await until(() => trace().includes("tick:g2"));
		expect(trace().some((line) => line === "tick:g1")).toBe(false);
		expect(await host.invokeAction({ ext: "demo", id: "echo" })).toMatchObject({ tag: "g2" });

		await host.dispose();
		expect(trace()).toContain("dispose:g2");
		expect(host.piFactories()).toEqual([]);
		clearTrace();
		await Bun.sleep(30);
		expect(trace()).toEqual([]);
	});

	test("a reload that drops tr.pi and a channel key refreshes sessions and the snapshot", async () => {
		writeExtension(userDir, "g1");
		const host = makeHost();
		await host.rescan();
		expect(events.piChanges).toBe(1);
		writeExtension(
			userDir,
			"g2",
			HOST_HALF.replace("tr.pi(() => {});", "").replace(
				'tr.publish("tag", tag);',
				'tr.publish("other", tag);',
			),
		);
		await host.reload("demo");
		expect(host.piFactories()).toEqual([]);
		expect(events.piChanges).toBe(2);
		expect(host.snapshot()).toEqual({ "demo:other": "g2" });
		await host.dispose();
	});

	test("overlapping rescans settle on the latest project roots", async () => {
		const project = join(base, "repo");
		writeExtension(projectExtensionsDir(project), "p1");
		const host = makeHost();
		await Promise.all([
			host.setProjectRoots([{ projectId: "p", path: project }]),
			host.setProjectRoots([]),
		]);
		expect(host.list()).toEqual([]);
		await host.dispose();
	});

	test("the store persists across hosts under the store dir", async () => {
		writeExtension(userDir, "g1");
		const first = makeHost();
		await first.rescan();
		await first.invokeAction({ ext: "demo", id: "remember", payload: { count: 3 } });
		await first.dispose();
		expect(JSON.parse(readFileSync(join(storeDir, "demo.json"), "utf8"))).toEqual({
			memo: { count: 3 },
		});

		const second = makeHost();
		await second.rescan();
		expect(await second.invokeAction({ ext: "demo", id: "recall" })).toEqual({ count: 3 });
		await second.dispose();
	});

	test("project extensions load only for trusted roots and unload when untrusted", async () => {
		const project = join(base, "repo");
		writeExtension(projectExtensionsDir(project), "p1");
		const host = makeHost();
		await host.rescan();
		expect(host.list()).toEqual([]);

		await host.setProjectRoots([{ projectId: "p", path: project }]);
		expect(host.get("demo")).toMatchObject({ scope: "project", projectId: "p", status: "active" });
		expect(host.snapshot()).toEqual({ "demo:tag": "p1" });

		await host.setProjectRoots([]);
		expect(host.list()).toEqual([]);
		expect(host.snapshot()).toEqual({});
		expect(trace()).toContain("dispose:p1");
		expect(events.piChanges).toBe(2);
		await host.dispose();
	});

	test("a user extension shadows a project one with the same name", async () => {
		const project = join(base, "repo");
		writeExtension(projectExtensionsDir(project), "p1");
		writeExtension(userDir, "u1");
		const warnings: string[] = [];
		const host = makeHost({ warn: (message) => warnings.push(message) });
		await host.setProjectRoots([{ projectId: "p", path: project }]);
		expect(host.get("demo")?.scope).toBe("user");
		expect(warnings.some((message) => message.includes("skipped"))).toBe(true);
		await host.dispose();
	});

	test("a directory without index.ts or view files fails with actionable errors", async () => {
		const dir = join(userDir, "demo");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "extension.json"), JSON.stringify(MANIFEST));
		const host = makeHost();
		await host.rescan();
		expect(host.get("demo")).toMatchObject({ status: "error", generation: null });
		expect(host.get("demo")?.error).toBe(
			"index.ts is missing (the host half)\nsurfaces[0]: view file main.tsx is missing",
		);
		expect(existsSync(storeDir)).toBe(false);
		await host.dispose();
	});
});

describe("parseManifest", () => {
	test("reports schema and slot-specific errors with paths", () => {
		const result = parseManifest({
			name: "Bad Name",
			surfaces: [{ id: "a", slot: "toolCard" }, { id: "a", slot: "message" }, { slot: "tab" }],
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toContain('name: must match pattern "^[a-z][a-z0-9-]*$"');
		expect(result.errors).toContain("surfaces[2]: must have required properties id");

		const slots = parseManifest({
			name: "ok",
			surfaces: [
				{ id: "a", slot: "toolCard" },
				{ id: "a", slot: "message" },
			],
		});
		expect(slots).toEqual({
			ok: false,
			errors: [
				'surfaces[0].tool is required for slot "toolCard" (the tool name it renders)',
				'surfaces[1].id "a" is duplicated',
				'surfaces[1].customType is required for slot "message" (the custom message type it renders)',
			],
		});
	});

	test("defaults title and permissions", () => {
		expect(parseManifest({ name: "ok", surfaces: [{ id: "t", slot: "tool", tool: "x" }] }).ok).toBe(
			false,
		);
		expect(
			parseManifest({ name: "ok", surfaces: [{ id: "t", slot: "toolCard", tool: "x" }] }),
		).toEqual({
			ok: true,
			manifest: {
				name: "ok",
				title: "ok",
				surfaces: [{ id: "t", slot: "toolCard", tool: "x" }],
				permissions: [],
			},
		});
	});
});
