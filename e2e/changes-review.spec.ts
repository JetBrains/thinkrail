import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openPersistedChat,
	revealWorkbenchTool,
} from "./fixtures/app";
import { commitFile, gitAs } from "./fixtures/git";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { selectPierreLine } from "./fixtures/pierre";
import { seedWorkspaceSession } from "./fixtures/sessions";

const reviewTab = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="changes"]');
const diffTab = (page: Page) => page.locator('[data-testid="editor-tab"][data-kind="diff"]');
const sections = (page: Page) => page.getByTestId("changes-section");
const section = (page: Page, path: string) =>
	page.locator(`[data-testid="changes-section"][data-path="${path}"]`);
const row = (page: Page, name: string) => page.getByTestId("change-item").filter({ hasText: name });

async function seedThreeChanges(page: Page): Promise<string> {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");
	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");
	writeFileSync(join(worktree, "notes.txt"), "a note edited by e2e\n");
	await revealWorkbenchTool(page, "changes");
	await expect(row(page, "notes.txt")).toBeVisible();
	return worktree;
}

test("a single click opens one continuous review tab in preview with a section per changed file", async ({
	page,
}) => {
	await seedThreeChanges(page);

	await row(page, "script.ts").click();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(reviewTab(page)).toHaveAttribute("data-preview", "true");
	await expect(diffTab(page)).toHaveCount(0);
	await expect(page.getByTestId("changes-review-summary")).toContainText("3 files");
	await expect(sections(page)).toHaveCount(3);
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("0/3 viewed");

	// each section dispatches the registry renderer the per-file tab would use
	await expect(section(page, "README.md").getByTestId("rendered-diff")).toContainText(
		"edited by e2e",
	);
	await expect(section(page, "README.md").getByTestId("view-toggle-markdown")).toHaveAttribute(
		"data-active",
		"true",
	);
	await expect(
		section(page, "script.ts").getByTestId("diff-view").getByText("edited = true").last(),
	).toBeVisible();

	// the clicked file is the active one in the navigator; another click reveals another section
	await expect(row(page, "script.ts")).toHaveAttribute("data-active", "true");
	await row(page, "notes.txt").click();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(row(page, "notes.txt")).toHaveAttribute("data-active", "true");

	// viewed state is shared by the section header and the sidebar row
	await section(page, "script.ts").getByTestId("changes-section-viewed").click();
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/3 viewed");
	await expect(row(page, "script.ts")).toHaveAttribute("data-viewed", "true");
	await expect(section(page, "script.ts")).toHaveAttribute("data-viewed", "true");

	// collapse / expand all
	await page.getByTestId("changes-review-collapse-all").click();
	await expect(page.locator('[data-testid="changes-section"][data-collapsed="true"]')).toHaveCount(
		3,
	);
	await expect(section(page, "README.md").getByTestId("rendered-diff")).toHaveCount(0);
	await page.getByTestId("changes-review-expand-all").click();
	await expect(page.locator('[data-testid="changes-section"][data-collapsed="true"]')).toHaveCount(
		0,
	);
	await section(page, "README.md").getByTestId("changes-section-toggle").click();
	await expect(section(page, "README.md")).toHaveAttribute("data-collapsed", "true");
});

test("a double click opens the per-file tab and a section's Open as tab does the same", async ({
	page,
}) => {
	await seedThreeChanges(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="file"]')).toHaveCount(1);
	await revealWorkbenchTool(page, "changes");

	await row(page, "script.ts").dblclick();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="file"]')).toHaveCount(0);
	await expect(diffTab(page)).toHaveCount(1);
	await expect(diffTab(page)).toHaveAttribute("data-preview", "false");
	await expect(reviewTab(page)).toHaveCount(0);
	await expect(page.getByTestId("diff-pane")).toBeVisible();

	await row(page, "notes.txt").click();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(diffTab(page)).toHaveCount(1);

	await section(page, "README.md").getByTestId("changes-section-open-tab").click();
	await expect(diffTab(page)).toHaveCount(2);
	await expect(page.getByTestId("diff-pane").getByTestId("rendered-diff")).toContainText(
		"edited by e2e",
	);
});

test("One file mode walks the scope with Prev / Next and V, sharing progress with the stacked view", async ({
	page,
}) => {
	await seedThreeChanges(page);
	// files are ordered by localeCompare: notes.txt, README.md, script.ts
	await row(page, "notes.txt").click();
	await expect(sections(page)).toHaveCount(3);

	await page.getByTestId("changes-review-layout-single").click();
	await expect(page.getByTestId("changes-review-walk")).toBeVisible();
	await expect(page.getByTestId("changes-review-counter")).toHaveText("1 / 3");
	await expect(sections(page)).toHaveCount(1);
	await expect(section(page, "notes.txt")).toBeVisible();
	await expect(page.getByTestId("changes-review-prev")).toBeDisabled();

	await page.getByTestId("changes-review-next").click();
	await expect(page.getByTestId("changes-review-counter")).toHaveText("2 / 3");
	await expect(section(page, "README.md")).toBeVisible();
	await expect(row(page, "README.md")).toHaveAttribute("data-active", "true");

	await page.keyboard.press("v");
	await expect(page.getByTestId("changes-review-counter")).toHaveText("3 / 3");
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/3 viewed");
	await expect(row(page, "README.md")).toHaveAttribute("data-viewed", "true");
	await expect(section(page, "script.ts")).toBeVisible();
	await expect(page.getByTestId("changes-review-next")).toBeDisabled();

	await page.getByTestId("changes-review-layout-stacked").click();
	await expect(sections(page)).toHaveCount(3);
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/3 viewed");
	await expect(section(page, "README.md")).toHaveAttribute("data-viewed", "true");
	await expect(row(page, "script.ts")).toHaveAttribute("data-active", "true");
});

test("returning to Stacked restores the first file rather than an earlier reveal anchor", async ({
	page,
}) => {
	await seedThreeChanges(page);
	await row(page, "script.ts").click();
	await expect(section(page, "script.ts").getByTestId("hunk-keep")).toBeVisible();
	await page.getByTestId("changes-review-layout-single").click();
	await page.getByTestId("changes-review-prev").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(page.getByTestId("changes-review-counter")).toHaveText("1 / 3");
	await page.getByTestId("changes-review-layout-stacked").click();
	await expect(section(page, "notes.txt").getByTestId("changes-section-header")).toBeInViewport();
	await expect(row(page, "notes.txt")).toHaveAttribute("data-active", "true");
});

test("the review tab survives a reload and a large file mounts collapsed behind Expand", async ({
	page,
}) => {
	const worktree = await seedThreeChanges(page);
	writeFileSync(
		join(worktree, "big.lock"),
		Array.from({ length: 450 }, (_, index) => `line ${index}`).join("\n"),
	);
	await expect(row(page, "big.lock")).toBeVisible();

	await row(page, "README.md").click();
	await expect(reviewTab(page)).toHaveCount(1);
	const big = section(page, "big.lock");
	await expect(big).toHaveAttribute("data-collapsed", "true");
	await expect(big.getByTestId("changes-section-collapsed")).toContainText("collapsed by default");
	await big.getByTestId("changes-section-expand").click();
	await expect(big).not.toHaveAttribute("data-collapsed", "true");
	await expect(big.getByTestId("diff-view").getByText("line 449").last()).toBeVisible();

	await page.reload();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(page.getByTestId("changes-review-summary")).toContainText("4 files");
	await expect(sections(page).first()).toBeVisible();
});

test("hunk triage: Keep marks hunks, a fully kept file becomes viewed, and the bar walks the rest", async ({
	page,
}) => {
	await seedThreeChanges(page);
	await row(page, "notes.txt").click();
	await expect(sections(page)).toHaveCount(3);

	const bar = page.getByTestId("changes-review-triage");
	await expect(bar).toContainText("0 of 3 reviewed");

	// one hunk per file: keeping script.ts's only hunk completes that file
	const script = section(page, "script.ts");
	await expect(script.getByTestId("changes-section-kept")).toHaveText("0/1 kept");
	await script.getByTestId("hunk-keep").click();
	await expect(script.getByTestId("hunk-toolbar")).toHaveAttribute("data-kept", "true");
	await expect(script.getByTestId("changes-section-kept")).toHaveText("1/1 kept");
	await expect(script).toHaveAttribute("data-viewed", "true");
	await expect(row(page, "script.ts")).toHaveAttribute("data-viewed", "true");
	await expect(bar).toContainText("1 of 3 reviewed");

	// undoing the keep leaves the file viewed — viewed is a one-way file-level decision
	await script.getByTestId("hunk-keep").click();
	await expect(script.getByTestId("changes-section-kept")).toHaveText("0/1 kept");
	await expect(script).toHaveAttribute("data-viewed", "true");

	// J walks to the next unreviewed file after the active one, wrapping
	await expect(row(page, "notes.txt")).toHaveAttribute("data-active", "true");
	await page.keyboard.press("j");
	await expect(row(page, "README.md")).toHaveAttribute("data-active", "true");

	await page.getByTestId("changes-review-mark-all").click();
	await expect(bar).toContainText("3 of 3 reviewed");
	await expect(page.getByTestId("changes-review-mark-all")).toBeDisabled();
	await expect(page.getByTestId("changes-review-next-unreviewed")).toBeDisabled();
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("3/3 viewed");

	// the per-file tab offers no triage: revert/ask-agent only
	await row(page, "script.ts").dblclick();
	await expect(page.getByTestId("diff-pane")).toBeVisible();
	await expect(page.getByTestId("diff-pane").getByTestId("hunk-toolbar")).toBeVisible();
	await expect(page.getByTestId("diff-pane").getByTestId("hunk-keep")).toHaveCount(0);
});

test("review shortcuts leave files alone while a scope menu owns keyboard input", async ({
	page,
}) => {
	await seedThreeChanges(page);
	await row(page, "script.ts").click();
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("0/3 viewed");
	await page.getByTestId("changes-scope-trigger").click();
	await expect(page.getByRole("menu")).toBeVisible();
	await page.keyboard.press("v");
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("0/3 viewed");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).not.toBeVisible();
	await page.keyboard.press("v");
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("1/3 viewed");
});

test("an explicitly unviewed fully kept file stays unviewed after its section remounts", async ({
	page,
}) => {
	await seedThreeChanges(page);
	await row(page, "script.ts").click();
	const script = section(page, "script.ts");
	await script.getByTestId("hunk-keep").click();
	await expect(script).toHaveAttribute("data-viewed", "true");
	await script.getByTestId("changes-section-viewed").click();
	await expect(script).not.toHaveAttribute("data-viewed", "true");

	await page.getByTestId("changes-review-layout-single").click();
	await expect(script.getByTestId("changes-section-kept")).toHaveText("1/1 kept");
	await expect(page.getByTestId("changes-review-viewed-count")).toHaveText("0/3 viewed");
	await expect(script).not.toHaveAttribute("data-viewed", "true");

	await page.getByTestId("changes-review-layout-stacked").click();
	await expect(script.getByTestId("changes-section-kept")).toHaveText("1/1 kept");
	await expect(script).not.toHaveAttribute("data-viewed", "true");
});

test("a round's receipt comes from the host's turn snapshot and Review turn opens the Last-turn scope", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const worktree = workspace.worktreePath;
	const baseTree = gitAs(worktree, "rev-parse", "HEAD^{tree}");
	commitFile(worktree, "feature.ts", "export const feature = true;\n", "agent: add the feature");
	const headTree = gitAs(worktree, "rev-parse", "HEAD^{tree}");
	const promptAt = 1_700_000_000_000;
	const seeded = seedWorkspaceSession(worktree, {
		name: "Add the feature flag",
		messages: [
			{ role: "user", text: "add the feature flag", timestamp: promptAt },
			{ role: "assistant", text: "Added feature.ts with the flag.", timestamp: promptAt + 4_000 },
		],
	});
	writeFileSync(
		join(E2E_DATA_DIR, "turns.json"),
		JSON.stringify({
			version: 1,
			byWorkspace: {
				[workspace.id]: [
					{
						id: `${seeded.id}:${promptAt + 500}`,
						workspaceId: workspace.id,
						sessionId: seeded.id,
						startedAt: promptAt + 500,
						settledAt: promptAt + 3_500,
						baseTree,
						headTree,
						changes: [{ path: "feature.ts", status: "added", added: 1, removed: 0 }],
					},
				],
			},
		}),
	);

	await page.reload();
	await openPersistedChat(page, "Add the feature flag");
	const divider = page.getByTestId("turn-divider").first();
	await expect(divider.getByTestId("turn-divider-files")).toContainText("1 file changed · +1 −0");

	await divider.getByTestId("turn-divider-review").click();
	await expect(page.getByTestId("changes-scope-label")).toHaveText("Last turn");
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(page.getByTestId("changes-review-scope")).toContainText("Last turn");
	const feature = section(page, "feature.ts");
	await expect(feature.getByTestId("diff-view").getByText("feature = true").last()).toBeVisible();
	await expect(feature.getByTestId("changes-section-revert")).toHaveCount(0);
	await expect(page.getByTestId("hunk-keep")).toHaveCount(0);
	await expect(row(page, "feature.ts")).toBeVisible();

	await page.getByTestId("changes-scope-trigger").click();
	await expect(page.getByTestId("changes-scope-last-turn")).toContainText("Last turn · 1 file");
	await expect(page.getByTestId("changes-scope-last-turn")).toHaveAttribute("data-active", "true");
});

test("the review guide walks the reviewer's reading order and findings with N", async ({
	page,
}) => {
	const worktree = await seedThreeChanges(page);
	writeFileSync(
		join(worktree, "script.ts"),
		Array.from({ length: 100 }, (_, i) => `export const value${i + 1} = true;`).join("\n"),
	);
	const workspaceId = JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")).find(
		(w: { worktreePath: string }) => w.worktreePath === worktree,
	).id as string;
	const baseSha = gitAs(worktree, "rev-parse", "HEAD");
	mkdirSync(join(E2E_DATA_DIR, "reviews"), { recursive: true });
	writeFileSync(
		join(E2E_DATA_DIR, "reviews", `${workspaceId}.json`),
		JSON.stringify({
			review: {
				id: "rev_seeded",
				workspaceId,
				status: "open",
				baseSha,
				createdAt: 1,
				guide: {
					summary: "Small and coherent; one risk in the script.",
					readingOrder: [
						{ path: "notes.txt", why: "Context first." },
						{ path: "script.ts", why: "The actual change." },
					],
					verdict: "request_changes",
					todoId: "t1",
					sessionId: "seeded",
					reviewedSha: baseSha,
					at: 1,
				},
			},
			comments: [
				{
					id: "finding-1",
					reviewId: "rev_seeded",
					kind: "diff",
					anchor: {
						path: "script.ts",
						side: "worktree",
						selectors: [{ kind: "lineRange", startLine: 85, endLine: 85 }],
					},
					body: "RISK: the flag is exported without a reader.",
					status: "draft",
					anchorState: "anchored",
					author: "agent",
					origin: { todoId: "t1", reviewedSha: baseSha, sessionId: "seeded" },
					createdAt: 1,
				},
			],
		}),
	);

	await page.reload();
	await revealWorkbenchTool(page, "changes");
	await row(page, "README.md").click();
	await expect(reviewTab(page)).toHaveCount(1);
	const guide = page.getByTestId("changes-review-guide");
	await expect(guide).toBeVisible();
	await expect(guide.getByTestId("changes-review-guide-summary")).toContainText(
		"one risk in the script",
	);
	await expect(guide.getByTestId("changes-review-guide-step")).toHaveCount(2);
	await expect(guide.getByTestId("changes-review-guide-finding")).toHaveCount(1);

	await guide.getByTestId("changes-review-guide-next").click();
	await expect(row(page, "notes.txt")).toHaveAttribute("data-active", "true");
	await expect(guide.getByTestId("changes-review-guide-step").first()).toHaveAttribute(
		"data-active",
		"true",
	);
	await page.keyboard.press("n");
	await expect(row(page, "script.ts")).toHaveAttribute("data-active", "true");
	await page.keyboard.press("n");
	await expect(guide.getByTestId("changes-review-guide-finding")).toHaveAttribute(
		"data-active",
		"true",
	);
	await expect(page.locator('[data-comment-id="finding-1"]')).toBeInViewport();
	await expect(guide.getByTestId("changes-review-guide-fix")).toBeVisible();
	await expect(guide.getByTestId("changes-review-guide-next")).toContainText("Restart");

	await page.getByTestId("changes-review-guide-toggle").click();
	await expect(guide).toHaveCount(0);
	await page.getByTestId("changes-review-guide-toggle").click();
	await expect(page.getByTestId("changes-review-guide")).toBeVisible();
});

test("revealing a file stays anchored while slow diffs determine the virtual list height", async ({
	page,
}) => {
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		const delayed = new Set<string>();
		browser.onMessage((message) => {
			const frame = JSON.parse(String(message));
			if (frame.method === "git.diffFile") delayed.add(frame.id);
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(String(message));
			if (delayed.delete(frame.id)) {
				setTimeout(() => browser.send(message), 2_500);
			} else browser.send(message);
		});
	});
	const worktree = await seedThreeChanges(page);
	for (let file = 0; file < 60; file += 1) {
		writeFileSync(
			join(worktree, `slow-${String(file).padStart(3, "0")}.ts`),
			Array.from({ length: 100 }, (_, line) => `export const value${line} = ${file};`).join("\n"),
		);
	}
	await expect(page.getByTestId("change-item")).toHaveCount(63);
	await row(page, "slow-030.ts").click();
	await expect(section(page, "slow-030.ts").getByTestId("diff-view")).toContainText("value99", {
		timeout: 15_000,
	});
	await expect(section(page, "slow-030.ts").getByTestId("changes-section-header")).toBeInViewport();
	await expect(row(page, "slow-030.ts")).toHaveAttribute("data-active", "true");
});

test("a draft written inside a section counts toward the tab's Send review, and review progress keeps the preview tab", async ({
	page,
}) => {
	await seedThreeChanges(page);
	await row(page, "script.ts").click();
	await expect(reviewTab(page)).toHaveAttribute("data-preview", "true");
	await expect(page.getByTestId("changes-review-send")).toHaveCount(0);
	await page.reload();
	await expect(reviewTab(page)).toHaveAttribute("data-preview", "true");
	await section(page, "notes.txt").getByTestId("changes-section-viewed").click();
	await expect(reviewTab(page)).not.toHaveAttribute("data-preview", "true");

	await selectPierreLine(section(page, "script.ts").getByTestId("diff-view"), "edited = true");
	await expect(page.getByTestId("review-composer")).toBeVisible();
	await page.getByTestId("review-composer-input").fill("Name this flag after what it gates.");
	await page.getByTestId("review-composer-save").click();
	await expect(page.getByTestId("changes-review-send")).toContainText("Send review (1)");
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();
	await expect(reviewTab(page)).toHaveCount(1);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="file"]')).toHaveCount(1);
});
