import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ExtensionInfo } from "@thinkrail/contracts";
import { projectExtensionsDir } from "./discovery";
import { createExtDevTools, createExtHost, EXT_SDK_GUIDE } from "./index";
import { changedExtension } from "./watch";

const hostHalf = (tag: string) => `
import { defineExtension } from "@thinkrail/ext";
const trace = (globalThis.__devTrace ??= []);
export default defineExtension((tr) => {
	trace.push("start:${tag}");
	tr.publish("tag", "${tag}");
	tr.log("hello ${tag}");
	return () => trace.push("dispose:${tag}");
});
`;

const storeHalf = `
import { defineExtension } from "@thinkrail/ext";
export default defineExtension(async (tr) => {
	const count = (await tr.store.get("count")) ?? 0;
	await tr.store.set("count", count + 1);
	tr.log(\`count \${count}\`);
});
`;

const trace = (): string[] => {
	const value: unknown = Reflect.get(globalThis, "__devTrace");
	return Array.isArray(value) ? value.map(String) : [];
};

let base: string;
let userDir: string;
let changed: ExtensionInfo[];
let channels: string[];

const writeExtension = ({
	name = "hello",
	tag = "g1",
	slot = "panel",
	root = userDir,
	title,
}: {
	name?: string;
	tag?: string;
	slot?: string;
	root?: string;
	title?: string;
} = {}) => {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "extension.json"),
		JSON.stringify({ name, ...(title ? { title } : {}), surfaces: [{ id: "main", slot }] }),
	);
	writeFileSync(join(dir, "index.ts"), hostHalf(tag));
	writeFileSync(join(dir, "main.tsx"), "export default () => null;\n");
	return dir;
};

const makeHost = (watchDebounceMs?: number) =>
	createExtHost({
		userDir,
		storeDir: join(base, "ext-store"),
		sessions: { list: () => [], get: () => undefined, stats: () => ({}) as never },
		onChanged: (info) => changed.push(info),
		onChannel: (key) => channels.push(key),
		...(watchDebounceMs !== undefined ? { watchDebounceMs } : {}),
	});

const until = async (check: () => boolean, tries = 400) => {
	for (let i = 0; i < tries && !check(); i++) await Bun.sleep(10);
	expect(check()).toBe(true);
};

interface CapturedTool {
	execute: (params: Record<string, unknown>) => Promise<{
		content: { type: string; text: string }[];
	}>;
}

const captureDevTools = (host: ReturnType<typeof makeHost>) => {
	const tools = new Map<string, CapturedTool>();
	const handlers = new Map<string, (event: unknown) => void>();
	const pi = {
		registerTool: (tool: ToolDefinition) =>
			tools.set(tool.name, {
				execute: (params) =>
					tool.execute("call", params as never, undefined, undefined, {} as never) as never,
			}),
		on: (event: string, handler: (event: unknown) => void) => handlers.set(event, handler),
	};
	void createExtDevTools({ host, docsPath: "/docs/README.md" })(pi as unknown as ExtensionAPI);
	const tool = (name: string) => {
		const found = tools.get(name);
		if (!found) throw new Error(`tool ${name} not registered`);
		return found;
	};
	return { tool, tools, handlers };
};

const resultText = (result: { content: { text: string }[] }) =>
	result.content.map((part) => part.text).join("\n");

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "tr-ext-dev-"));
	userDir = join(base, "extensions");
	mkdirSync(userDir, { recursive: true });
	changed = [];
	channels = [];
	Reflect.set(globalThis, "__devTrace", []);
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("validate", () => {
	test("dry-loads an undiscovered extension without registering or publishing it", async () => {
		writeExtension();
		const host = makeHost();
		const result = await host.validate("hello");
		expect(result).toMatchObject({ ok: true, surfaces: [{ id: "main", slot: "panel" }] });
		expect(trace()).toEqual(["start:g1", "dispose:g1"]);
		expect(host.list()).toEqual([]);
		expect(changed).toEqual([]);
		expect(channels).toEqual([]);
		await host.dispose();
	});

	test("reports actionable manifest errors and never swaps the running generation", async () => {
		writeExtension();
		const host = makeHost();
		await host.rescan();
		const running = host.get("hello");
		writeExtension({ tag: "g2", slot: "pannel" });
		const result = await host.validate("hello");
		expect(result.ok).toBe(false);
		expect(result.ok ? [] : result.errors).toContain(
			'surfaces[0].slot "pannel" unknown; allowed: tab, panel, status, toolCard, message',
		);
		expect(host.get("hello")).toEqual(running);
		await host.dispose();
	});

	test("isolates the dry run's store writes and log lines from the running version", async () => {
		const dir = writeExtension();
		writeFileSync(join(dir, "index.ts"), storeHalf);
		const host = makeHost();
		await host.rescan();
		const storeFile = join(base, "ext-store", "hello.json");
		const persisted = readFileSync(storeFile, "utf8");
		expect(JSON.parse(persisted)).toEqual({ count: 1 });
		const ring = host.logs("hello").length;

		const result = await host.validate("hello");
		expect(result).toMatchObject({ ok: true, logs: ["info count 1"] });
		expect(readFileSync(storeFile, "utf8")).toBe(persisted);
		expect(host.logs("hello")).toHaveLength(ring);
		await host.dispose();
	});

	test("does not create a store for an undiscovered extension", async () => {
		writeFileSync(join(writeExtension({ name: "fresh" }), "index.ts"), storeHalf);
		const host = makeHost();
		expect(await host.validate("fresh")).toMatchObject({ ok: true, logs: ["info count 0"] });
		expect(existsSync(join(base, "ext-store", "fresh.json"))).toBe(false);
		expect(host.logs("fresh")).toEqual([]);
		await host.dispose();
	});

	test("names the searched directories for an unknown extension", async () => {
		const host = makeHost();
		const result = await host.validate("ghost");
		expect(result.ok ? [] : result.errors).toEqual([
			expect.stringContaining(`${join(userDir, "ghost")}/extension.json`),
		]);
		await host.dispose();
	});
});

describe("watcher", () => {
	test("maps changed paths to extension names and ignores node_modules", () => {
		expect(changedExtension("hello/main.tsx")).toBe("hello");
		expect(changedExtension("hello")).toBe("hello");
		expect(changedExtension("hello/node_modules/x/index.js")).toBeUndefined();
		expect(changedExtension("hello/.git/HEAD")).toBeUndefined();
		expect(changedExtension(null)).toBeUndefined();
	});

	test("reloads a changed extension and loads a new one, then stops on dispose", async () => {
		writeExtension();
		const host = makeHost(30);
		await host.rescan();
		const first = host.get("hello")?.generation;
		writeExtension({ tag: "g2" });
		await until(() => (host.get("hello")?.generation ?? 0) > (first ?? 0));
		expect(trace()).toContain("start:g2");

		writeExtension({ name: "fresh", tag: "f1" });
		await until(() => host.get("fresh")?.status === "active");

		renameSync(join(userDir, "fresh"), join(base, "moved-out"));
		await until(() => host.get("fresh") === undefined);
		renameSync(join(base, "moved-out"), join(userDir, "fresh"));
		await until(() => host.get("fresh")?.status === "active");

		await host.dispose();
		const count = trace().length;
		writeExtension({ tag: "g3" });
		await Bun.sleep(150);
		expect(trace()).toHaveLength(count);
	});

	test("a change in an untrusted copy refreshes only its blocked entry", async () => {
		writeExtension();
		const project = join(base, "repo");
		const root = projectExtensionsDir(project);
		writeExtension({ root, tag: "b1", title: "b1" });
		const host = makeHost(30);
		await host.setProjectRoots([], [{ projectId: "p", path: project }]);
		const generation = host.get("hello")?.generation;
		writeExtension({ root, tag: "b2", title: "b2" });
		await until(() => host.list().some((info) => info.status === "blocked" && info.title === "b2"));
		expect(host.get("hello")?.generation).toBe(generation);
		expect(trace()).toEqual(["start:g1"]);
		await host.dispose();
	});
});

describe("agent dev tools", () => {
	test("ext_validate, ext_reload, and ext_logs report through tool results", async () => {
		writeExtension();
		const host = makeHost();
		const { tool } = captureDevTools(host);

		const valid = resultText(await tool("ext_validate").execute({ name: "hello" }));
		expect(valid).toContain("hello: valid");

		const reloaded = resultText(await tool("ext_reload").execute({ name: "hello" }));
		expect(reloaded).toMatch(/^hello: active \(generation \d+/);
		expect(host.get("hello")?.status).toBe("active");

		const logs = resultText(await tool("ext_logs").execute({ name: "hello" }));
		expect(logs).toContain("info hello g1");

		const after = Date.now() + 1;
		const empty = resultText(await tool("ext_logs").execute({ name: "hello", since: after }));
		expect(empty).toContain("(no log entries)");
		await host.dispose();
	});

	test("ext_reload reports a failed load and keeps the old generation running", async () => {
		writeExtension();
		const host = makeHost();
		await host.rescan();
		const running = host.get("hello");
		const { tool } = captureDevTools(host);
		writeFileSync(join(userDir, "hello", "main.tsx"), "export default () => <div>{</div>;\n");
		await expect(tool("ext_validate").execute({ name: "hello" })).rejects.toThrow(
			/hello: invalid\n- view build failed:\n {2}main\.tsx:1:\d+: /,
		);
		const failure = tool("ext_reload").execute({ name: "hello" });
		await expect(failure).rejects.toThrow(
			/hello: error \(generation \d+, build [^)]+\)\nerror:\nview build failed:\nmain\.tsx:1:\d+: /,
		);
		expect(host.get("hello")).toMatchObject({
			status: "error",
			generation: running?.generation,
			build: running?.build,
		});
		await expect(tool("ext_validate").execute({ name: "ghost" })).rejects.toThrow("not found");
		await expect(tool("ext_logs").execute({ name: "ghost" })).rejects.toThrow("not loaded");
		await host.dispose();
	});

	test("before_agent_start adds a short pointer to the guide and the tools", async () => {
		const host = makeHost();
		await host.setProjectRoots([
			{ projectId: "a", path: join(base, "a") },
			{ projectId: "b", path: join(base, "b") },
		]);
		const { handlers } = captureDevTools(host);
		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		handlers.get("before_agent_start")?.(event);
		const section = event.systemPromptOptions.sections["thinkrail-extensions"] ?? "";
		expect(section).toContain("/docs/README.md");
		expect(section).toContain(`${userDir}/<name>/`);
		expect(section).toContain("<project>/.thinkrail/extensions/<name>/");
		expect(section).not.toContain(join(base, "a"));
		expect(section).toContain("ext_validate");
		expect(section.split("\n").length).toBeLessThanOrEqual(5);
		expect(EXT_SDK_GUIDE).toContain("# Writing a ThinkRail UI extension");
		await host.dispose();
	});
});
