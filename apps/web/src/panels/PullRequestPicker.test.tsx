import { expect, test } from "bun:test";
import type { PullRequestSummary } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { Command } from "@thinkrail/ui/command";
import { renderToStaticMarkup } from "react-dom/server";
import { PullRequestPickerBody } from "./PullRequestPicker";
import type { PullRequestListState, PullRequestLookup } from "./pullRequests";

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
	additions: 19217,
	deletions: 8006,
	changedFiles: 3,
	updatedAt: "2026-11-18T10:00:00Z",
	reviewRequested: false,
	...over,
});

const noop = () => {};
const text = (key: string) => String(EN[key as keyof typeof EN]).replaceAll("'", "&#x27;");

function view(
	list: PullRequestListState,
	{
		query = "",
		lookup = { kind: "idle" } as PullRequestLookup,
		selected = null as number | null,
	} = {},
) {
	return renderToStaticMarkup(
		<Command shouldFilter={false}>
			<PullRequestPickerBody
				list={list}
				query={query}
				lookup={lookup}
				selected={selected}
				onQueryChange={noop}
				onSelect={noop}
				onRetry={noop}
			/>
		</Command>,
	);
}

test("open pull requests list the ones waiting for your review first, with number, title, author and size", () => {
	const markup = view({
		kind: "ready",
		pullRequests: [pr(9, { draft: true }), pr(7, { reviewRequested: true })],
	});
	const waiting = markup.indexOf(text("panels.prPicker.waiting"));
	const open = markup.indexOf(`>${text("panels.prPicker.open")}<`);
	expect(waiting).toBeGreaterThan(-1);
	expect(open).toBeGreaterThan(waiting);
	expect(markup.indexOf('data-pr="7"')).toBeLessThan(markup.indexOf('data-pr="9"'));
	expect(markup).toContain("#9");
	expect(markup).toContain("Change 9");
	expect(markup).toContain("octo · +19,217 −8,006");
	expect(markup.match(/data-testid="pull-request-tag"/g)).toHaveLength(1);
	expect(markup).toContain(`>${text("panels.prPicker.draft")}<`);
	expect(markup).toContain('data-testid="pull-request-picker-search"');
});

test("a looked-up merged or closed pull request shows with its state tag", () => {
	for (const [state, key] of [
		["merged", "panels.prPicker.merged"],
		["closed", "panels.prPicker.closed"],
	] as const) {
		const markup = view(
			{ kind: "ready", pullRequests: [pr(1)] },
			{ query: "1431", lookup: { kind: "found", pullRequest: pr(1431, { state }) } },
		);
		expect(markup).toContain(text("panels.prPicker.found"));
		expect(markup).toContain('data-pr="1431"');
		expect(markup).not.toContain('data-pr="1"');
		expect(markup).toContain(`>${text(key)}<`);
	}
	const missing = view(
		{ kind: "ready", pullRequests: [] },
		{ query: "#5", lookup: { kind: "missing", number: 5 } },
	);
	expect(missing).toContain("No pull request #5 in this repository.");
});

test("loading, empty and every unavailable reason render their own state", () => {
	expect(view({ kind: "loading" })).toContain('data-testid="pull-request-picker-loading"');
	const empty = view({ kind: "ready", pullRequests: [] });
	expect(empty).toContain('data-testid="pull-request-picker-empty"');
	expect(empty).toContain(text("panels.prPicker.none"));
	expect(view({ kind: "ready", pullRequests: [pr(1)] }, { query: "zzz" })).toContain(
		text("panels.prPicker.noMatch"),
	);

	const missing = view({ kind: "unavailable", reason: "missing" });
	expect(missing).toContain(text("panels.prPicker.ghMissing"));
	expect(missing).toContain(text("panels.prPicker.integrations"));
	const signedOut = view({ kind: "unavailable", reason: "unauthenticated" });
	expect(signedOut).toContain(text("panels.prPicker.ghSignedOut"));
	expect(signedOut).toContain(text("panels.prPicker.integrations"));
	const notGithub = view({ kind: "unavailable", reason: "not-github" });
	expect(notGithub).toContain(text("panels.prPicker.notGithub"));
	expect(notGithub).not.toContain("pull-request-picker-retry");
	const failed = view({ kind: "unavailable", reason: "failed" });
	expect(failed).toContain(text("panels.prPicker.failed"));
	expect(failed).toContain('data-testid="pull-request-picker-retry"');
	expect(failed).not.toContain(text("panels.prPicker.integrations"));
});

test("the picked pull request is marked", () => {
	const markup = view({ kind: "ready", pullRequests: [pr(2), pr(1)] }, { selected: 1 });
	expect(markup).toMatch(/data-pr="1"[^>]*data-active="true"|data-active="true"[^>]*data-pr="1"/);
	expect(markup).not.toMatch(/data-pr="2"[^>]*data-active/);
});
