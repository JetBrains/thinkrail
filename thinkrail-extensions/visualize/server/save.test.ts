import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionSessionServices } from "@thinkrail/extension-api/server";
import extension from "./index";
import { visualizationSaver, visualizationSlug, visualizationStamp } from "./save";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "trpi-visualize-save-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

const at = new Date(2026, 10, 13, 9, 5, 7);

test("names a saved visualization by its time and title", () => {
	expect(visualizationStamp(at)).toBe("20261113-090507");
	expect(visualizationSlug({ type: "diagram", title: "Auth flow: v2!" })).toBe("auth-flow-v2");
	expect(visualizationSlug({ type: "diagram", title: "Поток входа" })).toBe("поток-входа");
	expect(visualizationSlug({ type: "comparison" })).toBe("comparison");
});

test("asks the host to prepare the artifacts folder, then writes a new file per visualization and never overwrites one", async () => {
	const prepared: string[] = [];
	const save = visualizationSaver(
		".thinkrail/context/visualize/",
		async (dir) => {
			prepared.push(dir);
		},
		() => at,
	);
	const params = { type: "diagram" as const, title: "Flow", mermaid: "flowchart LR\n A --> B" };
	const first = await save({ params, markdown: "one", cwd });
	const second = await save({ params, markdown: "two", cwd });
	expect(first).toBe(".thinkrail/context/visualize/20261113-090507-flow.md");
	expect(second).toBe(".thinkrail/context/visualize/20261113-090507-flow-2.md");
	expect(readFileSync(join(cwd, first as string), "utf8")).toBe("one\n");
	expect(readFileSync(join(cwd, second as string), "utf8")).toBe("two\n");
	expect(prepared).toEqual([cwd, cwd]);
});

test("the server half saves diagrams into the workspace's artifacts folder", async () => {
	const session: ExtensionSessionServices = {
		expectToolResponse: () => {},
		awaitToolResponse: async () => ({ kind: "deferred" }),
		setting: () => false,
		workspaceFiles: {
			check: async () => {},
			scratchDir: ".thinkrail/context/mockups/",
			artifactsDir: ".thinkrail/context/",
			ensureArtifactsDir: async (dir) => {
				mkdirSync(join(dir, ".thinkrail", "context"), { recursive: true });
				writeFileSync(join(dir, ".thinkrail", "context", ".gitignore"), "*\n");
			},
		},
	};
	let execute:
		| ((
				id: string,
				params: unknown,
				s?: unknown,
				u?: unknown,
				ctx?: { cwd: string },
		  ) => Promise<{
				content: Array<{ text: string }>;
		  }>)
		| undefined;
	const factory = extension.sessionExtensions?.(session)[0];
	factory?.({
		registerTool: (tool: { execute: typeof execute }) => {
			execute = tool.execute;
		},
	} as unknown as ExtensionAPI);
	const result = await execute?.(
		"id",
		{ type: "diagram", title: "Flow", mermaid: "flowchart LR\n A --> B" },
		undefined,
		undefined,
		{ cwd },
	);
	const [saved] = readdirSync(join(cwd, ".thinkrail", "context", "visualize"));
	expect(saved).toEndWith("-flow.md");
	expect(result?.content[0]?.text).toContain(`Saved to \`.thinkrail/context/visualize/${saved}\`.`);
	expect(
		readFileSync(join(cwd, ".thinkrail", "context", "visualize", saved as string), "utf8"),
	).toContain("```mermaid");
});
