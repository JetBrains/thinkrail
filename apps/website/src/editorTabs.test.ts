import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { deriveEditorTabs } from "./editorTabs";

describe("deriveEditorTabs", () => {
	it("keeps one tab per unique target, first row winning", () => {
		expect(
			deriveEditorTabs([
				{ href: "#readme", label: "README.md" },
				{ href: "#worktrees", label: "FEATURES" },
				{ href: "#worktrees", label: "worktrees" },
				{ href: "#editor", label: "editor" },
			]),
		).toEqual([
			{ href: "#readme", label: "README.md" },
			{ href: "#worktrees", label: "FEATURES" },
			{ href: "#editor", label: "editor" },
		]);
	});

	it("skips rows with no target rather than emitting a dead tab", () => {
		expect(deriveEditorTabs([{ href: null, label: "no link" }])).toEqual([]);
	});

	it("preserves tree order", () => {
		const tabs = deriveEditorTabs([
			{ href: "#c", label: "c" },
			{ href: "#a", label: "a" },
			{ href: "#b", label: "b" },
		]);
		expect(tabs.map((t) => t.href)).toEqual(["#c", "#a", "#b"]);
	});
});

describe("the shipped file tree", () => {
	const html = readFileSync(new URL("./pages/index.astro", import.meta.url).pathname, "utf8");
	const rows = [
		...html.matchAll(/<a class="ft-row[^"]*" href="(#[^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
	].map((m) => ({ href: m[1] as string, label: (m[2] as string).replace(/<[^>]*>/g, "").trim() }));

	it("has rows to derive from", () => {
		expect(rows.length).toBeGreaterThan(0);
	});

	it("points every derived tab at a section that exists", () => {
		const ids = new Set(
			[...html.matchAll(/<section class="file-section[^"]*" id="([^"]+)"/g)].map((m) => m[1]),
		);
		const dangling = deriveEditorTabs(rows)
			.map((t) => t.href)
			.filter((href) => !ids.has(href.slice(1)));
		expect(dangling).toEqual([]);
	});

	it("gives every tab a non-empty label", () => {
		expect(deriveEditorTabs(rows).filter((t) => t.label === "")).toEqual([]);
	});
});
