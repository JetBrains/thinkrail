import { expect, test } from "bun:test";
import type { BranchStatus, OpenBranchReview } from "@thinkrail/contracts";
import { type ShipContext, shipActions, syncCommand } from "./shipActions";

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
	expect(ids(model({ review: pr("merged") }).review)).toEqual({
		primary: "settle",
		secondary: ["remove"],
	});
	expect(ids(model({ review: pr("closed") }, { settled: true }).review)).toEqual({
		primary: null,
		secondary: ["keepActive", "remove"],
	});
	expect(
		ids(model({ review: pr("merged") }, { canSettle: false, removable: false }).review),
	).toEqual({ primary: null, secondary: [] });
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
	});
	expect(m.noun).toBe("MR");
	expect(ids(m.review).primary).toBe("settle");
});

test("Sync offers git pull only when origin pulls from where it pushes and the branch quotes safely", () => {
	expect(syncCommand("feature/ship", published)).toBe("git pull --rebase origin feature/ship");
	expect(syncCommand("feature/ship", { ...published, pushesElsewhere: true })).toBeNull();
	expect(syncCommand("feature;rm -rf", published)).toBeNull();
});
