import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { loadPersistedWorkspaces, openFixtureProject } from "./fixtures/app";
import { gitAs } from "./fixtures/git";
import { type FakePr, githubOrigin, writeGhScenario } from "./fixtures/github";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

// v127 New Workspace › Review a pull request against the fake gh + github-ssh seam (e2e/SPEC.md).

const PR_URL = (number: number) => `https://github.com/acme/sample/pull/${number}`;

function pr(number: number, over: Partial<FakePr> = {}): FakePr {
	return { number, headRefName: `feature-${number}`, state: "OPEN", ...over };
}

function githubProject() {
	const origin = githubOrigin(E2E_FIXTURE_REPO);
	gitAs(E2E_FIXTURE_REPO, "push", "-q", "origin", "HEAD:refs/heads/main");
	return origin;
}

function trackStartCreate(page: Page): Record<string, unknown>[] {
	const calls: Record<string, unknown>[] = [];
	page.on("websocket", (socket) => {
		socket.on("framesent", ({ payload }) => {
			const frame = JSON.parse(String(payload)) as {
				method?: string;
				params?: Record<string, unknown>;
			};
			if (frame.method === "workspace.startCreate" && frame.params) calls.push(frame.params);
		});
	});
	return calls;
}

async function openReviewMode(page: Page) {
	await page.getByTestId("welcome-title").click();
	await page.keyboard.press("ControlOrMeta+n");
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("ws-target-review").click();
	await expect(dialog.getByRole("heading", { name: "Review a pull request" })).toBeVisible();
	const picker = dialog.getByTestId("ws-pr-picker");
	await expect(picker).toBeFocused();
	return { dialog, picker };
}

test("picking a pull request starts a review workspace from its base with the seeded skill command", async ({
	page,
	baseURL,
}) => {
	const startCreates = trackStartCreate(page);
	await openFixtureProject(page);
	const origin = githubProject();
	try {
		writeGhScenario({
			prs: [
				pr(42, {
					title: "Make settings searchable",
					isDraft: true,
					additions: 1_200,
					deletions: 30,
				}),
				pr(41, {
					title: "Add search",
					author: "ada",
					additions: 120,
					deletions: 4,
					reviewRequested: true,
				}),
				pr(77, { title: "Old cleanup", state: "MERGED", mergedAt: "2026-01-02T00:00:00Z" }),
			],
		});
		const { dialog, picker } = await openReviewMode(page);

		await expect(dialog.getByTestId("ws-prompt")).toBeHidden();
		await expect(dialog.getByTestId("ws-manage-skills")).toHaveCount(0);
		await expect(dialog.getByTestId("ws-branch-picker")).toHaveCount(0);
		const start = page.getByTestId("create-workspace");
		await expect(start).toContainText("Start review");
		await expect(start).toBeDisabled();

		await page.keyboard.press("Enter");
		const list = page.getByTestId("pull-request-picker");
		await expect(list).toBeVisible();
		const waiting = list.getByTestId("pull-request-group-waiting");
		await expect(waiting.getByTestId("pull-request-option")).toHaveCount(1);
		await expect(waiting.locator('[data-pr="41"]')).toContainText("Add search");
		await expect(waiting.locator('[data-pr="41"]')).toContainText("ada · +120 −4");
		const open = list.getByTestId("pull-request-group-open");
		await expect(open.locator('[data-pr="42"]')).toContainText("Draft");
		await expect(list.locator('[data-pr="77"]')).toHaveCount(0);

		await list.getByTestId("pull-request-picker-search").fill("#77");
		const found = list.locator('[data-pr="77"]');
		await expect(found).toContainText("Old cleanup");
		await expect(found.getByTestId("pull-request-tag")).toHaveText("Merged");

		await list.getByTestId("pull-request-picker-search").fill("search ada");
		await expect(list.getByTestId("pull-request-option")).toHaveCount(1);
		await list.locator('[data-pr="41"]').click();
		await expect(list).toBeHidden();
		await expect(picker).toContainText("#41 Add search");
		await expect(picker).toBeFocused();
		await expect(start).toBeEnabled();

		const before = new Set(loadPersistedWorkspaces().map((w) => w.id));
		await page.keyboard.press("Enter");
		await expect(dialog).toBeHidden();

		await expect.poll(() => startCreates.length).toBe(1);
		const [params] = startCreates;
		expect(params?.baseRef).toBe("origin/main");
		expect(params?.name).toBeUndefined();
		expect(params?.kickoff).toMatchObject({ text: `/skill:reviewing-a-pr ${PR_URL(41)}` });
		expect(params?.kickoff).not.toHaveProperty("images");

		await expect
			.poll(
				() =>
					loadPersistedWorkspaces().find((w) => !before.has(w.id) && w.kind !== "default")
						?.baseBranch,
			)
			.toBe("origin/main");
		const firstMessage = page.locator('[data-testid="chat-message"][data-role="user"]').first();
		await expect(firstMessage).toContainText("reviewing-a-pr");
		await expect(firstMessage).toContainText(PR_URL(41));

		if (!baseURL) throw new Error("review spec needs the isolated host URL");
		const wire = await E2eWire.connect(Number(new URL(baseURL).port));
		try {
			const projects = await wire.request("project.list", {});
			const project = projects.find((p) => realpathSync(p.path) === realpathSync(E2E_FIXTURE_REPO));
			if (!project) throw new Error("fixture project is not open");
			const skills = await wire.request("skill.list", { projectId: project.id });
			expect(skills.map((skill) => skill.name)).toContain("skill:reviewing-a-pr");
		} finally {
			wire.close();
		}
	} finally {
		origin.dispose();
	}
});

test("a signed-out gh offers Retry, and an empty listing says there are no open pull requests", async ({
	page,
}) => {
	await openFixtureProject(page);
	const origin = githubProject();
	try {
		const { dialog } = await openReviewMode(page);
		await page.keyboard.press("Enter");
		const unavailable = page.getByTestId("pull-request-picker-unavailable");
		await expect(unavailable).toHaveAttribute("data-reason", "failed");
		await expect(unavailable).toContainText("Couldn't load pull requests.");
		await expect(dialog.getByTestId("create-workspace")).toBeDisabled();

		writeGhScenario({ prs: [] });
		await page.getByTestId("pull-request-picker-retry").click();
		const empty = page.getByTestId("pull-request-picker-empty");
		await expect(empty).toContainText("No open pull requests.");
		await expect(dialog.getByTestId("create-workspace")).toBeDisabled();
	} finally {
		origin.dispose();
	}
});

test("a repository without a GitHub remote says so instead of listing", async ({ page }) => {
	await openFixtureProject(page);
	await openReviewMode(page);
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("pull-request-picker-unavailable")).toHaveAttribute(
		"data-reason",
		"not-github",
	);
});
