import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { git, gitAs, gitText } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";

const GROUP = "extension-git-pulse";
const EXTENSION = "git-pulse";
const REMOTE = join(E2E_DATA_DIR, "git-pulse-remote.git");
const PEER = join(E2E_DATA_DIR, "git-pulse-peer");
const STAGED = "git-pulse-staged.txt";
const UNTRACKED = "git-pulse-untracked.txt";
const MODIFIED = "notes.txt";

const seedRemote = () => {
	git(E2E_DATA_DIR, "init", "-q", "--bare", "-b", "main", REMOTE);
	git(E2E_FIXTURE_REPO, "remote", "add", "origin", REMOTE);
	git(E2E_FIXTURE_REPO, "push", "-q", "-u", "origin", "main");
	git(E2E_DATA_DIR, "clone", "-q", REMOTE, PEER);
	writeFileSync(join(PEER, "TEAMMATE.md"), "from a teammate\n");
	git(PEER, "add", "TEAMMATE.md");
	gitAs(PEER, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "Add teammate notes");
	git(PEER, "push", "-q", "origin", "main");
};

const seedChanges = () => {
	writeFileSync(join(E2E_FIXTURE_REPO, STAGED), "staged\n");
	git(E2E_FIXTURE_REPO, "add", STAGED);
	writeFileSync(join(E2E_FIXTURE_REPO, UNTRACKED), "untracked\n");
	writeFileSync(join(E2E_FIXTURE_REPO, MODIFIED), "plain-text-fixture\nedited by git-pulse e2e\n");
};

test.use({ viewport: { width: 1600, height: 1000 } });

test.afterEach(async () => {
	await removeExtension(EXTENSION);
	git(E2E_FIXTURE_REPO, "reset", "-q", "--", STAGED);
	git(E2E_FIXTURE_REPO, "checkout", "-q", "--", MODIFIED);
	rmSync(join(E2E_FIXTURE_REPO, STAGED), { force: true });
	rmSync(join(E2E_FIXTURE_REPO, UNTRACKED), { force: true });
	if (gitText(E2E_FIXTURE_REPO, "remote").includes("origin"))
		git(E2E_FIXTURE_REPO, "remote", "remove", "origin");
	rmSync(REMOTE, { recursive: true, force: true });
	rmSync(PEER, { recursive: true, force: true });
});

test("git-pulse shows branch status, commits, changed files, and a fetch result", async ({
	page,
}) => {
	const headBefore = gitText(E2E_FIXTURE_REPO, "rev-parse", "HEAD").trim();
	seedRemote();
	seedChanges();
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");

	const status = page.getByTestId("git-pulse-status");
	await expect(status).toHaveAttribute("data-state", "ready");
	await expect(status).toContainText("main");
	await expect(status).toContainText("↑0 ↓0");
	await expect(status).toContainText(/\d+ changed/);
	await shot(status, GROUP, "10-git-pulse-status");

	await status.click();
	const dashboard = page.getByTestId("git-pulse-dashboard");
	await expect(dashboard).toHaveAttribute("data-state", "ready");
	await expect(dashboard.getByTestId("git-pulse-head")).toHaveText("main");
	await expect(dashboard.getByTestId("git-pulse-commit")).toHaveCount(1);
	const files = dashboard.getByTestId("git-pulse-file");
	await expect(files.filter({ hasText: STAGED })).toHaveAttribute("data-kind", "tracked");
	await expect(files.filter({ hasText: UNTRACKED })).toHaveAttribute("data-kind", "untracked");
	await expect(files.filter({ hasText: MODIFIED })).toHaveAttribute("data-kind", "tracked");
	await expect(dashboard.getByTestId("git-pulse-count-staged")).toContainText("1");
	await shot(dashboard, GROUP, "10-git-pulse-dashboard");

	await dashboard.getByTestId("git-pulse-fetch").click();
	const result = dashboard.getByTestId("git-pulse-fetch-result");
	await expect(result).toHaveAttribute("data-ok", "true");
	await expect(result).toContainText("main");
	await expect(dashboard.getByTestId("git-pulse-ahead-behind")).toHaveText("↑0 ↓1");
	await expect(status).toContainText("↑0 ↓1");
	await shot(dashboard, GROUP, "10-git-pulse-fetched");
	await shot(status, GROUP, "10-git-pulse-status-behind");
	await shot(page, GROUP, "10-git-pulse-app");
	expect(gitText(E2E_FIXTURE_REPO, "rev-parse", "HEAD").trim()).toBe(headBefore);
});
