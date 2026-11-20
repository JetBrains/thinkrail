import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { WorkspaceFiles } from "@thinkrail/extension-api/server";
import outputs from "./index";
import { createPresentFilesExtension, publishedPaths, publishFiles } from "./presentFiles";

let root: string;

async function check(path: string, cwd: string): Promise<void> {
	if (path.startsWith("/") || path.startsWith("..")) throw new Error("outside the workspace");
	const info = statSync(join(cwd, path), { throwIfNoEntry: false });
	if (!info) throw new Error("no such file");
	if (!info.isFile()) throw new Error("not a regular file");
}

const files: WorkspaceFiles = {
	check,
	async checkArtifact(path, cwd) {
		const rel = relative(cwd, resolve(cwd, path)).split(sep).join("/");
		if (!rel.startsWith(".thinkrail/context/"))
			throw new Error("it is not inside the artifacts folder");
		if (rel.split("/").includes("dist"))
			throw new Error("Artifacts does not list what is in `dist`");
		await check(rel, cwd);
		return rel;
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
	mkdirSync(join(root, ".thinkrail/context/mockups/dist"), { recursive: true });
	writeFileSync(join(root, ".thinkrail/context/mockups/dist/index.html"), "<p>");
	writeFileSync(join(root, "README.md"), "# readme");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a file inside the artifacts folder is published by any path form, each once, as the host names it", async () => {
	const details = await publishFiles(
		[
			".thinkrail/context/report.md",
			"report.md",
			"./report.md",
			"@mockups/checkout.html",
			".thinkrail/context/mockups/../report.md",
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

test("a path the host cannot list publishes nothing, and each refusal says why", async () => {
	const call = publishFiles(
		[
			"report.md",
			"README.md",
			"missing.md",
			"mockups",
			"mockups/dist/index.html",
			".thinkrail/context/../README.md",
		],
		root,
		files,
	);
	await expect(call).rejects.toThrow(/nothing was published/);
	const message = await call.catch((error: Error) => error.message);
	expect(message).not.toContain("- report.md");
	expect(message).toContain("- README.md: it is not inside the artifacts folder");
	expect(message).toContain("- missing.md: no such file");
	expect(message).toContain("- mockups: not a regular file");
	expect(message).toContain("- mockups/dist/index.html: Artifacts does not list what is in `dist`");
	expect(message).toContain(
		"- .thinkrail/context/../README.md: it is not inside the artifacts folder",
	);
	expect(message).toContain("Save each deliverable inside `.thinkrail/context/`");
	await expect(publishFiles([join(root, "README.md")], root, files)).rejects.toThrow(
		"it is not inside the artifacts folder",
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
