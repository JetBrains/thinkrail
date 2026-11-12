import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { pierreLines, selectPierreLine } from "./fixtures/pierre";

const section = (page: Page, path: string) =>
	page.locator(`[data-testid="changes-section"][data-path="${path}"]`);
const row = (page: Page, path: string) => page.getByTestId("change-item").filter({ hasText: path });

async function seedChanges(page: Page) {
	const mutations: string[] = [];
	page.on("websocket", (socket) =>
		socket.on("framesent", ({ payload }) => {
			const frame = JSON.parse(String(payload)) as { method?: string };
			if (frame.method?.startsWith("review.comment") || frame.method === "review.sendComment") {
				mutations.push(frame.method);
			}
		}),
	);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	for (let index = 0; index < 24; index += 1) {
		writeFileSync(
			join(worktree, `draft-${String(index).padStart(2, "0")}.ts`),
			Array.from({ length: 70 }, (_, line) => `export const value${line} = ${index + line};`).join(
				"\n",
			),
		);
	}
	writeFileSync(join(worktree, "draft-rich.json"), '{"value":"changed"}\n');
	writeFileSync(
		join(worktree, "draft-cells.ipynb"),
		JSON.stringify({
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {},
			cells: [
				{
					id: "first",
					cell_type: "code",
					execution_count: null,
					metadata: {},
					outputs: [],
					source: ["print('first')\n"],
				},
				{
					id: "second",
					cell_type: "code",
					execution_count: null,
					metadata: {},
					outputs: [],
					source: ["print('second')\n"],
				},
			],
		}),
	);
	await revealWorkbenchTool(page, "changes");
	await row(page, "draft-00.ts").click();
	await expect(section(page, "draft-00.ts").getByTestId("hunk-ask-agent")).toBeVisible();
	return mutations;
}

async function scrollDiffUntilVisible(page: Page, path: string, target: Locator, deltaY: number) {
	await expect(async () => {
		await section(page, path).getByTestId("diff-view").hover();
		await page.mouse.wheel(0, deltaY);
		await expect(target).toBeInViewport({ timeout: 500 });
	}).toPass();
}

async function wheelAway(page: Page, path: string) {
	await section(page, path).getByTestId("changes-section-header").hover();
	await page.mouse.wheel(0, 80000);
	await expect(section(page, path)).toHaveCount(0);
}

test("Changes keeps unsaved composer selection and text through virtualization and mode switches without autosaving", async ({
	page,
}) => {
	const mutations = await seedChanges(page);
	const first = section(page, "draft-00.ts");
	await first.getByTestId("hunk-ask-agent").click();
	await first.getByTestId("review-composer-input").fill("Unsaved hunk question");
	const input = first.getByTestId("review-composer-input");
	for (let i = 0; i < 21; i += 1) await input.press("ArrowLeft");
	for (let i = 0; i < 9; i += 1) await input.press("ArrowRight");
	for (let i = 0; i < 7; i += 1) await input.press("Shift+ArrowLeft");
	await wheelAway(page, "draft-00.ts");
	await row(page, "draft-00.ts").click();
	await expect(first.getByTestId("review-composer-input")).toHaveValue("Unsaved hunk question");
	await expect
		.poll(() =>
			first
				.getByTestId("review-composer-input")
				.evaluate((input: HTMLTextAreaElement) => [
					input.selectionStart,
					input.selectionEnd,
					input.selectionDirection,
				]),
		)
		.toEqual([2, 9, "backward"]);
	await page.getByTestId("changes-review-layout-single").click();
	await expect(first.getByTestId("review-composer-input")).toHaveValue("Unsaved hunk question");
	await page.getByTestId("changes-review-next").click();
	await expect(page.getByTestId("review-composer-input")).toHaveCount(0);
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-composer-input")).toHaveValue("Unsaved hunk question");
	expect(mutations).toEqual([]);
	const cancel = first.getByTestId("review-composer-cancel");
	await scrollDiffUntilVisible(page, "draft-00.ts", cancel, 80000);
	await cancel.click();
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-composer-input")).toHaveCount(0);
	const askAgent = first.getByTestId("hunk-ask-agent");
	await scrollDiffUntilVisible(page, "draft-00.ts", askAgent, -80000);
	await askAgent.click();
	await expect(first.getByTestId("review-composer-input")).not.toHaveValue("Unsaved hunk question");
	await first.getByTestId("review-composer-input").fill("Saved hunk question");
	await first.getByTestId("review-composer-save").click();
	await expect(first.getByTestId("review-thread-edit")).toHaveValue("Saved hunk question");
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-composer-input")).toHaveCount(0);
});

test("Changes retains unsaved draft-thread edits through virtualization and honors save or Escape", async ({
	page,
}) => {
	const mutations = await seedChanges(page);
	const first = section(page, "draft-00.ts");
	await first.getByTestId("hunk-ask-agent").click();
	await first.getByTestId("review-composer-input").fill("Original saved draft");
	await first.getByTestId("review-composer-save").click();
	await expect(first.getByTestId("review-thread-edit")).toHaveValue("Original saved draft");
	const savedMutations = [...mutations];
	await first.getByTestId("review-thread-edit").fill("Unsaved thread edit");
	await wheelAway(page, "draft-00.ts");
	await row(page, "draft-00.ts").click();
	await expect(first.getByTestId("review-thread-edit")).toHaveValue("Unsaved thread edit");
	await page.getByTestId("changes-review-layout-single").click();
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-thread-edit")).toHaveValue("Unsaved thread edit");
	expect(mutations).toEqual(savedMutations);
	const threadEdit = first.getByTestId("review-thread-edit");
	await scrollDiffUntilVisible(page, "draft-00.ts", threadEdit, 80000);
	await threadEdit.press("Escape");
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(threadEdit).toHaveValue("Original saved draft");
	await scrollDiffUntilVisible(page, "draft-00.ts", threadEdit, 80000);
	await threadEdit.fill("Explicitly saved edit");
	await pressPlatformShortcut(page, "Enter");
	await expect
		.poll(() => mutations.filter((method) => method === "review.commentUpdate").length)
		.toBe(1);
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(threadEdit).toHaveValue("Explicitly saved edit");
	await scrollDiffUntilVisible(page, "draft-00.ts", threadEdit, 80000);
	await threadEdit.fill("Saved on blur");
	await page.getByTestId("changes-review-next").click();
	await expect
		.poll(() => mutations.filter((method) => method === "review.commentUpdate").length)
		.toBe(2);
	await page.getByTestId("changes-review-prev").click();
	await expect(threadEdit).toHaveValue("Saved on blur");
});

test("notebook drafts remain attached to their cell after the renderer reparses on remount", async ({
	page,
}) => {
	const mutations = await seedChanges(page);
	await row(page, "draft-cells.ipynb").click();
	const notebook = section(page, "draft-cells.ipynb");
	await notebook.getByTestId("notebook-comment-cell-worktree").first().click();
	await notebook.getByTestId("review-composer-input").fill("Keep this note on the first cell");
	await notebook.getByTestId("view-toggle-code").click();
	await expect(notebook.getByTestId("review-composer-input")).toHaveCount(0);
	await notebook.getByTestId("view-toggle-notebook").click();
	await expect(
		notebook.getByTestId("notebook-diff-cell").first().getByTestId("review-composer-input"),
	).toHaveValue("Keep this note on the first cell");
	expect(mutations).toEqual([]);
});

test("rich Changes composers share the same preservation and cancellation policy", async ({
	page,
}) => {
	const mutations = await seedChanges(page);
	await page.getByTestId("changes-review-layout-single").click();
	await row(page, "draft-rich.json").click();
	const rich = section(page, "draft-rich.json");
	await rich.locator('[data-json-pointer="/value"]').getByRole("button").click();
	await rich.getByTestId("review-composer-input").fill("Unsaved structural note");
	await rich.getByTestId("view-toggle-code").click();
	await expect(rich.getByTestId("review-composer-input")).toHaveCount(0);
	await row(page, "draft-00.ts").click();
	await expect(page.getByTestId("review-composer-input")).toHaveCount(0);
	await row(page, "draft-rich.json").click();
	await rich.getByTestId("view-toggle-json").click();
	await expect(rich.getByTestId("review-composer-input")).toHaveValue("Unsaved structural note");
	await page.getByTestId("changes-review-layout-stacked").click();
	await expect(page.getByTestId("changes-review-walk")).toHaveCount(0);
	await expect(rich.getByTestId("review-composer-input")).toHaveValue("Unsaved structural note");
	expect(mutations).toEqual([]);
	await rich.getByTestId("review-composer-cancel").click();
	await rich.getByTestId("view-toggle-code").click();
	await rich.getByTestId("view-toggle-json").click();
	await expect(rich.getByTestId("review-composer-input")).toHaveCount(0);
});

test("a diff composer stays shown while a scroll-up shrinks the virtual window to its line", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(
		join(worktree, "draft-long.ts"),
		`${Array.from({ length: 1500 }, (_, line) => `export const value${line} = ${line};`).join("\n")}\n`,
	);
	await revealWorkbenchTool(page, "changes");
	await row(page, "draft-long.ts").dblclick();
	const diff = page.getByTestId("diff-view");
	await expect(pierreLines(diff, "value3 =").last()).toBeVisible();
	await expect(async () => {
		await diff.hover();
		await page.mouse.wheel(0, 300);
		await expect(pierreLines(diff, "value404 =").last()).toBeInViewport({ timeout: 300 });
	}).toPass();
	await selectPierreLine(diff, "value404 =");
	await page.getByTestId("review-composer-input").fill("Keep me on line 405");
	const sweep = await diff.evaluate(async (scroller, text) => {
		const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
		const lineRendered = () =>
			[...scroller.querySelectorAll("*")]
				.flatMap((node) =>
					node.shadowRoot ? [...node.shadowRoot.querySelectorAll("[data-line]")] : [],
				)
				.some((line) => line.textContent?.includes(text));
		const composerShown = () =>
			(document.querySelector('[data-testid="review-composer"]')?.getClientRects().length ?? 0) > 0;
		for (let top = scroller.scrollTop; top >= 0; top -= 10) {
			scroller.scrollTop = top;
			await frame();
			await frame();
			if (!lineRendered()) return { leftWindowAt: top, composerLostAt: null };
			if (!composerShown()) return { leftWindowAt: null, composerLostAt: top };
		}
		return { leftWindowAt: null, composerLostAt: null };
	}, "value404 =");
	expect(sweep.composerLostAt).toBeNull();
	expect(sweep.leftWindowAt).not.toBeNull();
	await expect(page.getByTestId("review-composer-input")).toHaveValue("Keep me on line 405");
});
