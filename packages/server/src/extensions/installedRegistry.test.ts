import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	builtinServerExtensions,
	extensionSkillRoots,
	installedExtensions,
	interactiveTools,
	listExtensionCatalog,
	registryExtensionName,
	registryInlineExtensions,
	resolveExtensionSkillRoots,
	serverExtensions,
	startInstalledExtensions,
} from "./index";
import { tempDir, writeExtension } from "./installed/testFixtures";

const SESSION_DESCRIPTOR = `import { Type } from "typebox";
export default {
	name: "session-ext",
	description: "From the descriptor",
	extensions: [],
	interactiveTools: { ask_later: {} },
	settings: { loud: { type: "boolean", default: false, title: "Loud", description: "Shout" } },
	skillPackages: ["session-skills"],
	sessionExtensions: (session) => [
		(pi) => {
			pi.registerTool({
				name: session.setting("loud") ? "loud_tool" : "quiet_tool",
				label: "x",
				description: "x",
				parameters: Type.Object({}),
				async execute() {
					return { content: [], details: {} };
				},
			});
		},
	],
};
`;

let stop: (() => void) | undefined;
let root: string | undefined;

afterEach(() => {
	stop?.();
	stop = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

async function installed(): Promise<{ folder: string; failed: string; dataDir: string }> {
	root = tempDir();
	const dataDir = join(root, "data");
	mkdirSync(dataDir);
	const folder = writeExtension(join(root, "session-ext"), {
		name: "session-ext",
		web: "dist/web.js",
		manifest: { title: "Session extension" },
		files: { "server/index.ts": SESSION_DESCRIPTOR },
	});
	const skills = join(folder, "node_modules", "session-skills");
	mkdirSync(join(skills, "skills", "demo"), { recursive: true });
	writeFileSync(
		join(skills, "package.json"),
		JSON.stringify({ name: "session-skills", pi: { skills: ["./skills"] } }),
	);
	const failed = writeExtension(join(root, "broken"), {
		name: "broken-ext",
		files: { "server/index.ts": 'throw new Error("boom");\n' },
	});
	const reserved = writeExtension(join(root, "reserved"), { name: "visualize" });
	writeFileSync(
		join(dataDir, "extensions.json"),
		JSON.stringify({ extensions: [folder, failed, reserved] }),
	);
	stop = startInstalledExtensions({ dataDir, onChange: () => {} });
	await installedExtensions()?.reconcile();
	return { folder, failed, dataDir };
}

describe("the runtime registry", () => {
	it("is the built-ins alone without installed extensions", () => {
		expect(serverExtensions()).toBe(builtinServerExtensions);
	});

	it("lists built-ins first, then the loaded installed extensions, as a stable array", async () => {
		const { folder } = await installed();
		const entries = serverExtensions();
		expect(entries.map((entry) => entry.extension.name)).toEqual([
			"visualize",
			"ask-user-question",
			"web-access",
			"session-ext",
		]);
		expect(serverExtensions()).toBe(entries);
		expect(entries.at(-1)?.specifier).toBe(join(folder, "server", "index.ts"));
		stop?.();
		stop = undefined;
		expect(serverExtensions()).toBe(builtinServerExtensions);
	});

	it("writes the status file with the tool names the catalog lists", async () => {
		const { folder, failed, dataDir } = await installed();
		const status = JSON.parse(readFileSync(join(dataDir, "extensions", "status.json"), "utf8"));
		expect(status.extensions.map((entry: { source: string }) => entry.source)).toEqual([
			folder,
			failed,
			expect.stringContaining("reserved"),
		]);
		expect(status.extensions[0]).toMatchObject({ state: "loaded", tools: ["quiet_tool"] });
		expect(status.extensions[1]).toMatchObject({ state: "failed" });
	});

	it("reports installed rows with their kind, state, source, copy and web half", async () => {
		const { folder, failed } = await installed();
		const catalog = await listExtensionCatalog(new Set(["session-ext"]));
		expect(catalog.slice(0, 3).map((entry) => entry.kind)).toEqual([
			"builtin",
			"builtin",
			"builtin",
		]);
		const [loaded, broken, reserved] = catalog.slice(3);
		expect(loaded).toEqual({
			name: "session-ext",
			title: "Session extension",
			description: "A fixture extension",
			enabled: false,
			tools: ["quiet_tool"],
			hasChildExtensions: false,
			settings: [{ key: "loud", default: false, title: "Loud", description: "Shout" }],
			kind: "installed",
			source: folder,
			version: "1.0.0",
			state: "loaded",
			web: {
				url: expect.stringMatching(
					/^\/extensions\/session-ext\/1\.0\.0-[0-9a-f]{12}\/dist\/web\.js$/,
				),
			},
		});
		expect(broken).toMatchObject({
			name: "broken-ext",
			enabled: true,
			tools: [],
			kind: "installed",
			source: failed,
			state: "failed",
			error: expect.stringContaining("boom"),
		});
		expect(broken).not.toHaveProperty("web");
		expect(reserved).toMatchObject({ state: "failed", error: expect.stringContaining("built-in") });
	});

	it("composes an installed extension like a built-in: inline name, switch, settings, interactive tools", async () => {
		await installed();
		const host = {
			expectToolResponse: () => {},
			awaitToolResponse: () => Promise.resolve({ kind: "deferred" as const }),
			workspaceFiles: { check: async () => {}, scratchDir: "" },
		};
		const tools: string[] = [];
		const pi = {
			registerTool: (tool: { name: string }) => tools.push(tool.name),
		} as unknown as ExtensionAPI;
		const inline = registryInlineExtensions(
			"extensions",
			(name) => name === "web-access",
			undefined,
			host,
			(extension, key) => (extension === "session-ext" && key === "loud" ? true : undefined),
		);
		const own = inline.find((entry) => typeof entry !== "function" && entry.name === "session-ext");
		if (!own || typeof own === "function") throw new Error("session-ext is not composed");
		await own.factory(pi);
		expect(tools).toEqual(["loud_tool"]);
		expect(registryExtensionName("<inline:session-ext>")).toBe("session-ext");
		expect(interactiveTools(() => false).has("ask_later")).toBe(true);
		expect(interactiveTools((name) => name === "session-ext").has("ask_later")).toBe(false);
		const off = registryInlineExtensions(
			"extensions",
			(name) => name === "session-ext",
			undefined,
			host,
		);
		const disabled = off.find(
			(entry) => typeof entry !== "function" && entry.name === "session-ext",
		);
		if (!disabled || typeof disabled === "function") throw new Error("session-ext is not composed");
		tools.length = 0;
		await disabled.factory(pi);
		expect(tools).toEqual([]);
	});

	it("resolves an installed extension's skill roots from its own entry, never a staged folder", async () => {
		const { folder } = await installed();
		const entry = serverExtensions().at(-1);
		if (!entry) throw new Error("no installed entry");
		const roots = [join(folder, "node_modules", "session-skills", "skills")];
		expect(resolveExtensionSkillRoots(entry)).toEqual(roots);
		expect(extensionSkillRoots(entry, "/staged/skills")).toEqual(roots);
	});
});
