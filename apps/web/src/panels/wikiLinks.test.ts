import { expect, test } from "bun:test";
import { resolveWikiLink } from "./wikiLinks";

test("an article link resolves against the linking article's folder", () => {
	expect(resolveWikiLink("index.md", "Community_0.md")).toEqual({
		kind: "page",
		path: "Community_0.md",
		anchor: "",
	});
	expect(resolveWikiLink("a/b.md", "../c.md#top")).toEqual({
		kind: "page",
		path: "c.md",
		anchor: "top",
	});
	expect(resolveWikiLink("a/b.md", "./d%20e.md")).toEqual({
		kind: "page",
		path: "a/d e.md",
		anchor: "",
	});
});

test("a link that climbs out of the wiki, or leaves markdown, goes nowhere", () => {
	expect(resolveWikiLink("index.md", "../secret.md")).toEqual({ kind: "none" });
	expect(resolveWikiLink("index.md", "graph.html")).toEqual({ kind: "none" });
	expect(resolveWikiLink("index.md", "/abs.md")).toEqual({ kind: "none" });
	expect(resolveWikiLink("index.md", "file:///x.md")).toEqual({ kind: "none" });
	expect(resolveWikiLink("index.md", "%E0%A4%A.md")).toEqual({ kind: "none" });
	expect(resolveWikiLink("index.md", undefined)).toEqual({ kind: "none" });
	expect(resolveWikiLink("index.md", "#%FF")).toEqual({ kind: "none" });
});

test("web links open outside and fragments stay on the page", () => {
	expect(resolveWikiLink("index.md", "https://github.com/x")).toEqual({
		kind: "external",
		href: "https://github.com/x",
	});
	expect(resolveWikiLink("index.md", "#god-nodes")).toEqual({ kind: "anchor", id: "god-nodes" });
});
