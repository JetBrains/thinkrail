import { expect, test } from "bun:test";
import {
	indexSections,
	parseFile,
	type SpecContentEntry,
	type SpecSectionHit,
	searchSpecs,
} from "./index.ts";
import { splitSections } from "./sections.ts";
import { stem, tokenize } from "./tokenize.ts";

function spec(path: string, frontmatter: string, body: string): SpecContentEntry {
	const content = `---\n${frontmatter}\n---\n${body}`;
	const parsed = parseFile(content).frontmatter;
	if (parsed === null) throw new Error(`bad fixture ${path}`);
	return { path, content, frontmatter: parsed };
}

function where(hit: SpecSectionHit | undefined): string {
	return hit ? `${hit.path} › ${hit.heading}` : "(none)";
}

test("tokenize splits identifiers into their parts and keeps the joined form", () => {
	const terms = (text: string) => tokenize(text).map((token) => token.term);
	expect(terms("renameSession")).toEqual(["renamesession", "renam", "session"]);
	expect(terms("agent_settled spec-graph")).toEqual([
		"agentsettl",
		"agent",
		"settl",
		"specgraph",
		"spec",
		"graph",
	]);
	expect(terms("HTTPServer parseURL")).toEqual([
		"httpserver",
		"http",
		"server",
		"parseurl",
		"pars",
		"url",
	]);
	expect(terms("v95 utf8 PR #911")).toEqual(["v95", "utf8", "pr", "911"]);
});

test("tokenize drops stopwords and one-character words but reports surface offsets", () => {
	const tokens = tokenize("Why does the `renameSession` call fail?");
	expect(tokens.map((token) => token.surface)).toEqual([
		"renamesession",
		"rename",
		"session",
		"call",
		"fail",
	]);
	const text = "Why does the `renameSession` call fail?";
	const session = tokens.find((token) => token.surface === "session");
	expect(session && text.slice(session.start, session.end)).toBe("Session");
	expect(tokenize("a I x").length).toBe(0);
});

test("the stemmer meets word forms without merging derivations", () => {
	const same = (...words: string[]) => expect(new Set(words.map(stem)).size).toBe(1);
	same("rename", "renames", "renamed", "renaming");
	same("title", "titles", "titled");
	same("crash", "crashes", "crashed");
	same("index", "indexes", "indexed", "indexing");
	same("policy", "policies");
	same("run", "runs", "running");
	same("stop", "stops", "stopped", "stopping");
	same("file", "files", "filing");
	same("cache", "caches", "cached", "caching");
	same("direct", "directly");
	expect(stem("status")).toBe("status");
	expect(stem("analysis")).toBe("analysis");
	expect(stem("string")).toBe("string");
	expect(stem("key")).toBe("key");
	expect(stem("keys")).toBe("key");
	expect(stem("early")).not.toBe(stem("ear"));
	expect(stem("isolation")).not.toBe(stem("isolate"));
	expect(stem("сессия")).toBe("сессия");
});

test("sections follow headings of every level, skip fenced headings and keep file line numbers", () => {
	const content = [
		"---",
		"id: a",
		"type: module-design",
		"title: Alpha",
		"---",
		"Intro text.",
		"",
		"## Boundary",
		"Owns the thing.",
		"```md",
		"## not a heading",
		"```",
		"### Allowed deps",
		"Only yaml.",
		"## Invariants ##",
		"Holds.",
	].join("\r\n");
	const sections = splitSections(content);
	expect(sections.map((section) => [section.headings.join(" › "), section.line])).toEqual([
		["", 6],
		["Boundary", 8],
		["Boundary › Allowed deps", 13],
		["Invariants", 15],
	]);
	expect(sections[1]?.body).toEqual(["Owns the thing.", "```md", "## not a heading", "```"]);
	expect(sections[1]?.endLine).toBe(12);
});

test("a lone leading H1 names the document, not every section's trail", () => {
	const titled = splitSections(
		"---\nid: a\ntype: x\n---\n# Architecture\nWhy.\n## Decisions\nOne.\n",
	);
	expect(titled.map((section) => section.headings)).toEqual([[], ["Decisions"]]);
	const several = splitSections("# One\nA.\n# Two\n## Sub\nB.\n");
	expect(several.map((section) => section.headings)).toEqual([["One"], ["Two"], ["Two", "Sub"]]);
	expect(splitSections("---\nid: a\ntype: x\n---\n\n## Only\n")[0]?.headings).toEqual(["Only"]);
});

const CORPUS = [
	spec(
		"agent/SPEC.md",
		"id: module-agent\ntype: module-design\ntitle: agent — in-process pi sessions",
		[
			"## Responsibility",
			"Runs pi sessions in-process and forwards their events.",
			"## Session titles",
			"The manager is the only durable chat-title writer: renameSession(sessionId, title) validates",
			"one non-blank, single-line title and persists it.",
			"## Compaction",
			"Compaction summarizes old turns when the context window fills.",
		].join("\n"),
	),
	spec(
		"shell/SPEC.md",
		"id: submodule-web-shell\ntype: submodule-design\ntitle: shell — responsive frame",
		[
			"## Chat title controls",
			"A chat tab's context menu gains Rename chat.",
			"## Layout",
			"Panels are arranged by the shell; a tab title is never edited here.",
		].join("\n"),
	),
	spec(
		"architecture.md",
		"id: architecture\ntype: architecture-design\ntitle: Architecture",
		[
			"## Decisions",
			"### 1. In-process engine",
			"pi runs in-process, never as a subprocess; there is no crash isolation, so a fatal fault can take down the host.",
			"### 2. Typed wire",
			"Contracts are the one wire; the UI ships independently.",
		].join("\n"),
	),
	spec(
		".thinkrail/context/TASK-titles.md",
		"id: task-titles\ntype: task-spec\ntitle: Session titles task",
		["## Session titles", "The manager is the only durable chat-title writer."].join("\n"),
	),
];

test("words in any order find the sections, and every query word beats some of them", () => {
	const index = indexSections(CORPUS);
	const { hits } = searchSpecs(index, "title rename chat");
	expect(hits.slice(0, 2).map(where).sort()).toEqual([
		"agent/SPEC.md › Session titles",
		"shell/SPEC.md › Chat title controls",
	]);
	expect(hits.slice(0, 2).map((hit) => [hit.matched, hit.terms])).toEqual([
		[3, 3],
		[3, 3],
	]);
	const partial = hits.filter((hit) => hit.matched < 3);
	expect(partial.length).toBeGreaterThan(0);
	expect(partial.every((hit) => hit.score < (hits[1]?.score ?? 0))).toBe(true);
});

test("headings weigh more than body text and word forms still match", () => {
	const index = indexSections(CORPUS);
	expect(where(searchSpecs(index, "compaction").hits[0])).toBe("agent/SPEC.md › Compaction");
	expect(where(searchSpecs(index, "summarizing turns").hits[0])).toBe("agent/SPEC.md › Compaction");
	expect(where(searchSpecs(index, "crashes isolated host").hits[0])).toBe(
		"architecture.md › Decisions › 1. In-process engine",
	);
});

test("an exact phrase ranks above the same words scattered", () => {
	const index = indexSections([
		spec(
			"a.md",
			"id: a\ntype: module-design\ntitle: A",
			"## Scattered\nThe title of a chat; rename it.\n",
		),
		spec(
			"b.md",
			"id: b\ntype: module-design\ntitle: B",
			"## Phrase\nYou can rename chat title here.\n",
		),
	]);
	expect(where(searchSpecs(index, "rename chat title").hits[0])).toBe("b.md › Phrase");
});

test("durable specs win ties over task-specs, then path order", () => {
	const index = indexSections([
		spec("z.md", "id: z\ntype: task-spec\ntitle: Same", "## Topic\nwidget\n"),
		spec("b.md", "id: b\ntype: module-design\ntitle: Same", "## Topic\nwidget\n"),
		spec("a.md", "id: a\ntype: module-design\ntitle: Same", "## Topic\nwidget\n"),
	]);
	expect(searchSpecs(index, "widget").hits.map((hit) => hit.path)).toEqual([
		"a.md",
		"b.md",
		"z.md",
	]);
});

test("a partial last word matches the words it starts", () => {
	const index = indexSections(CORPUS);
	expect(where(searchSpecs(index, "renameSes").hits[0])).toBe("agent/SPEC.md › Session titles");
	expect(where(searchSpecs(index, "compac").hits[0])).toBe("agent/SPEC.md › Compaction");
	expect(searchSpecs(index, "zz").total).toBe(0);
	expect(searchSpecs(index, "the of").total).toBe(0);
	expect(searchSpecs(index, "   ").total).toBe(0);
});

test("several phrasings fuse by reciprocal rank", () => {
	const index = indexSections(CORPUS);
	const single = searchSpecs(index, "subprocess");
	const fused = searchSpecs(index, ["subprocess", "fatal fault host", "subprocess"]);
	expect(where(single.hits[0])).toBe("architecture.md › Decisions › 1. In-process engine");
	expect(where(fused.hits[0])).toBe("architecture.md › Decisions › 1. In-process engine");
	expect(fused.hits[0]?.score).toBeCloseTo(2 / 61, 6);
});

test("filters narrow by metadata and limit caps the page, not the total", () => {
	const index = indexSections(CORPUS);
	const all = searchSpecs(index, "title", { limit: 1 });
	expect(all.hits.length).toBe(1);
	expect(all.total).toBeGreaterThan(1);
	expect(searchSpecs(index, "title", { type: "task-spec" }).hits.map((hit) => hit.path)).toEqual([
		".thinkrail/context/TASK-titles.md",
	]);
	expect(searchSpecs(index, "title", { parent: "nobody" }).total).toBe(0);
});

test("a hit carries its heading line, the best line as snippet and highlight ranges", () => {
	const index = indexSections(CORPUS);
	const hit = searchSpecs(index, "renameSession title").hits[0];
	expect(hit?.line).toBe(8);
	expect(hit?.snippetLine).toBe(9);
	const snippet = hit?.snippet ?? "";
	expect(snippet.startsWith("The manager is the only durable chat-title writer")).toBe(true);
	const marked = (hit?.ranges.snippet ?? []).map(([start, end]) => snippet.slice(start, end));
	expect(marked).toContain("renameSession");
	expect(marked).toContain("title");
	expect((hit?.ranges.heading ?? []).map(([start, end]) => hit?.heading.slice(start, end))).toEqual(
		["Session", "titles"],
	);
});

test("a long line is cut around its first match with ellipses and shifted ranges", () => {
	const filler = "lorem ipsum dolor sit amet ".repeat(12);
	const index = indexSections([
		spec("a.md", "id: a\ntype: x\ntitle: A", `## Long\n${filler}needle here ${filler}\n`),
	]);
	const hit = searchSpecs(index, "needle").hits[0];
	const snippet = hit?.snippet ?? "";
	expect(snippet.startsWith("…")).toBe(true);
	expect(snippet.endsWith("…")).toBe(true);
	expect(snippet.length).toBeLessThanOrEqual(162);
	const [range] = hit?.ranges.snippet ?? [];
	expect(range && snippet.slice(range[0], range[1])).toBe("needle");
});

test("re-indexing reuses unchanged files and re-tokenizes only the changed one", () => {
	const first = indexSections(CORPUS);
	expect(indexSections(CORPUS, first)).toBe(first);
	const [agent, shell, ...rest] = CORPUS;
	if (!agent || !shell) throw new Error("fixture");
	const edited = spec(
		"shell/SPEC.md",
		"id: submodule-web-shell\ntype: submodule-design\ntitle: shell — responsive frame",
		"## Chat title controls\nA chat tab's context menu gains Rename chat.\n## Zebra\nzebra crossing\n",
	);
	const second = indexSections([agent, edited, ...rest], first);
	expect(second).not.toBe(first);
	expect(second.files.get("agent/SPEC.md")).toBe(first.files.get("agent/SPEC.md"));
	expect(second.files.get("shell/SPEC.md")).not.toBe(first.files.get("shell/SPEC.md"));
	expect(where(searchSpecs(second, "zebra").hits[0])).toBe("shell/SPEC.md › Zebra");
	const removed = indexSections([agent, ...rest], second);
	expect(removed.files.has("shell/SPEC.md")).toBe(false);
	expect(searchSpecs(removed, "zebra").total).toBe(0);
});

test("indexing about two megabytes of specs stays linear: a twenty-second blowup guard, not a speed gate", () => {
	const body = CORPUS.map((entry) => parseFile(entry.content).body).join("\n");
	const entries: SpecContentEntry[] = [];
	let bytes = 0;
	for (let n = 0; bytes < 2_000_000; n += 1) {
		const entry = spec(
			`bulk/${n}.md`,
			`id: bulk-${n}\ntype: module-design\ntitle: Bulk ${n}`,
			body.repeat(20),
		);
		entries.push(entry);
		bytes += entry.content.length;
	}
	const started = performance.now();
	const index = indexSections(entries);
	const elapsed = performance.now() - started;
	expect(index.files.size).toBe(entries.length);
	expect(elapsed).toBeLessThan(20_000);
}, 30_000);
