import { expect, test } from "bun:test";
import type { PullRequestSummary } from "@thinkrail/contracts";
import {
	isReferencedPullRequest,
	pullRequestNumberOf,
	pullRequestRows,
	reviewKickoffPullRequest,
	reviewKickoffText,
} from "./pullRequests";

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
	additions: 1,
	deletions: 1,
	changedFiles: 1,
	updatedAt: "2026-11-18T10:00:00Z",
	reviewRequested: false,
	...over,
});

test("a review kickoff is the skill command and the pull request's link, and reads back", () => {
	const url = "https://github.com/acme/app/pull/1431";
	expect(reviewKickoffText(url)).toBe(
		"/skill:reviewing-a-pr https://github.com/acme/app/pull/1431",
	);
	expect(reviewKickoffPullRequest(reviewKickoffText(url))).toEqual({ number: 1431, url });
	expect(reviewKickoffPullRequest("/skill:reviewing-a-pr not a link")).toBeNull();
	expect(reviewKickoffPullRequest("Review https://github.com/acme/app/pull/1")).toBeNull();
	expect(reviewKickoffPullRequest("")).toBeNull();
});

test("a number, #number or pull-request link names a pull request; other text does not", () => {
	expect(pullRequestNumberOf("1431")).toBe(1431);
	expect(pullRequestNumberOf(" #12 ")).toBe(12);
	expect(pullRequestNumberOf("https://github.com/acme/app/pull/77")).toBe(77);
	expect(pullRequestNumberOf("https://github.com/acme/app/pull/77/files")).toBe(77);
	expect(pullRequestNumberOf("fix 12")).toBeNull();
	expect(pullRequestNumberOf("0")).toBeNull();
	expect(pullRequestNumberOf("https://gitlab.com/acme/app/-/merge_requests/3")).toBeNull();
});

test("rows put the requested reviews first and filter by words or by number", () => {
	const login = pr(3, { title: "Fix login", reviewRequested: true });
	const search = pr(2, { title: "Add search", author: "ada" });
	const first = pr(1);
	const list = [login, search, first];
	expect(pullRequestRows(list, "")).toEqual({
		waiting: [login],
		open: [search, first],
		lookup: null,
	});
	expect(pullRequestRows(list, "ADA search").open).toEqual([search]);
	expect(pullRequestRows(list, "#2").open).toEqual([search]);
	expect(pullRequestRows(list, "https://github.com/acme/app/pull/3").waiting).toEqual([login]);
	expect(pullRequestRows(list, "1500")).toEqual({
		waiting: [],
		open: [],
		lookup: { number: 1500, repository: null },
	});
	expect(pullRequestRows(list, "nothing like it").lookup).toBeNull();
});

test("a link from another repository never names this repository's pull request", () => {
	const ours = pr(5);
	const fork = "https://github.com/me/app/pull/5";
	expect(pullRequestRows([ours], fork)).toEqual({
		waiting: [],
		open: [],
		lookup: { number: 5, repository: "me/app" },
	});
	expect(isReferencedPullRequest(ours, { number: 5, repository: "me/app" })).toBe(false);
	expect(isReferencedPullRequest(ours, { number: 5, repository: "acme/app" })).toBe(true);
	expect(isReferencedPullRequest(ours, { number: 5, repository: null })).toBe(true);
	expect(pullRequestRows([ours], "https://github.com/ACME/app/pull/5").open).toEqual([ours]);
});
