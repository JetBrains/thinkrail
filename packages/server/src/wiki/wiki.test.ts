import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitAsync } from "../git";
import { WIKI_BUILDER_AGENT, WIKI_BUILDER_DEFINITION, WIKI_BUILDER_MARKER } from "./builder";
import { listWikiPages, readWikiPage } from "./pages";
import { pushSite } from "./publish";
import { buildSite, defaultPagesUrl, rewriteMarkdownLinks, SITE_MARKER_FILE } from "./site";
import { prepareWikiBuild, wikiPage, wikiStatus } from "./wiki";

let dataDir: string;
let worktree: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function writeWiki(files: Record<string, string>): string {
	const root = join(worktree, "graphify-out", "wiki");
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-wiki-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	worktree = join(dataDir, "worktree");
	mkdirSync(worktree);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws1",
				projectId: "p1",
				name: "ws",
				branch: "b",
				worktreePath: worktree,
				baseBranch: "main",
			},
		]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("an unbuilt repo reports no wiki and no publish target", async () => {
	const status = await wikiStatus("ws1");
	expect(status).toEqual({ built: false, pages: [], publishTarget: null });
});

test("pages list with the index first, then by title in numeric order", () => {
	const root = writeWiki({
		"index.md": "# Knowledge Graph Index\n",
		"Community_10.md": "# Community 10\n",
		"Community_2.md": "# Community 2\n",
		"parseFile.md": "# parseFile()\n",
		"notes.txt": "ignored",
		".hidden.md": "# hidden\n",
	});
	expect(listWikiPages(root).map((page) => page.path)).toEqual([
		"index.md",
		"Community_2.md",
		"Community_10.md",
		"parseFile.md",
	]);
});

test("status carries the built wiki and a page read returns its text", async () => {
	writeWiki({ "index.md": "# Index\n\nHello\n" });
	const status = await wikiStatus("ws1");
	expect(status.built).toBe(true);
	expect(status.builtAt).toBeGreaterThan(0);
	expect(status.pages).toEqual([{ path: "index.md", title: "Index" }]);
	expect(wikiPage("ws1", "index.md").content).toContain("Hello");
});

test("a wiki without its index page is not built", async () => {
	writeWiki({ "Community_0.md": "# Community 0\n" });
	expect((await wikiStatus("ws1")).built).toBe(false);
});

test("page reads refuse traversal, absolute paths, non-markdown and symlink escapes", () => {
	const root = writeWiki({ "index.md": "# Index\n" });
	writeFileSync(join(dataDir, "secret.md"), "# secret\n");
	for (const path of [
		"../../../secret.md",
		"/etc/passwd.md",
		"a\\b.md",
		"index.txt",
		"",
		"a//b.md",
	]) {
		expect(() => readWikiPage(root, path)).toThrow();
	}
	try {
		symlinkSync(join(dataDir, "secret.md"), join(root, "leak.md"));
	} catch {
		return;
	}
	expect(() => readWikiPage(root, "leak.md")).toThrow();
});

test("preparing a build writes a self-ignoring output folder and a prompt naming the model", () => {
	const plan = prepareWikiBuild("ws1", "my-endpoint/llama-3", true);
	expect(readFileSync(join(worktree, "graphify-out", ".gitignore"), "utf8")).toBe("*\n");
	expect(plan.prompt).toContain(`subagent_type: "${WIKI_BUILDER_AGENT}"`);
	expect(plan.prompt).toContain('"my-endpoint/llama-3"');
	expect(plan.prompt).toContain("--code-only");
	expect(prepareWikiBuild("ws1", "a/b", false).prompt).toContain("graphify extract .");
	expect(() => prepareWikiBuild("ws1", "  ", true)).toThrow();
	expect(() => prepareWikiBuild("ws1", "a\nb", true)).toThrow();
});

test("the managed agent definition is discovered by pi-subagents once installed", async () => {
	const { discoverAgentDefinitions } = await import("pi-subagents");
	const { ensureManagedAgentDefinition } = await import("../agent/agentDefinitions");
	const agentDir = join(dataDir, "agent");
	ensureManagedAgentDefinition(
		WIKI_BUILDER_AGENT,
		WIKI_BUILDER_DEFINITION,
		WIKI_BUILDER_MARKER,
		agentDir,
	);
	const found = discoverAgentDefinitions({ cwd: worktree, agentDir, includeProject: false }).find(
		(definition) => definition.name === WIKI_BUILDER_AGENT,
	);
	expect(found?.source).toBe("personal");
	expect(found?.model).toBeUndefined();
	expect(found?.extensions).toBe(true);
	expect(found?.systemPrompt).toContain("graphify export wiki");
}, 30_000);

test("article links follow Jekyll's .md to .html rewrite and leave other links alone", () => {
	expect(
		rewriteMarkdownLinks(
			"[a](Foo.md) [b](Foo.md#x) [c](https://x.dev/a.md) [d](#top) [e](/abs.md) [f](Foo_bar.md)",
		),
	).toBe(
		"[a](Foo.html) [b](Foo.html#x) [c](https://x.dev/a.md) [d](#top) [e](/abs.md) [f](Foo_bar.html)",
	);
});

test("the site wraps every article in front matter and raw Liquid, and carries the marker", () => {
	const files = buildSite(
		[
			{ path: "index.md", title: "Index", content: "# Index\n[x](x.md)" },
			{ path: "x.md", title: 'The "x" {{ y }}', content: "# x {{ y }} {% endraw %}" },
		],
		"repo wiki",
	);
	const byPath = new Map(files.map((file) => [file.path, file.content]));
	expect(byPath.has(SITE_MARKER_FILE)).toBe(true);
	expect(byPath.get("_config.yml")).toContain("jekyll-theme-minimal");
	expect(byPath.get("index.md")).toContain("[x](x.html)");
	expect(byPath.get("index.md")).not.toContain("Back to the index");
	const page = byPath.get("x.md") ?? "";
	expect(page).toContain('title: "The \\"x\\" {{ y }}"');
	expect(page).toContain("{% raw %}");
	expect(page).not.toContain("{% endraw %} {% endraw %}");
	expect(page).toContain("{ % endraw % }");
	expect(page).toContain("[Back to the index](index.html)");

	const nested = buildSite([{ path: "a/b/c.md", title: "c", content: "# c" }], "repo wiki").find(
		(file) => file.path === "a/b/c.md",
	);
	expect(nested?.content).toContain("[Back to the index](../../index.html)");
});

test("project pages and user pages get their GitHub Pages address", () => {
	expect(defaultPagesUrl("Acme/Widget")).toBe("https://acme.github.io/Widget/");
	expect(defaultPagesUrl("acme/acme.github.io")).toBe("https://acme.github.io/");
});

async function bareRemote(): Promise<string> {
	const remote = join(dataDir, "remote.git");
	mkdirSync(remote);
	expect((await gitAsync(remote, ["init", "-q", "--bare"])).ok).toBe(true);
	return remote;
}

test("publishing creates the branch, and a second publish replaces it", async () => {
	const remote = await bareRemote();
	const first = await pushSite({
		files: [
			{ path: SITE_MARKER_FILE, content: "m" },
			{ path: "index.md", content: "one" },
		],
		remoteUrl: remote,
		branch: "gh-pages",
	});
	expect(first.sha).toMatch(/^[0-9a-f]{40}$/);
	const second = await pushSite({
		files: [
			{ path: SITE_MARKER_FILE, content: "m" },
			{ path: "nested/page.md", content: "two" },
		],
		remoteUrl: remote,
		branch: "gh-pages",
	});
	expect(second.sha).not.toBe(first.sha);
	expect(git(remote, ["rev-parse", "refs/heads/gh-pages"]).out).toBe(second.sha);
	const tree = git(remote, ["ls-tree", "-r", "--name-only", "gh-pages"]).out.split("\n");
	expect(tree).toEqual([SITE_MARKER_FILE, "nested/page.md"]);
	expect(existsSync(join(dataDir, "thinkrail-wiki"))).toBe(false);
});

test("a gh-pages branch ThinkRail did not write is refused and left alone", async () => {
	const remote = await bareRemote();
	const seed = join(dataDir, "seed");
	mkdirSync(seed);
	await gitAsync(seed, ["init", "-q"]);
	writeFileSync(join(seed, "site.html"), "hand written");
	await gitAsync(seed, ["add", "-A"]);
	await gitAsync(seed, [
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t.t",
		"commit",
		"-q",
		"-m",
		"seed",
	]);
	await gitAsync(seed, ["push", remote, "HEAD:refs/heads/gh-pages"]);
	const before = git(remote, ["rev-parse", "refs/heads/gh-pages"]).out;

	await expect(
		pushSite({
			files: [{ path: SITE_MARKER_FILE, content: "m" }],
			remoteUrl: remote,
			branch: "gh-pages",
		}),
	).rejects.toMatchObject({ code: "WIKI_BRANCH_FOREIGN" });
	expect(git(remote, ["rev-parse", "refs/heads/gh-pages"]).out).toBe(before);
});

test("an unreachable remote fails the publish without leaking credentials", async () => {
	await expect(
		pushSite({
			files: [{ path: SITE_MARKER_FILE, content: "m" }],
			remoteUrl: join(dataDir, "missing.git"),
			branch: "gh-pages",
		}),
	).rejects.toMatchObject({ code: "WIKI_PUBLISH_FAILED" });
});
