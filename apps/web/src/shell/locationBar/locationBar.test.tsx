import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type {
	BranchStatus,
	OpenBranchReview,
	Project,
	ReviewDetails,
	Workspace,
} from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationBar } from "./LocationBar";
import {
	checksSummary,
	pluralCommits,
	projectInitial,
	remoteCounts,
	reviewChipLabel,
	reviewSummary,
	reviewTone,
} from "./locationModel";
import { chipClass, pillClass } from "./Segment";

const project: Project = { id: "p1", name: "thinkrail-copy", path: "/repo" } as Project;
const worktree: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "Image selection coordinates bug",
	branch: "fix-image-region-comment-coords",
	worktreePath: "/repo/.worktrees/w1",
	baseBranch: "origin/main",
};
const userOwned: Workspace = {
	id: "w0",
	projectId: "p1",
	kind: "default",
	name: "Default",
	branch: "main",
	worktreePath: "/repo",
	baseBranch: "main",
};
const review: OpenBranchReview = {
	kind: "pull-request",
	number: 648,
	url: "https://github.com/acme/repo/pull/648",
	unpushedCommits: 2,
	behindCommits: 0,
};

function render(
	workspace: Workspace | null,
	openReview: OpenBranchReview | null = null,
	branchStatus: BranchStatus | null = null,
) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<LocationBar
				project={project}
				workspace={workspace}
				review={openReview}
				branchStatus={branchStatus}
				noteOpenReview={() => {}}
				refreshBranchStatus={() => {}}
				onNewWorkspace={() => {}}
			/>
		</TooltipProvider>,
	);
}

const testids = (html: string) => [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]);

test("a worktree renders project, workspace and branch · from base segments", () => {
	const html = render(worktree);
	expect(html).toContain('data-context="workspace"');
	const ids = testids(html);
	expect(ids).toEqual(
		expect.arrayContaining([
			"scope-project-segment",
			"scope-project",
			"scope-workspace-segment",
			"scope-name",
			"scope-branch-segment",
			"scope-branch",
			"scope-base",
		]),
	);
	expect(ids).not.toContain("scope-remote-segment");
	expect(ids).not.toContain("scope-review-segment");
	expect(html).toContain(">Image selection coordinates bug<");
	expect(html).toContain(">fix-image-region-comment-coords<");
	expect(html).toContain(">origin/main<");
	const caption = /Branch<span[^>]*>· from <span data-testid="scope-base">origin\/main<\/span>/;
	expect(html).toMatch(caption);
});

test("an open PR adds the Remote chips and the Pull request chip link", () => {
	const html = render(worktree, review);
	const ids = testids(html);
	expect(ids).toEqual(
		expect.arrayContaining([
			"scope-remote-segment",
			"scope-remote-unpushed",
			"scope-review-segment",
		]),
	);
	expect(ids).not.toContain("scope-remote-behind");
	expect(html).toContain(">2 to push");
	expect(html).toMatch(
		/<a data-testid="scope-review" data-kind="pull-request" href="https:\/\/github.com\/acme\/repo\/pull\/648" target="_blank" rel="noreferrer"/,
	);
	expect(html).toContain("PR #648");
});

test("a user-owned workspace shows a plain Branch caption; a URL-less review stays a static chip", () => {
	const html = render(userOwned, { kind: "pull-request", number: 1, behindCommits: 3 });
	expect(html).not.toContain("scope-base");
	expect(html).not.toContain("· from");
	expect(testids(html)).toContain("scope-remote-behind");
	expect(html).toContain(">3 behind");
	expect(html).toMatch(/<span data-testid="scope-review" data-kind="pull-request"/);
});

test("project home keeps only the Project and Workspace segments", () => {
	const html = render(null);
	expect(html).toContain('data-context="project-home"');
	expect(html).toContain(">Project home<");
	const ids = testids(html);
	expect(ids).not.toContain("scope-branch-segment");
	expect(ids).not.toContain("scope-review-segment");
});

test("segments are separated by space alone and the first one starts flush", () => {
	const html = render(worktree, review);
	const segmentClasses = [
		...html.matchAll(/data-testid="(scope-[a-z]+-segment)" class="([^"]*)"/g),
	].map(([, id, classes]) => [id, classes?.split(/\s+/) ?? []] as const);
	expect(segmentClasses.map(([id]) => id)).toEqual([
		"scope-project-segment",
		"scope-workspace-segment",
		"scope-branch-segment",
		"scope-remote-segment",
		"scope-review-segment",
	]);
	for (const [id, classes] of segmentClasses) {
		expect(classes.filter((c) => /(^|:)border/.test(c))).toEqual([]);
		if (id === "scope-project-segment") {
			expect(classes).toContain("pl-0");
			expect(classes).not.toContain("pl-8");
		} else if (id === "scope-workspace-segment") {
			expect(classes).toEqual(expect.arrayContaining(["pl-0", "sm:pl-8"]));
		} else {
			expect(classes).toContain("pl-8");
		}
	}
});

test("every strip value shares one text style and no caption switches typeface", () => {
	const html = render(worktree, review);
	for (const id of ["scope-project-name", "scope-name", "scope-branch"]) {
		expect(html).toMatch(new RegExp(`data-testid="${id}" class="[^"]*\\btr-title-section\\b`));
	}
	expect(html).not.toContain("tr-code-text");
	const pill = pillClass.split(/\s+/);
	expect(pill.filter((c) => /^text-text-/.test(c))).toEqual(["text-text-muted"]);
});

test("every interactive control in the drag strip opts out of dragging", () => {
	expect(pillClass.split(/\s+/)).toContain("window-no-drag");
	expect(chipClass("success", true).split(/\s+/)).toContain("window-no-drag");
	expect(chipClass("success").split(/\s+/)).not.toContain("window-no-drag");
	const html = render(worktree, review);
	for (const tag of html.matchAll(/<(?:button|a|input)\b[^>]*class="([^"]*)"/g)) {
		expect(tag[1]?.split(/\s+/)).toContain("window-no-drag");
	}
});

test("status chips rest on their tone's tinted step and hover to the muted one", () => {
	for (const tone of ["success", "warning", "info"] as const) {
		const classes = chipClass(tone, true).split(/\s+/);
		expect(classes).toContain(`bg-feedback-${tone}-subtle`);
		expect(classes).toContain(`text-feedback-${tone}`);
		expect(classes).toContain(`hover:bg-feedback-${tone}-muted`);
		expect(classes).toContain("window-no-drag");
	}
	const neutral = chipClass("neutral").split(/\s+/);
	expect(neutral).toContain("bg-control-bg-selected");
	expect(neutral).toContain("text-text-muted");
	expect(neutral).not.toContain("window-no-drag");
});

test("the location bar never hard-codes typography or colour outside the token system", () => {
	for (const file of [
		"Segment.tsx",
		"BranchSegment.tsx",
		"WorkspaceSegment.tsx",
		"ProjectSegment.tsx",
		"ShipSegments.tsx",
	]) {
		const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
		expect(source).not.toMatch(/\btext-\[|\bfont-(?:mono|sans|medium|semibold)\b|#[0-9a-f]{3,8}\b/);
	}
});

test("a merged review turns the Pull request chip info and drops the Remote segment", () => {
	const merged: OpenBranchReview = { ...review, state: "merged", changedAt: 1 };
	const html = render(worktree, merged);
	expect(html).toContain("Merged #648");
	expect(html).toMatch(/data-testid="scope-review"[^>]*data-state-tone="info"/);
	expect(testids(html)).not.toContain("scope-remote-segment");
	expect(reviewTone({ ...review, state: "closed" })).toBe("neutral");
	expect(reviewChipLabel(currentTranslator(), { ...review, state: "closed" })).toBe("Closed #648");
	expect(
		reviewChipLabel(currentTranslator(), { kind: "merge-request", number: 7, state: "merged" }),
	).toBe("Merged !7");
	expect(reviewChipLabel(currentTranslator(), { kind: "merge-request", number: 7 })).toBe("MR !7");
	expect(remoteCounts(merged)).toBeNull();
});

test("host-kept review fields stay hidden until the host advertises snapshot support", () => {
	const workspace: Workspace = {
		...worktree,
		review: { kind: "pull-request", number: 618, state: "merged", changedAt: 1 },
	};
	const html = render(workspace, null);
	expect(html).not.toContain("Merged #618");
	expect(testids(html)).not.toContain("scope-review-segment");
});

test("settled facts stay hidden until the host advertises support", () => {
	const DAY = 24 * 60 * 60_000;
	const settled: Workspace = { ...worktree, lastActiveAt: Date.now() - 10 * DAY };
	expect(testids(render(settled))).not.toContain("scope-workspace-settled");
});

test("remote counts distinguish an unknown fallback from a known in-sync review", () => {
	expect(remoteCounts(null)).toBeNull();
	expect(remoteCounts({ kind: "pull-request", number: 1 }, false)).toBe("unknown");
	expect(remoteCounts({ kind: "pull-request", number: 1 }, true)).toBeNull();
	expect(
		remoteCounts({ kind: "pull-request", number: 1, unpushedCommits: 0, behindCommits: 0 }),
	).toBeNull();
	expect(remoteCounts({ kind: "merge-request", number: 1, unpushedCommits: 2 })).toEqual({
		unpushed: 2,
		behind: 0,
	});
	expect(remoteCounts({ kind: "merge-request", number: 1, behindCommits: 3 })).toEqual({
		unpushed: 0,
		behind: 3,
	});
});

test("project initials and commit plurals", () => {
	expect(projectInitial("thinkrail-copy")).toBe("T");
	expect(projectInitial("  émile")).toBe("É");
	expect(projectInitial("")).toBe("?");
	expect(pluralCommits(1)).toBe("1 commit");
	expect(pluralCommits(2)).toBe("2 commits");
});

const status = (over: Partial<BranchStatus> = {}): BranchStatus => ({
	hasOrigin: true,
	provider: "github",
	published: true,
	pushesElsewhere: false,
	ahead: 0,
	behind: 0,
	aheadOfBase: 2,
	onBase: false,
	review: null,
	...over,
});

test("v87: Remote and Pull request render for a review-free branch with the next action", () => {
	const html = render(
		worktree,
		null,
		status({ published: false, ahead: undefined, behind: undefined }),
	);
	const ids = testids(html);
	expect(ids).toContain("scope-remote-segment");
	expect(ids).toContain("scope-review-segment");
	expect(html).toMatch(/data-testid="scope-ship-remote-primary"[^>]*data-action="publish"/);
	expect(html).toMatch(/data-testid="scope-ship-review-primary"[^>]*data-action="openPr"/);
	expect(ids).toContain("scope-ship-review-menu");
	expect(ids).not.toContain("scope-review-value");
	for (const tag of html.matchAll(/<(?:button|a|input)\b[^>]*class="([^"]*)"/g)) {
		expect(tag[1]?.split(/\s+/)).toContain("window-no-drag");
	}
});

test("v87: an in-sync branch states it; Default on its base shows — and no PR action", () => {
	const synced = render(worktree, null, status());
	expect(synced).toMatch(/data-testid="scope-remote-value"[^>]*data-kind="inSync"/);
	expect(synced).toContain("In sync");
	const base = render(userOwned, null, status({ onBase: true, aheadOfBase: 0 }));
	expect(base).toMatch(/data-testid="scope-review-value"[^>]*data-kind="base"/);
	expect(testids(base)).not.toContain("scope-ship-review-primary");
});

test("v87: a diverged branch keeps its chips beside Sync; an open review keeps its chip", () => {
	const html = render(worktree, review, status({ ahead: 1, behind: 2, review }));
	expect(testids(html)).toContain("scope-remote-unpushed");
	expect(testids(html)).toContain("scope-remote-behind");
	expect(html).toMatch(/data-testid="scope-ship-remote-primary"[^>]*data-action="sync"/);
	expect(testids(html)).toContain("scope-review");
	expect(testids(html)).not.toContain("scope-ship-review-primary");
});

test("v87: without an origin the Remote says so and the PR segment only holds the merge stub", () => {
	const html = render(
		worktree,
		null,
		status({
			hasOrigin: false,
			provider: null,
			published: false,
			ahead: undefined,
			behind: undefined,
		}),
	);
	expect(html).toMatch(/data-kind="noOrigin"/);
	expect(html).toContain("No remote");
	expect(testids(html)).toContain("scope-ship-review-menu");
	expect(testids(html)).not.toContain("scope-ship-review-primary");
});

const openPr = (details: Partial<ReviewDetails>): OpenBranchReview => ({
	kind: "pull-request",
	number: 128,
	state: "open",
	url: "https://github.com/acme/repo/pull/128",
	details: { draft: false, reviewers: [], mergeState: "blocked", ...details },
});

test("v88: a draft PR reads Draft #N in the neutral tone and carries its checks glyph", () => {
	const draft = openPr({
		draft: true,
		mergeState: "draft",
		checks: { passing: 1, pending: 2, failing: 0, failingNames: [] },
	});
	const html = render(worktree, draft, status({ review: draft }));
	expect(html).toContain("Draft #128");
	expect(html).toMatch(/data-testid="scope-review"[^>]*data-state-tone="neutral"/);
	expect(html).toMatch(/data-testid="scope-review-checks-glyph" data-verdict="pending"/);
	expect(html).toContain('aria-label="Open Draft #128 · 2 of 3 checks running"');
	const failing = openPr({
		checks: { passing: 2, pending: 0, failing: 1, failingNames: ["lint"] },
	});
	expect(render(worktree, failing, status({ review: failing }))).toMatch(
		/data-testid="scope-review-checks-glyph" data-verdict="failing"/,
	);
});

test("before the host advertises review actions the open PR keeps its chip without actions", () => {
	const clean = openPr({ mergeState: "clean" });
	const html = render(worktree, clean, status({ review: clean }));
	expect(testids(html)).toContain("scope-review");
	expect(testids(html)).not.toContain("scope-ship-review-primary");
});

test("checks and review decision read as information", () => {
	expect(
		checksSummary(currentTranslator(), { passing: 6, pending: 0, failing: 0, failingNames: [] }),
	).toBe("6 checks passed");
	expect(
		checksSummary(currentTranslator(), { passing: 1, pending: 1, failing: 0, failingNames: [] }),
	).toBe("1 of 2 checks running");
	expect(
		checksSummary(currentTranslator(), {
			passing: 3,
			pending: 1,
			failing: 2,
			failingNames: ["lint", "e2e"],
		}),
	).toBe("2 checks failing: lint, e2e");
	const details = (over: Partial<ReviewDetails>): ReviewDetails => ({
		draft: false,
		reviewers: [],
		mergeState: "clean",
		...over,
	});
	expect(
		reviewSummary(
			currentTranslator(),
			details({ reviewDecision: "approved", reviewers: [{ login: "anna", state: "approved" }] }),
		),
	).toEqual({ text: "Approved by @anna", tone: "success" });
	expect(
		reviewSummary(
			currentTranslator(),
			details({
				reviewDecision: "changes_requested",
				reviewers: [
					{ login: "anna", state: "approved" },
					{ login: "bob", state: "changes_requested" },
				],
			}),
		),
	).toEqual({ text: "Changes requested by @bob", tone: "warning" });
	expect(
		reviewSummary(currentTranslator(), details({ reviewDecision: "review_required" })),
	).toEqual({
		text: "Waiting for review",
		tone: "muted",
	});
	expect(
		reviewSummary(
			currentTranslator(),
			details({ reviewers: [{ login: "cy", state: "approved" }] }),
		),
	).toEqual({
		text: "Approved by @cy",
		tone: "success",
	});
	expect(reviewSummary(currentTranslator(), details({}))).toBeNull();
});
