import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { OpenBranchReview, Project, Workspace } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationBar } from "./LocationBar";
import {
	pluralCommits,
	projectInitial,
	remoteCounts,
	reviewChipLabel,
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

function render(workspace: Workspace | null, openReview: OpenBranchReview | null = null) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<LocationBar
				project={project}
				workspace={workspace}
				review={openReview}
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

test("an open PR adds the REMOTE chips and the PULL REQUEST chip link", () => {
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

test("a user-owned workspace shows a plain BRANCH caption; a URL-less review stays a static chip", () => {
	const html = render(userOwned, { kind: "pull-request", number: 1, behindCommits: 3 });
	expect(html).not.toContain("scope-base");
	expect(html).not.toContain("· from");
	expect(testids(html)).toContain("scope-remote-behind");
	expect(html).toContain(">3 behind");
	expect(html).toMatch(/<span data-testid="scope-review" data-kind="pull-request"/);
});

test("project home keeps only the PROJECT and WORKSPACE segments", () => {
	const html = render(null);
	expect(html).toContain('data-context="project-home"');
	expect(html).toContain(">Project home<");
	const ids = testids(html);
	expect(ids).not.toContain("scope-branch-segment");
	expect(ids).not.toContain("scope-review-segment");
});

test("the first segment draws no hairline before the location and later segments do", () => {
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
		if (id === "scope-project-segment") {
			expect(classes).toContain("border-l-0");
			expect(classes).toContain("pl-0");
			expect(classes).not.toContain("border-l");
			expect(classes).not.toContain("pl-12");
		} else if (id === "scope-workspace-segment") {
			expect(classes).toEqual(
				expect.arrayContaining(["border-l-0", "pl-0", "sm:border-l", "sm:pl-12"]),
			);
		} else {
			expect(classes).toContain("border-l");
			expect(classes).toContain("pl-12");
		}
	}
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

test("the location bar never hard-codes typography or colour outside the token system", () => {
	for (const file of [
		"Segment.tsx",
		"BranchSegment.tsx",
		"WorkspaceSegment.tsx",
		"ProjectSegment.tsx",
	]) {
		const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
		expect(source).not.toMatch(/\btext-\[|\bfont-(?:mono|sans|medium|semibold)\b|#[0-9a-f]{3,8}\b/);
	}
});

test("a merged review turns the PULL REQUEST chip info and drops the REMOTE segment", () => {
	const merged: OpenBranchReview = { ...review, state: "merged", changedAt: 1 };
	const html = render(worktree, merged);
	expect(html).toContain("Merged #648");
	expect(html).toMatch(/data-testid="scope-review"[^>]*data-state-tone="info"/);
	expect(testids(html)).not.toContain("scope-remote-segment");
	expect(reviewTone({ ...review, state: "closed" })).toBe("neutral");
	expect(reviewChipLabel({ ...review, state: "closed" })).toBe("Closed #648");
	expect(reviewChipLabel({ kind: "merge-request", number: 7, state: "merged" })).toBe("Merged !7");
	expect(reviewChipLabel({ kind: "merge-request", number: 7 })).toBe("MR !7");
	expect(remoteCounts(merged)).toBeNull();
});

test("without a fresh answer the chip falls back to the record's host-kept review snapshot", () => {
	const merged: Workspace = {
		...worktree,
		review: { kind: "pull-request", number: 618, state: "merged", changedAt: 1 },
	};
	const html = render(merged, null);
	expect(html).toContain("Merged #618");
	expect(testids(html)).toContain("scope-review-segment");
	expect(testids(render(worktree, null))).not.toContain("scope-review-segment");
});

test("a settled active workspace announces itself in the WORKSPACE caption", () => {
	const DAY = 24 * 60 * 60_000;
	const settled: Workspace = { ...worktree, lastActiveAt: Date.now() - 10 * DAY };
	expect(testids(render(settled))).toContain("scope-workspace-settled");
	expect(render(settled)).toContain("· settled");
	expect(testids(render({ ...settled, settledOverride: "active" }))).not.toContain(
		"scope-workspace-settled",
	);
	expect(testids(render(worktree))).not.toContain("scope-workspace-settled");
});

test("remote counts collapse to null when nothing is ahead or behind", () => {
	expect(remoteCounts(null)).toBeNull();
	expect(remoteCounts({ kind: "pull-request", number: 1 })).toBeNull();
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
