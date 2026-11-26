import { realpathSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	loadPersistedWorkspaces,
	openFixtureProject,
	pressPlatformShortcut,
} from "./fixtures/app";
import { gitAs } from "./fixtures/git";
import { type FakePr, githubOrigin, writeGhScenario } from "./fixtures/github";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { E2eWire } from "./fixtures/wire";

// v133 /skill:reviewing-a-pr's pull-request completion against the fake gh + github-ssh seam (e2e/SPEC.md).

const COMMAND = "/skill:reviewing-a-pr ";
const PR_URL = (number: number) => `https://github.com/acme/sample/pull/${number}`;

function pr(number: number, over: Partial<FakePr> = {}): FakePr {
	return { number, headRefName: `feature-${number}`, state: "OPEN", ...over };
}

const SCENARIO = {
	viewer: "ada",
	prs: [
		pr(42, {
			title: "Make settings searchable",
			isDraft: true,
			additions: 1_200,
			deletions: 30,
			updatedAt: "2026-02-03T00:00:00Z",
		}),
		pr(41, {
			title: "Add search",
			author: "ada",
			additions: 120,
			deletions: 4,
			reviewRequested: true,
			updatedAt: "2026-02-02T00:00:00Z",
		}),
		pr(77, { title: "Old cleanup", state: "MERGED", mergedAt: "2026-01-02T00:00:00Z" }),
	],
};

function githubProject(repository?: string) {
	const origin = githubOrigin(E2E_FIXTURE_REPO, repository);
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

async function openCreateDialog(page: Page) {
	await page.getByTestId("welcome-title").click();
	await page.keyboard.press("ControlOrMeta+n");
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("ws-target-review")).toHaveCount(0);
	return dialog;
}

const completion = (page: Page) => page.getByTestId("pull-request-completion");

async function forgetPullRequestFilters(baseURL: string | undefined): Promise<void> {
	if (!baseURL) throw new Error("review spec needs the isolated host URL");
	const wire = await E2eWire.connect(Number(new URL(baseURL).port));
	try {
		const projects = await wire.request("project.list", {});
		await wire.request("settings.update", {
			config: { pullRequestFilters: Object.fromEntries(projects.map((p) => [p.id, null])) },
		});
	} finally {
		wire.close();
	}
}

test("Cmd+N offers pull requests after the command, and a pick starts the review from its base", async ({
	page,
	baseURL,
}) => {
	const startCreates = trackStartCreate(page);
	await openFixtureProject(page);
	const origin = githubProject();
	try {
		writeGhScenario(SCENARIO);
		const dialog = await openCreateDialog(page);
		const prompt = dialog.getByTestId("ws-prompt");
		await prompt.fill(COMMAND);

		const list = completion(page);
		await expect(list.locator('[data-pr="41"]')).toContainText("Add search");
		await expect(list.locator('[data-pr="41"]')).toContainText("ada · +120 −4");
		await expect(list.locator('[data-pr="42"]').getByTestId("pull-request-tag")).toHaveText(
			"Draft",
		);
		await expect(list.locator('[data-pr="77"]')).toHaveCount(0);
		const [first] = await list
			.getByTestId("pull-request-option")
			.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-pr")));
		expect(first).toBe("41");
		await expect(page.getByTestId("ws-prompt-tint")).toBeVisible();

		await prompt.fill(`${COMMAND}#77`);
		await expect(list.locator('[data-pr="77"]').getByTestId("pull-request-tag")).toHaveText(
			"Merged",
		);

		await prompt.fill(`${COMMAND}add`);
		await expect(list.getByTestId("pull-request-option")).toHaveCount(1);
		await page.keyboard.press("Enter");
		await expect(list).toBeHidden();
		await expect(prompt).toHaveValue(`${COMMAND}${PR_URL(41)} `);
		await expect(dialog.getByTestId("ws-branch-picker")).toContainText("origin/main");
		await expect(dialog.getByTestId("ws-base-from-pr")).toHaveText("base of #41");

		await page.keyboard.type("focus on the search box");
		await expect(list).toBeHidden();
		const before = new Set(loadPersistedWorkspaces().map((w) => w.id));
		await page.keyboard.press("Enter");
		await expect(dialog).toBeHidden();

		await expect.poll(() => startCreates.length).toBe(1);
		const [params] = startCreates;
		expect(params?.baseRef).toBe("origin/main");
		expect(params?.name).toBeUndefined();
		expect(params?.kickoff).toMatchObject({
			text: `${COMMAND}${PR_URL(41)} focus on the search box`,
		});
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
			expect(skills.find((skill) => skill.name === "skill:reviewing-a-pr")).toMatchObject({
				argumentCompletion: "pull-request",
			});
		} finally {
			wire.close();
		}
	} finally {
		origin.dispose();
	}
});

test("a filter chosen with the keyboard is remembered for the project's next opening", async ({
	page,
	baseURL,
}) => {
	await openFixtureProject(page);
	const origin = githubProject();
	try {
		writeGhScenario(SCENARIO);
		let dialog = await openCreateDialog(page);
		await dialog.getByTestId("ws-prompt").fill(COMMAND);
		const list = completion(page);
		await expect(list.getByTestId("pull-request-option")).toHaveCount(2);

		await page.keyboard.press("Tab");
		await expect(page.getByTestId("pull-request-scope-review-requested")).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("pull-request-scope-review-requested")).toHaveAttribute(
			"data-on",
			"true",
		);
		await expect(list.getByTestId("pull-request-option")).toHaveCount(1);
		await page.keyboard.press("Tab");
		await expect(dialog.getByTestId("ws-prompt")).toBeFocused();

		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		dialog = await openCreateDialog(page);
		await dialog.getByTestId("ws-prompt").fill(COMMAND);
		await expect(page.getByTestId("pull-request-scope-review-requested")).toHaveAttribute(
			"data-on",
			"true",
		);
		await expect(completion(page).getByTestId("pull-request-option")).toHaveCount(1);
		await page.getByTestId("pull-request-scope-all").click();
		await expect(completion(page).getByTestId("pull-request-option")).toHaveCount(2);
	} finally {
		await forgetPullRequestFilters(baseURL);
		origin.dispose();
	}
});

test("the keyboard reaches the next page and every author", async ({ page, baseURL }, testInfo) => {
	await openFixtureProject(page);
	const origin = githubProject(`acme/paged-${testInfo.repeatEachIndex}-${Date.now()}`);
	try {
		writeGhScenario({
			prs: Array.from({ length: 25 }, (_, index) =>
				pr(index + 1, {
					title: `Change ${index + 1}`,
					author: index === 0 ? "zed" : "octo",
					updatedAt: `2026-03-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
				}),
			),
		});
		await page.setViewportSize({ width: 1280, height: 640 });
		const dialog = await openCreateDialog(page);
		await page.mouse.move(0, 0);
		await dialog.getByTestId("ws-prompt").fill(COMMAND);
		const list = completion(page);
		await expect(list.getByTestId("pull-request-option")).toHaveCount(20);
		const filters = await page.getByTestId("pull-request-filters").boundingBox();
		const prompt = await dialog.getByTestId("ws-prompt").boundingBox();
		const menu = await page.getByTestId("argument-menu").boundingBox();
		expect(filters?.y ?? -1).toBeGreaterThanOrEqual(0);
		expect((menu?.y ?? 0) + (menu?.height ?? 0)).toBeLessThanOrEqual((prompt?.y ?? 0) + 1);
		await page.keyboard.press("ArrowUp");
		await expect(list.getByTestId("pull-request-more")).toHaveAttribute("data-active", "true");
		await page.keyboard.press("Enter");
		await expect(list.getByTestId("pull-request-option")).toHaveCount(25);
		await expect(list.getByTestId("pull-request-more")).toHaveCount(0);

		await page.keyboard.press("Tab");
		for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowRight");
		await expect(page.getByTestId("pull-request-author")).toBeFocused();
		await page.keyboard.press("Enter");
		const authors = page.getByTestId("pull-request-author-option");
		await expect(authors.first()).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowDown");
		await expect(authors.nth(2)).toBeFocused();
		await expect(authors.nth(2)).toHaveAttribute("data-author", "zed");
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("pull-request-author")).toContainText("Author: zed");
		await expect(list.getByTestId("pull-request-option")).toHaveCount(1);
		await expect(dialog.getByTestId("ws-prompt")).toBeFocused();
	} finally {
		await forgetPullRequestFilters(baseURL);
		origin.dispose();
	}
});

test("the palette seeds the command, and the chat composer offers the same list with its notice", async ({
	page,
}) => {
	await openFixtureProject(page);
	const origin = githubProject();
	try {
		writeGhScenario(SCENARIO);
		await page.getByTestId("welcome-title").click();
		await pressPlatformShortcut(page, "k");
		await page.getByTestId("search-input").fill("Review a pull request");
		await page
			.locator('[data-testid="search-row"][data-item-id="command:workspace.reviewPr"]')
			.click();
		const dialog = page.getByTestId("new-workspace-dialog");
		await expect(dialog.getByTestId("ws-prompt")).toHaveValue(COMMAND);
		await expect(completion(page).locator('[data-pr="41"]')).toBeVisible();
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		await enterDefaultWorkspace(page);
		await page.getByTestId("new-chat").first().click();
		const input = page.getByTestId("chat-input");
		await input.fill(COMMAND);
		await expect(page.getByTestId("pull-request-notice")).toBeVisible();
		await expect(completion(page).locator('[data-pr="42"]')).toBeVisible();
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");
		await expect(input).toHaveValue(`${COMMAND}${PR_URL(42)} `);
		await expect(completion(page)).toBeHidden();
		await expect(page.getByTestId("prompt-tint")).toBeVisible();
	} finally {
		origin.dispose();
	}
});

test("a signed-out gh offers Retry, and an empty listing says there are no open pull requests", async ({
	page,
}, testInfo) => {
	await openFixtureProject(page);
	const origin = githubProject(`acme/signed-out-${testInfo.repeatEachIndex}-${Date.now()}`);
	try {
		const dialog = await openCreateDialog(page);
		await dialog.getByTestId("ws-prompt").fill(COMMAND);
		const unavailable = page.getByTestId("pull-request-unavailable");
		await expect(unavailable).toHaveAttribute("data-reason", "failed");
		await expect(unavailable).toContainText("Couldn't load pull requests.");

		writeGhScenario({ prs: [] });
		await page.getByTestId("pull-request-retry").click();
		await expect(page.getByTestId("pull-request-empty")).toContainText("No open pull requests.");
	} finally {
		origin.dispose();
	}
});

test("a repository without a GitHub remote says so instead of listing", async ({ page }) => {
	await openFixtureProject(page);
	const dialog = await openCreateDialog(page);
	await dialog.getByTestId("ws-prompt").fill(COMMAND);
	await expect(page.getByTestId("pull-request-unavailable")).toHaveAttribute(
		"data-reason",
		"not-github",
	);
});
