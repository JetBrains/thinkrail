import { describe, expect, it } from "bun:test";
import type { ArtifactTool } from "@thinkrail/extension-api/server";
import { artifactTools } from "./artifactTools";
import type { ServerExtensionEntry } from "./registry";

function entry(name: string, tools: Record<string, ArtifactTool>): ServerExtensionEntry {
	return {
		specifier: `@acme/${name}/server`,
		extension: { name, extensions: [], artifactTools: tools },
	};
}

describe("artifactTools", () => {
	it("knows the shipped tools that show files: visualize and ask_user_question", () => {
		const tools = artifactTools(() => false);
		expect([...tools.keys()].sort()).toEqual(["ask_user_question", "visualize"]);
	});

	it("reads visualize's file paths and the diagram it saved", () => {
		const visualize = artifactTools(() => false).get("visualize");
		expect(
			visualize?.presented?.({ type: "file", path: "a/after.html", before: "a/before.html" }, {}),
		).toEqual(["a/after.html", "a/before.html"]);
		expect(
			visualize?.presented?.(
				{ type: "diagram", mermaid: "graph TD" },
				{ type: "diagram", savedPath: ".thinkrail/context/visualize/x.md" },
			),
		).toEqual([".thinkrail/context/visualize/x.md"]);
		expect(visualize?.presented?.(null, null)).toEqual([]);
	});

	it("reads a questionnaire's previews and the previews the user chose", () => {
		const ask = artifactTools(() => false).get("ask_user_question");
		const args = {
			questions: [
				{
					question: "Which?",
					header: "Pick",
					options: [
						{ label: "A", description: "a", previewFile: "m/a.html" },
						{ label: "B", description: "b", previewFile: "m/b.html", previewBefore: "m/old.html" },
					],
				},
			],
		};
		expect(ask?.presented?.(args, undefined)).toEqual(["m/a.html", "m/b.html", "m/old.html"]);
		expect(
			ask?.picked?.(args, {
				answers: [{ questionIndex: 0, previewFile: "m/b.html" }, { questionIndex: 1 }],
			}),
		).toEqual(["m/b.html"]);
		expect(ask?.picked?.(args, { kind: "ack" })).toEqual([]);
	});

	it("drops a disabled extension's declarations and keeps the first of a collision", () => {
		const first: ArtifactTool = { presented: () => ["first"] };
		const tools = artifactTools(
			(name) => name === "beta",
			[
				entry("alpha", { shared: first }),
				entry("beta", { only_beta: { presented: () => ["beta"] } }),
				entry("gamma", { shared: { presented: () => ["second"] } }),
			],
		);
		expect(tools.get("shared")).toBe(first);
		expect(tools.has("only_beta")).toBe(false);
	});
});
