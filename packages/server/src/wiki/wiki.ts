import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
	WikiBuildPlan,
	WikiPage,
	WikiPublication,
	WikiPublishResult,
	WikiStatus,
} from "@thinkrail/contracts";
import { hasControlCharacter } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { githubSlug, runProviderCommand } from "../branch-review";
import { gitAsync } from "../git";
import { loadWorkspaces } from "../persistence";
import { prepareWikiOutput, wikiBuildPrompt } from "./builder";
import {
	listWikiPages,
	readWikiPage,
	WIKI_ENTRY,
	WIKI_OUT_DIR,
	wikiBuiltAt,
	wikiRootOf,
} from "./pages";
import { pushSite } from "./publish";
import { buildSite, defaultPagesUrl } from "./site";

export const WIKI_PUBLISH_BRANCH = "gh-pages";

const PUBLICATION_FILE = ".thinkrail-wiki.json";
const REMOTE_TIMEOUT_MS = 8_000;
const PAGES_API_TIMEOUT_MS = 20_000;
const MODEL_REF_MAX_LENGTH = 200;

function worktreeOf(workspaceId: string): string {
	const workspace = loadWorkspaces().find((each) => each.id === workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);
	return workspace.worktreePath;
}

function publicationFile(worktree: string): string {
	return join(worktree, WIKI_OUT_DIR, PUBLICATION_FILE);
}

function readPublication(worktree: string): WikiPublication | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(publicationFile(worktree), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const { url, branch, publishedAt } = parsed as Record<string, unknown>;
		if (typeof url !== "string" || typeof branch !== "string" || typeof publishedAt !== "number") {
			return undefined;
		}
		return { url, branch, publishedAt };
	} catch {
		return undefined;
	}
}

async function originOf(worktree: string): Promise<{ url: string; slug: string } | null> {
	const origin = await gitAsync(worktree, ["remote", "get-url", "origin"], {
		timeoutMs: REMOTE_TIMEOUT_MS,
	});
	if (!origin.ok || origin.out === "") return null;
	const slug = githubSlug(origin.out);
	return slug ? { url: origin.out, slug } : null;
}

export async function wikiStatus(workspaceId: string): Promise<WikiStatus> {
	const worktree = worktreeOf(workspaceId);
	const root = wikiRootOf(worktree);
	const pages = listWikiPages(root);
	const built = pages.some((page) => page.path === WIKI_ENTRY);
	const builtAt = built ? wikiBuiltAt(root) : undefined;
	const publication = readPublication(worktree);
	return {
		built,
		...(builtAt === undefined ? {} : { builtAt }),
		pages: built ? pages : [],
		publishTarget: (await originOf(worktree))?.slug ?? null,
		...(publication ? { publication } : {}),
	};
}

export function wikiPage(workspaceId: string, path: string): WikiPage {
	return readWikiPage(wikiRootOf(worktreeOf(workspaceId)), path);
}

export function prepareWikiBuild(
	workspaceId: string,
	model: string,
	codeOnly: boolean,
): WikiBuildPlan {
	const ref = model.trim();
	if (ref === "" || ref.length > MODEL_REF_MAX_LENGTH || hasControlCharacter(ref)) {
		throw new Error("Invalid model reference");
	}
	prepareWikiOutput(worktreeOf(workspaceId));
	return { prompt: wikiBuildPrompt(ref, codeOnly) };
}

async function pagesState(
	worktree: string,
	slug: string,
): Promise<{ url: string; branch: string } | null> {
	const info = await runProviderCommand(
		worktree,
		["gh", "api", `repos/${slug}/pages`],
		PAGES_API_TIMEOUT_MS,
	);
	if (!info.ok) return null;
	try {
		const parsed = JSON.parse(info.out) as { html_url?: unknown; source?: { branch?: unknown } };
		const url = typeof parsed.html_url === "string" ? parsed.html_url : defaultPagesUrl(slug);
		const branch = typeof parsed.source?.branch === "string" ? parsed.source.branch : "";
		return { url, branch };
	} catch {
		return null;
	}
}

export async function publishWiki(workspaceId: string): Promise<WikiPublishResult> {
	const worktree = worktreeOf(workspaceId);
	const root = wikiRootOf(worktree);
	const entries = listWikiPages(root);
	if (!entries.some((page) => page.path === WIKI_ENTRY)) {
		throw new CodedError("WIKI_NOT_BUILT", "The wiki has not been built yet");
	}
	const origin = await originOf(worktree);
	if (!origin) {
		throw new CodedError("WIKI_NOT_GITHUB", "origin is not a GitHub repository");
	}

	const existing = await pagesState(worktree, origin.slug);
	if (existing && existing.branch !== WIKI_PUBLISH_BRANCH) {
		throw new CodedError(
			"WIKI_BRANCH_FOREIGN",
			`GitHub Pages for ${origin.slug} already serves ${existing.branch || "another source"}, not ${WIKI_PUBLISH_BRANCH}`,
		);
	}

	const pages = entries.map((entry) => ({
		...entry,
		content: readWikiPage(root, entry.path).content,
	}));
	const files = buildSite(pages, `${basename(origin.slug)} wiki`);
	await pushSite({ files, remoteUrl: origin.url, branch: WIKI_PUBLISH_BRANCH });

	if (!existing) {
		await runProviderCommand(
			worktree,
			[
				"gh",
				"api",
				"-X",
				"POST",
				`repos/${origin.slug}/pages`,
				"-f",
				`source[branch]=${WIKI_PUBLISH_BRANCH}`,
				"-f",
				"source[path]=/",
			],
			PAGES_API_TIMEOUT_MS,
		);
	}
	const url = (await pagesState(worktree, origin.slug))?.url ?? defaultPagesUrl(origin.slug);
	const publication: WikiPublication = {
		url,
		branch: WIKI_PUBLISH_BRANCH,
		publishedAt: Date.now(),
	};
	try {
		writeFileSync(publicationFile(worktree), JSON.stringify(publication));
	} catch {}
	return { url, branch: WIKI_PUBLISH_BRANCH, pageCount: pages.length };
}
