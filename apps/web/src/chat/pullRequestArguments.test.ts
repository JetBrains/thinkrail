import { expect, test } from "bun:test";
import type { PullRequestSummary } from "@thinkrail/contracts";
import {
	filterAuthors,
	isPullRequestArgumentComplete,
	isReferencedPullRequest,
	mergeAuthors,
	orderPullRequests,
	pullRequestReferenceOf,
} from "./pullRequestArguments";

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

test("a number, #number or pull-request link is a reference; a link keeps its repository", () => {
	expect(pullRequestReferenceOf("1431")).toEqual({ number: 1431, repository: null });
	expect(pullRequestReferenceOf(" #12 ")).toEqual({ number: 12, repository: null });
	expect(pullRequestReferenceOf("https://github.com/Acme/App/pull/77/files")).toEqual({
		number: 77,
		repository: "acme/app",
	});
	for (const text of ["fix 12", "0", "https://gitlab.com/a/b/-/merge_requests/3", ""]) {
		expect(pullRequestReferenceOf(text)).toBeNull();
	}
});

test("a link from another repository never names this repository's pull request", () => {
	const ours = pr(5);
	expect(isReferencedPullRequest(ours, { number: 5, repository: null })).toBe(true);
	expect(isReferencedPullRequest(ours, { number: 5, repository: "acme/app" })).toBe(true);
	expect(isReferencedPullRequest(ours, { number: 5, repository: "me/app" })).toBe(false);
	expect(isReferencedPullRequest(ours, { number: 6, repository: null })).toBe(false);
});

test("the argument is complete once a reference is followed by whitespace", () => {
	expect(isPullRequestArgumentComplete("https://github.com/a/b/pull/1 ")).toBe(true);
	expect(isPullRequestArgumentComplete("#12 focus on the cache")).toBe(true);
	expect(isPullRequestArgumentComplete("https://github.com/a/b/pull/1")).toBe(false);
	expect(isPullRequestArgumentComplete("fix login")).toBe(false);
	expect(isPullRequestArgumentComplete("")).toBe(false);
});

test("requested reviews come first and authors are listed once, with the chosen one kept", () => {
	const rows = [pr(3, { author: "zed" }), pr(2, { reviewRequested: true, author: "ada" }), pr(1)];
	expect(orderPullRequests(rows).map((row) => row.number)).toEqual([2, 3, 1]);
	expect(
		mergeAuthors([
			["zed", "ada"],
			["ada", "octo"],
		]),
	).toEqual(["zed", "ada", "octo"]);
	expect(mergeAuthors([], "bob")).toEqual(["bob"]);
	const authors = ["zed", "Afloat16", "mvanhorn", "adam", "ada"];
	expect(filterAuthors(authors, "")).toEqual(authors);
	expect(filterAuthors(authors, "ad")).toEqual(["adam", "ada"].sort((a, b) => a.length - b.length));
	expect(filterAuthors(authors, "van")).toEqual(["mvanhorn"]);
	expect(filterAuthors(authors, "qq")).toEqual([]);
});
