import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { WorkspaceFiles } from "@thinkrail/extension-api/server";
import outputs from "./index";
import { createPresentFilesExtension, publishedPaths, publishFiles } from "./presentFiles";

let root: string;

const files: WorkspaceFiles = {
	async check(path, cwd) {
		if (path.startsWith("/") || path.startsWith("..")) throw new Error("outside the workspace");
		const info = statSync(join(cwd, path), { throwIfNoEntry: false });
		if (!info) throw new Error("no such file");
		if (!info.isFile()) throw new Error("not a regular file");
	},
	ensureArtifactsDir: async () => {},
	scratchDir: ".thinkrail/context/mockups/",
	artifactsDir: ".thinkrail/context/",
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ext-outputs-"));
	mkdirSync(join(root, ".thinkrail/context/mockups"), { recursive: true });
	writeFileSync(join(root, ".thinkrail/context/report.md"), "# r");
	writeFileSync(join(root, ".thinkrail/context/mockups/checkout.html"), "<p>");
	writeFileSync(join(root, "README.md"), "# readme");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a file inside the artifacts folder is published by any path form, each once", async () => {
	const details = await publishFiles(
		[
			".thinkrail/context/report.md",
			"report.md",
			"@mockups/checkout.html",
			join(root, ".thinkrail/context/mockups/checkout.html"),
		],
		root,
		files,
	);
	expect(details.files).toEqual([
		".thinkrail/context/report.md",
		".thinkrail/context/mockups/checkout.html",
	]);
});

test("a path outside the artifacts folder or a missing file publishes nothing and says why", async () => {
	const call = publishFiles(["report.md", "README.md", "missing.md", "mockups"], root, files);
	await expect(call).rejects.toThrow(/nothing was published/);
	const message = await call.catch((error: Error) => error.message);
	expect(message).not.toContain("- report.md");
	expect(message).toContain("- README.md: no such file");
	expect(message).toContain("- missing.md: no such file");
	expect(message).toContain("- mockups: not a regular file");
	expect(message).toContain("Save each deliverable inside `.thinkrail/context/`");
	await expect(publishFiles([join(root, "README.md")], root, files)).rejects.toThrow(
		"it is not inside `.thinkrail/context/`",
	);
});

test("the published paths come from the result details only", () => {
	expect(publishedPaths({ filepaths: ["x.md"] }, { files: ["a.md", 3, "b.html"] })).toEqual([
		"a.md",
		"b.html",
	]);
	expect(publishedPaths({}, undefined)).toEqual([]);
	expect(outputs.artifactTools?.present_files?.published).toBe(publishedPaths);
});

test("the tool is registered with its guidance naming the artifacts folder", async () => {
	const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = [];
	createPresentFilesExtension(files)({
		registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => tools.push(tool),
	} as unknown as ExtensionAPI);
	const [tool] = tools;
	expect(tool?.name).toBe("present_files");
	expect(tool?.promptGuidelines?.join("\n")).toContain("`.thinkrail/context/`");
	const result = await tool?.execute("c1", { filepaths: ["report.md"] }, undefined, undefined, {
		cwd: root,
	} as unknown as ExtensionToolContext);
	expect(result?.details).toEqual({ files: [".thinkrail/context/report.md"] });
});
