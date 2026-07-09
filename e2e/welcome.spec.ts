import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openAppFresh, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

// The first-touch Welcome screen. It replaces the center/right/terminal surface until a workspace is
// active, and its cards adapt across three states:
//   1. no projects        → one "Open project" card (opens the same dropdown as the projects-rail "+")
//   2. project, has specs → "Start building" + "Open project"
//   3. project, no specs  → spec-first "Set up project" + "Start building" + "Open project"
// "Has specs" = the repo has ANY registered spec (a file with id+type frontmatter), via the spec index —
// not a lowercased goal-and-requirements.md filename. The fixture ships SPEC.md files, so it's "has specs"
// by default; state 3 is exercised by stripping those specs for the duration of one test.
// Screenshots are captured for the PR (into e2e/screenshots/, gitignored).

const SHOTS = "e2e/screenshots";
// The fixture's committed specs — removed to force the "needs setup" state, restored via git afterwards.
const FIXTURE_SPECS = ["SPEC.md", join("module-a", "SPEC.md")];

test("opens a clean ThinkRail with no projects imported", async ({ page }) => {
	await openAppFresh(page);

	// The Welcome screen fills the app; the workspace surface is not mounted with no workspace active.
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(page.getByTestId("right-panel")).toHaveCount(0);
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	// State 1: a single "Open project" card, and no project eyebrow (no project selected yet).
	await expect(page.getByTestId("welcome-cta")).toContainText("Open project");
	await expect(page.getByTestId("welcome-action")).toHaveCount(0);

	await page.screenshot({ path: `${SHOTS}/welcome-01-no-projects.png` });

	// The "Open project" card opens the same dropdown as the projects-rail "+".
	await page.getByTestId("welcome-cta").click();
	await expect(page.getByTestId("menu-open-project")).toBeVisible();
});

test("a project with specs offers Start building over Set up", async ({ page }) => {
	// The fixture repo already carries SPEC.md files → the host reports it has specs.
	await openFixtureProject(page);

	await expect(page.getByTestId("welcome")).toBeVisible();
	// The active project's name shows as the eyebrow above the wordmark.
	await expect(page.getByTestId("welcome")).toContainText("sample-project");
	// Two cards: Start building (primary) + Open project — and no "Set up project".
	await expect(page.getByTestId("welcome-cta")).toContainText("Start building");
	await expect(
		page.getByTestId("welcome-action").filter({ hasText: "Open project" }),
	).toBeVisible();
	await expect(page.getByText("Set up project")).toHaveCount(0);

	await page.screenshot({ path: `${SHOTS}/welcome-02-has-specs.png` });
});

test("a project without specs suggests setting it up", async ({ page }) => {
	// Strip the fixture's specs so the host reports no specs, then restore them afterwards (the suite is
	// serial — workers: 1 — so this can't race, and git restores the exact committed content).
	for (const spec of FIXTURE_SPECS) rmSync(join(E2E_FIXTURE_REPO, spec), { force: true });
	try {
		await openFixtureProject(page);

		await expect(page.getByTestId("welcome")).toBeVisible();
		await expect(page.getByTestId("welcome")).toContainText("sample-project");
		// Three cards: Set up project (primary) + Start building + Open project.
		await expect(page.getByTestId("welcome-cta")).toContainText("Set up project");
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Start building" }),
		).toBeVisible();
		await expect(
			page.getByTestId("welcome-action").filter({ hasText: "Open project" }),
		).toBeVisible();

		await page.screenshot({ path: `${SHOTS}/welcome-03-needs-setup.png` });

		// "Set up project" opens the New-Workspace dialog with the prompt hero pre-seeded.
		await page.getByTestId("welcome-cta").click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("ws-prompt")).toHaveValue(/goal-and-requirements\.md/);
		await page.screenshot({ path: `${SHOTS}/welcome-04-setup-dialog.png` });

		// Clear the seed (no agent kick-off — keeps this in the no-agent suite) and create the worktree; it
		// becomes active → the welcome unmounts and the full 3-column surface appears.
		await dialog.getByTestId("ws-prompt").fill("");
		await page.getByTestId("create-workspace").click();
		await expect(dialog).toBeHidden();
		await expect(page.getByTestId("welcome")).toHaveCount(0);
		await expect(page.getByTestId("center-tabs")).toBeVisible();
		await expect(page.getByTestId("right-panel")).toBeVisible();
		await expect(page.getByTestId("terminal-panel")).toBeVisible();
	} finally {
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "checkout", "--", ...FIXTURE_SPECS]);
	}
});
