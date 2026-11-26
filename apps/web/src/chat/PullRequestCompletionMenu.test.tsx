import { expect, test } from "bun:test";
import { DEFAULT_PULL_REQUEST_FILTER, type PullRequestSummary } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { renderToStaticMarkup } from "react-dom/server";
import { PullRequestCompletionMenu } from "./PullRequestCompletionMenu";
import type { PullRequestCompletion } from "./pullRequestCompletion";

const pr = (number: number, over: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
	number,
	title: `Change ${number}`,
	author: "octo",
	state: "open",
	draft: false,
	headRefName: `feature-${number}`,
	baseRefName: "main",
	baseRef: "origin/main",
	url: `https://github.com/acme/app/pull/${number}`,
	updatedAt: "2026-11-18T10:00:00Z",
	reviewRequested: false,
	...over,
});

const noop = () => {};
const text = (key: string) => String(EN[key as keyof typeof EN]).replaceAll("'", "&#x27;");

function completion(over: Partial<PullRequestCompletion> = {}): PullRequestCompletion {
	return {
		listing: { kind: "ready" },
		items: [],
		waitingCount: 0,
		lookup: null,
		filter: DEFAULT_PULL_REQUEST_FILTER,
		setFilter: noop,
		authors: [],
		hasMore: false,
		optionCount: 0,
		pick: () => null,
		loadingMore: false,
		loadMore: noop,
		retry: noop,
		...over,
	};
}

const view = (value: PullRequestCompletion, activeIndex = 0, notice?: string) =>
	renderToStaticMarkup(
		<PullRequestCompletionMenu
			completion={value}
			activeIndex={activeIndex}
			onPick={noop}
			onHover={noop}
			onLeaveFilters={noop}
			{...(notice ? { notice } : {})}
		/>,
	);

test("waiting rows come under their own heading, with number, title, tag, author and size once known", () => {
	const markup = view(
		completion({
			items: [
				pr(7, {
					reviewRequested: true,
					size: { additions: 19217, deletions: 8006, changedFiles: 3 },
				}),
				pr(9, { draft: true }),
			],
			waitingCount: 1,
			hasMore: true,
		}),
		1,
	);
	expect(markup.indexOf(text("chat.prCompletion.waiting"))).toBeLessThan(
		markup.indexOf(text("chat.prCompletion.other")),
	);
	expect(markup.indexOf('data-pr="7"')).toBeLessThan(markup.indexOf('data-pr="9"'));
	expect(markup).toContain("octo · +19,217 −8,006");
	expect(markup).toMatch(/data-pr="9"[^>]*data-active="true"/);
	expect(markup).toContain(`>${text("chat.prCompletion.draft")}<`);
	expect(markup).toContain('data-testid="pull-request-more"');
	const onMore = view(completion({ items: [pr(1)], hasMore: true }), 1);
	expect(onMore).toMatch(/data-testid="pull-request-more"[^>]*data-active="true"/);
});

test("the filters show the remembered scope, drafts and author, and the notice sits above them", () => {
	const markup = view(
		completion({ filter: { scope: "mine", drafts: false, author: "ada" } }),
		0,
		"Starts elsewhere.",
	);
	expect(markup).toMatch(/data-testid="pull-request-scope-mine"[^>]*data-on="true"/);
	expect(markup).toMatch(/data-testid="pull-request-drafts"[^>]*data-on="false"/);
	expect(markup).toContain("Author: ada");
	expect(markup.indexOf("Starts elsewhere.")).toBeLessThan(markup.indexOf("pull-request-filters"));
	expect(markup).toContain(text("chat.prCompletion.noneMine"));
	expect(markup).toContain('data-testid="pull-request-show-all"');
});

test("a looked-up pull request in any state, a missing one, and every listing state render", () => {
	const found = view(
		completion({
			items: [pr(1431, { state: "merged" })],
			lookup: { kind: "found", pullRequest: pr(1431, { state: "merged" }) },
		}),
	);
	expect(found).toContain('data-testid="pull-request-group-found"');
	expect(found).toContain(`>${text("chat.prCompletion.merged")}<`);
	expect(view(completion({ lookup: { kind: "missing", number: 5 } }))).toContain(
		"No pull request #5 in this repository.",
	);
	expect(view(completion({ listing: { kind: "loading" } }))).toContain(
		'data-testid="pull-request-loading"',
	);
	const failed = view(completion({ listing: { kind: "unavailable", reason: "failed" } }));
	expect(failed).toContain('data-testid="pull-request-retry"');
	const signedOut = view(
		completion({ listing: { kind: "unavailable", reason: "unauthenticated" } }),
	);
	expect(signedOut).toContain(text("chat.prCompletion.ghSignedOut"));
	expect(signedOut).toContain(text("chat.prCompletion.integrations"));
	expect(view(completion({ listing: { kind: "unavailable", reason: "not-github" } }))).toContain(
		text("chat.prCompletion.notGithub"),
	);
});
