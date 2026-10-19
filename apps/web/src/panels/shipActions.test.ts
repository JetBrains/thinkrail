import { expect, test } from "bun:test";
import type { BranchStatus, OpenBranchReview, ReviewDetails } from "@thinkrail/contracts";
import {
	fixChecksPrompt,
	integratePrompt,
	type ShipContext,
	shipActions,
	syncCommand,
} from "./shipActions";

const published: BranchStatus = {
	hasOrigin: true,
	provider: "github",
	published: true,
	pushesElsewhere: false,
	ahead: 0,
	behind: 0,
	aheadOfBase: 3,
	onBase: false,
	review: null,
};

function model(status: Partial<BranchStatus>, extra: Partial<ShipContext> = {}) {
	const merged = { ...published, ...status };
	return shipActions({
		status: merged,
		review: merged.review,
		base: "main",
		canSettle: true,
		settled: false,
		removable: true,
		reviewActions: true,
		...extra,
	});
}

const ids = (arm: { primary: { id: string } | null; secondary: { id: string }[] }) => ({
	primary: arm.primary?.id ?? null,
	secondary: arm.secondary.map((a) => a.id),
});

const pr = (state: OpenBranchReview["state"]): OpenBranchReview => ({
	kind: "pull-request",
	number: 128,
	state,
});

test("Default on its base: status only, no PR to open", () => {
	const m = model({ onBase: true, aheadOfBase: 0 });
	expect(m.remote.value).toEqual({ kind: "inSync" });
	expect(ids(m.remote)).toEqual({ primary: null, secondary: [] });
	expect(m.review.value).toBe("base");
	expect(ids(m.review)).toEqual({ primary: null, secondary: [] });
});

test("Default on its base with local commits offers Push — the runner confirms the shared branch", () => {
	const m = model({ onBase: true, aheadOfBase: 0, ahead: 2 });
	expect(m.remote.value).toEqual({ kind: "counts", ahead: 2, behind: 0 });
	expect(m.remote.primary).toMatchObject({ id: "push", short: "Push 2", label: "Push 2 commits" });
	expect(m.review.value).toBe("base");
});

test("a fresh workspace with no commits offers nothing yet", () => {
	const m = model({ published: false, ahead: undefined, behind: undefined, aheadOfBase: 0 });
	expect(m.remote.value).toEqual({ kind: "unpublished" });
	expect(ids(m.remote).primary).toBeNull();
	expect(m.review.value).toBe("none");
	expect(ids(m.review)).toEqual({ primary: null, secondary: [] });
});

test("unpublished commits: Publish in Remote, Open PR with draft and the disabled merge stub", () => {
	const m = model({ published: false, ahead: undefined, behind: undefined });
	expect(ids(m.remote)).toEqual({ primary: "publish", secondary: [] });
	expect(ids(m.review)).toEqual({ primary: "openPr", secondary: ["openDraftPr", "mergeLocal"] });
	expect(m.review.secondary[1]).toMatchObject({
		label: "Merge into main locally",
		disabled: true,
		hint: "Coming soon",
	});
});

test("published and in sync: Open PR is the next step", () => {
	const m = model({});
	expect(m.remote.value).toEqual({ kind: "inSync" });
	expect(ids(m.review).primary).toBe("openPr");
	expect(m.noun).toBe("PR");
});

test("a repository without origin can only (later) merge locally", () => {
	const m = model({
		hasOrigin: false,
		provider: null,
		published: false,
		ahead: undefined,
		behind: undefined,
	});
	expect(m.remote.value).toEqual({ kind: "noOrigin" });
	expect(ids(m.remote).primary).toBeNull();
	expect(ids(m.review)).toEqual({ primary: null, secondary: ["mergeLocal"] });
});

test("GitLab speaks MR and hands creation to GitLab's page", () => {
	const m = model({ provider: "gitlab", ahead: 1 });
	expect(m.noun).toBe("MR");
	expect(ids(m.remote).primary).toBe("push");
	expect(ids(m.review)).toEqual({ primary: "createMr", secondary: ["mergeLocal"] });
});

test("another forge or a local bare origin pushes but offers no PR", () => {
	const m = model({ provider: null, ahead: 1 });
	expect(ids(m.remote).primary).toBe("push");
	expect(ids(m.review)).toEqual({ primary: null, secondary: ["mergeLocal"] });
});

test("published counts unknown read as published, never in sync", () => {
	const m = model({ ahead: undefined, behind: undefined });
	expect(m.remote.value).toEqual({ kind: "published" });
	expect(ids(m.remote).primary).toBeNull();
});

test("an open PR with unpushed commits: Push in Remote, nothing else to do in the PR segment", () => {
	const m = model({ ahead: 2, review: pr("open") });
	expect(ids(m.remote).primary).toBe("push");
	expect(m.review.value).toBe("review");
	expect(ids(m.review)).toEqual({ primary: null, secondary: [] });
});

test("a diverged branch offers Sync, never Push", () => {
	const m = model({ ahead: 1, behind: 2, review: pr("open") });
	expect(m.remote.value).toEqual({ kind: "counts", ahead: 1, behind: 2 });
	expect(m.remote.primary).toMatchObject({ id: "sync", tone: "warning" });
});

test("merged or closed: Settle, or Keep active once settled; Default is never removable", () => {
	const unpublished = { published: false, ahead: undefined, behind: undefined };
	expect(ids(model({ ...unpublished, review: pr("merged") }).review)).toEqual({
		primary: "settle",
		secondary: ["remove"],
	});
	expect(ids(model({ ...unpublished, review: pr("closed") }, { settled: true }).review)).toEqual({
		primary: null,
		secondary: ["keepActive", "reopen", "remove"],
	});
	expect(
		ids(
			model({ ...unpublished, review: pr("merged") }, { canSettle: false, removable: false })
				.review,
		),
	).toEqual({ primary: null, secondary: [] });
});

test("a merged PR still on origin offers to delete the remote branch; a closed one can reopen", () => {
	expect(ids(model({ review: pr("merged") }).review)).toEqual({
		primary: "settle",
		secondary: ["deleteRemote", "remove"],
	});
	expect(ids(model({ review: pr("closed") }).review)).toEqual({
		primary: "settle",
		secondary: ["reopen", "deleteRemote", "remove"],
	});
	const mr: OpenBranchReview = { kind: "merge-request", number: 4, state: "closed" };
	expect(ids(model({ provider: "gitlab", review: mr }).review).secondary).toEqual([
		"deleteRemote",
		"remove",
	]);
	expect(ids(model({ review: pr("closed") }, { reviewActions: false }).review).secondary).toEqual([
		"remove",
	]);
});

const details = (over: Partial<ReviewDetails> = {}): ReviewDetails => ({
	draft: false,
	reviewers: [],
	mergeState: "blocked",
	...over,
});
const openPr = (over: Partial<ReviewDetails> = {}): OpenBranchReview => ({
	...pr("open"),
	details: details(over),
});

test("a draft PR in sync with origin offers Ready for review", () => {
	const m = model({ review: openPr({ draft: true, mergeState: "draft" }) });
	expect(ids(m.review)).toEqual({ primary: "ready", secondary: [] });
	expect(m.review.primary).toMatchObject({ label: "Ready for review", short: "Ready" });
});

test("Merge PR follows the merge state, never approvals alone", () => {
	expect(ids(model({ review: openPr({ mergeState: "clean" }) }).review).primary).toBe("mergePr");
	expect(ids(model({ review: openPr({ mergeState: "unstable" }) }).review).primary).toBe("mergePr");
	expect(ids(model({ review: openPr({ mergeState: "has_hooks" }) }).review).primary).toBe(
		"mergePr",
	);
	const approvedButBlocked = openPr({ mergeState: "blocked", reviewDecision: "approved" });
	expect(ids(model({ review: approvedButBlocked }).review)).toEqual({
		primary: null,
		secondary: [],
	});
	for (const mergeState of ["behind", "dirty", "unknown"] as const) {
		expect(ids(model({ review: openPr({ mergeState }) }).review).primary).toBeNull();
	}
});

test("unpushed or missing remote commits leave the PR's next step to the Remote segment", () => {
	const ahead = model({ ahead: 1, review: openPr({ mergeState: "clean" }) });
	expect(ids(ahead.remote).primary).toBe("push");
	expect(ids(ahead.review)).toEqual({ primary: null, secondary: [] });
	const draftBehind = model({ behind: 2, review: openPr({ draft: true }) });
	expect(ids(draftBehind.review)).toEqual({ primary: null, secondary: ["ready"] });
	const unknown = model({
		ahead: undefined,
		behind: undefined,
		review: openPr({ mergeState: "clean" }),
	});
	expect(ids(unknown.review).primary).toBeNull();
});

test("a host without review actions keeps the open PR's arm empty", () => {
	const m = model({ review: openPr({ draft: true }) }, { reviewActions: false });
	expect(ids(m.review)).toEqual({ primary: null, secondary: [] });
});

test("the resolved review wins over the status review and names the noun", () => {
	const mr: OpenBranchReview = { kind: "merge-request", number: 4, state: "merged" };
	const m = shipActions({
		status: { ...published, review: null },
		review: mr,
		base: "main",
		canSettle: true,
		settled: false,
		removable: true,
		reviewActions: true,
	});
	expect(m.noun).toBe("MR");
	expect(ids(m.review).primary).toBe("settle");
});

test("Sync offers git pull only when origin pulls from where it pushes and the branch quotes safely", () => {
	expect(syncCommand("feature/ship", published)).toBe("git pull --rebase origin feature/ship");
	expect(syncCommand("feature/ship", { ...published, pushesElsewhere: true })).toBeNull();
	expect(syncCommand("feature;rm -rf", published)).toBeNull();
});

test("a push repository that couldn't be read offers no remote action and claims no state", () => {
	const m = model({ published: null, pushesElsewhere: true, ahead: undefined, behind: undefined });
	expect(m.remote.value).toEqual({ kind: "unreachable" });
	expect(ids(m.remote)).toEqual({ primary: null, secondary: [] });
});

test("failing checks put Fix with agent first, ahead of Ready or Merge", () => {
	const checks = { passing: 4, pending: 0, failing: 2, failingNames: ["lint", "e2e"] };
	expect(ids(model({ review: openPr({ checks, mergeState: "unstable" }) }).review)).toEqual({
		primary: "fixChecks",
		secondary: ["mergePr"],
	});
	expect(ids(model({ review: openPr({ checks, draft: true }) }).review)).toEqual({
		primary: "fixChecks",
		secondary: ["ready"],
	});
	expect(model({ review: openPr({ checks }) }).review.primary).toMatchObject({
		label: "Fix with agent",
		tone: "warning",
	});
});

test("the agent prompts name the PR, its failing checks, and what integration may not do", () => {
	const review = openPr({ checks: { passing: 0, pending: 0, failing: 1, failingNames: ["lint"] } });
	const fix = fixChecksPrompt(review, "feature/ship", "main");
	expect(fix).toContain("CI is failing on PR #128 (feature/ship → main): lint.");
	expect(fix).toContain("gh pr checks 128");
	expect(fix).toContain("push the branch");

	const diverged = integratePrompt("feature/ship", { ...published, ahead: 1, behind: 2 });
	expect(diverged).toContain("`origin/feature/ship` has 2 commits this checkout doesn't");
	expect(diverged).toContain("the local branch has 1 commit it doesn't");
	expect(diverged).toContain("without force-pushing");
	expect(diverged).toContain("Don't push");
	expect(integratePrompt("f", { ...published, ahead: 0, behind: 1 })).toContain(
		"`origin/f` has 1 commit this checkout doesn't yet.",
	);
	const split = integratePrompt("f", { ...published, pushesElsewhere: true, ahead: 1, behind: 1 });
	expect(split).toContain("origin's push repository");
	expect(split).toContain("don't integrate by pulling from origin");
});
