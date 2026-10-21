import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	worktreeRow,
} from "./fixtures/app";
import { commitFile, gitAs } from "./fixtures/git";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

// The topbar's Remote and Pull request segments without a forge review (v87 `workspace.branchStatus`).
// Every journey wires `origin` into the lane's SHARED fixture repo config (worktrees share remotes); the
// app fixture's reset removes it before the next test. A GitHub-looking origin pushes into a local bare repo
// (`pushInsteadOf`) and refuses https fetches (`protocol.https.allow never`), so nothing leaves the machine;
// gh never runs (hermetic PATH + THINKRAIL_GH_OFFLINE), which makes Open PR end on the compare hand-off.

function bareRemote(): string {
	const bare = mkdtempSync(join(tmpdir(), "thinkrail-ship-origin-"));
	gitAs(bare, "init", "--bare");
	return bare;
}

async function revalidate(page: Page): Promise<void> {
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

test("Remote publishes, then pushes new commits, with no PR involved", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const remote = page.getByTestId("scope-remote-segment");
	const remoteValue = page.getByTestId("scope-remote-value");
	const remoteAction = page.getByTestId("scope-ship-remote-primary");
	await expect(remoteValue).toHaveAttribute("data-kind", "noOrigin");
	await expect(page.getByTestId("scope-review-value")).toHaveText("No PR");

	commitFile(workspace.worktreePath, "ship.ts", "export const ship = 1;\n", "feat: ship it");
	const bare = bareRemote();
	gitAs(workspace.worktreePath, "remote", "add", "origin", bare);
	await revalidate(page);
	await expect(remoteAction).toHaveAttribute("data-action", "publish");
	// A local bare origin is no forge: no Open PR, only the (disabled) merge stub.
	await expect(page.getByTestId("scope-ship-review-primary")).toHaveCount(0);
	await page.getByTestId("scope-ship-review-menu").click();
	await expect(
		page.locator('[data-testid="scope-ship-action"][data-action="mergeLocal"]'),
	).toHaveAttribute("data-disabled", "");
	await page.keyboard.press("Escape");
	await testInfo.attach("ship-unpublished", {
		body: await page
			.getByTestId("topbar")
			.screenshot({ path: testInfo.outputPath("ship-unpublished.png") }),
		contentType: "image/png",
	});

	await remoteAction.click();
	await expect(page.getByText("Branch published").first()).toBeVisible();
	const branch = gitAs(workspace.worktreePath, "rev-parse", "--abbrev-ref", "HEAD");
	expect(gitAs(bare, "rev-parse", `refs/heads/${branch}`)).toBe(
		gitAs(workspace.worktreePath, "rev-parse", "HEAD"),
	);
	await expect(remoteValue).toHaveAttribute("data-kind", "inSync");
	await expect(remoteAction).toHaveCount(0);

	const second = commitFile(
		workspace.worktreePath,
		"ship.ts",
		"export const ship = 2;\n",
		"feat: ship again",
	);
	await revalidate(page);
	await expect(remoteAction).toHaveAttribute("data-action", "push");
	await expect(remoteAction).toContainText("Push 1");
	await testInfo.attach("ship-ahead", {
		body: await page
			.getByTestId("topbar")
			.screenshot({ path: testInfo.outputPath("ship-ahead.png") }),
		contentType: "image/png",
	});
	await remoteAction.click();
	await expect(page.getByText("Pushed 1 commit").first()).toBeVisible();
	await expect
		.poll(() => gitAs(bare, "rev-parse", `refs/heads/${branch}`), { timeout: 10_000 })
		.toBe(second);
	await expect(remoteValue).toHaveAttribute("data-kind", "inSync");
	await expect(remote).toBeVisible();
});

test("pushing the Default workspace's own base branch asks first", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const bare = bareRemote();
	const startSha = gitAs(E2E_FIXTURE_REPO, "rev-parse", "HEAD");
	try {
		gitAs(E2E_FIXTURE_REPO, "remote", "add", "origin", bare);
		gitAs(E2E_FIXTURE_REPO, "push", "-q", "--set-upstream", "origin", "main");
		const local = commitFile(E2E_FIXTURE_REPO, "notes.txt", "local-only\n", "chore: local note");
		await revalidate(page);
		await expect(page.getByTestId("scope-review-value")).toHaveAttribute("data-kind", "base");
		const push = page.getByTestId("scope-ship-remote-primary");
		await expect(push).toHaveAttribute("data-action", "push");

		await push.click();
		const confirm = page.getByTestId("confirm-dialog");
		await expect(confirm).toContainText("Push to main?");
		await expect(confirm).toContainText("straight to origin/main");
		await page.keyboard.press("Escape");
		expect(gitAs(bare, "rev-parse", "refs/heads/main")).toBe(startSha);

		await push.click();
		await page.getByTestId("ship-confirm-base-push").click();
		await expect
			.poll(() => gitAs(bare, "rev-parse", "refs/heads/main"), { timeout: 10_000 })
			.toBe(local);
	} finally {
		gitAs(E2E_FIXTURE_REPO, "reset", "-q", "--hard", startSha);
	}
});

test("Try again after a failed base push never pushes a branch the user didn't confirm", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	const bare = bareRemote();
	const startSha = gitAs(E2E_FIXTURE_REPO, "rev-parse", "HEAD");
	const hook = join(E2E_FIXTURE_REPO, ".git", "hooks", "pre-push");
	try {
		gitAs(E2E_FIXTURE_REPO, "remote", "add", "origin", bare);
		gitAs(E2E_FIXTURE_REPO, "push", "-q", "--set-upstream", "origin", "main");
		commitFile(E2E_FIXTURE_REPO, "notes.txt", "local-only\n", "chore: local note");
		mkdirSync(join(E2E_FIXTURE_REPO, ".git", "hooks"), { recursive: true });
		writeFileSync(
			hook,
			"#!/bin/sh\necho \"fatal: Authentication failed for 'origin'\" >&2\nexit 1\n",
		);
		chmodSync(hook, 0o755);
		await revalidate(page);
		await page.getByTestId("scope-ship-remote-primary").click();
		await page.getByTestId("ship-confirm-base-push").click();
		const setup = page.getByTestId("open-pr-setup-dialog");
		await expect(setup).toBeVisible();

		gitAs(E2E_FIXTURE_REPO, "switch", "-q", "-c", "release");
		await revalidate(page);
		await expect(page.getByTestId("scope-branch")).toHaveText("release");
		rmSync(hook);
		await page.getByTestId("open-pr-setup-retry").click();
		await expect(page.getByText(/moved from "main" to "release"/).first()).toBeVisible();
		expect(gitAs(bare, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe(
			"refs/heads/main",
		);
	} finally {
		rmSync(hook, { force: true });
		gitAs(E2E_FIXTURE_REPO, "switch", "-q", "main");
		gitAs(E2E_FIXTURE_REPO, "reset", "-q", "--hard", startSha);
	}
});

test("Open PR from the topbar composes from commits or the repository template", async ({
	page,
	context,
}, testInfo) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	await context.route("https://github.com/**", (route) => route.fulfill({ body: "" }));
	const bare = bareRemote();
	try {
		mkdirSync(join(workspace.worktreePath, ".github"), { recursive: true });
		writeFileSync(
			join(workspace.worktreePath, ".github", "pull_request_template.md"),
			"## Problem\n\n## Checklist\n- [ ] tests\n",
		);
		gitAs(workspace.worktreePath, "add", "--", ".github");
		gitAs(workspace.worktreePath, "commit", "--no-verify", "-m", "docs: add a PR template");
		commitFile(workspace.worktreePath, "ship.ts", "export const ship = 1;\n", "feat: ship segment");
		gitAs(workspace.worktreePath, "remote", "add", "origin", "https://github.com/acme/sample.git");
		gitAs(
			workspace.worktreePath,
			"config",
			`url.${bare}.pushInsteadOf`,
			"https://github.com/acme/sample.git",
		);
		gitAs(workspace.worktreePath, "config", "protocol.https.allow", "never");
		await revalidate(page);

		const openPr = page.getByTestId("scope-ship-review-primary");
		await expect(openPr).toHaveAttribute("data-action", "openPr");
		await openPr.click();
		const compose = page.getByTestId("open-pr-compose-dialog");
		const body = page.getByTestId("open-pr-compose-body");
		await expect(compose).toBeVisible();
		await expect(body).toHaveValue("- docs: add a PR template\n- feat: ship segment");
		const sources = page.getByTestId("open-pr-compose-source");
		await expect(sources.locator('[data-source="commits"]')).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(sources.locator('[data-source="plan"]')).toHaveAttribute("aria-pressed", "false");
		await sources.locator('[data-source="template"]').click();
		await expect(body).toHaveValue("## Problem\n\n## Checklist\n- [ ] tests");
		await expect(page.getByTestId("open-pr-compose-generate")).toContainText(
			"Fill template with agent",
		);
		await testInfo.attach("ship-compose", {
			body: await page.screenshot({ path: testInfo.outputPath("ship-compose.png") }),
			contentType: "image/png",
		});
		await body.fill("## Problem\n\nThe topbar had no next step.");

		const popup = page.waitForEvent("popup");
		await page.getByTestId("open-pr-compose-submit").click();
		const compare = new URL((await popup).url());
		expect(compare.pathname).toContain("/acme/sample/compare/main...");
		expect(compare.searchParams.get("body")).toBe("## Problem\n\nThe topbar had no next step.");
		await expect(page.getByText("Branch pushed").first()).toBeVisible();
		const branch = gitAs(workspace.worktreePath, "rev-parse", "--abbrev-ref", "HEAD");
		expect(gitAs(bare, "rev-parse", `refs/heads/${branch}`)).toBe(
			gitAs(workspace.worktreePath, "rev-parse", "HEAD"),
		);
	} finally {
		gitAs(workspace.worktreePath, "config", "--unset", "protocol.https.allow");
		gitAs(workspace.worktreePath, "config", "--unset", `url.${bare}.pushInsteadOf`);
		rmSync(bare, { recursive: true, force: true });
	}
});

test("an Open PR draft belongs to its workspace and closes when the scope moves", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const second = await createWorkspaceViaDialog(page);
	const currentHash = () => page.evaluate(() => window.location.hash);
	await worktreeRow(page, "workspace-1")
		.getByRole("button", { name: "workspace-1", exact: true })
		.click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
	const firstHash = await currentHash();
	await worktreeRow(page, "workspace-2")
		.getByRole("button", { name: "workspace-2", exact: true })
		.click();
	await expect(page.getByTestId("scope-name")).toHaveText("workspace-2");
	await expect.poll(currentHash).not.toBe(firstHash);

	commitFile(second.worktreePath, "ship.ts", "export const ship = 1;\n", "feat: ship segment");
	gitAs(second.worktreePath, "remote", "add", "origin", "https://github.com/acme/sample.git");
	gitAs(second.worktreePath, "config", "protocol.https.allow", "never");
	try {
		await revalidate(page);
		await page.getByTestId("scope-ship-review-primary").click();
		const compose = page.getByTestId("open-pr-compose-dialog");
		await expect(compose).toBeVisible();

		await page.goBack();
		await expect.poll(currentHash).toBe(firstHash);
		await expect(page.getByTestId("scope-name")).toHaveText("workspace-1");
		await expect(compose).toHaveCount(0);
	} finally {
		gitAs(second.worktreePath, "config", "--unset", "protocol.https.allow");
	}
});
