import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

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
	await first.getByTestId("review-composer-cancel").click();
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-composer-input")).toHaveCount(0);
	await first.getByTestId("hunk-ask-agent").click();
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
	await first.getByTestId("review-thread-edit").press("Escape");
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-thread-edit")).toHaveValue("Original saved draft");
	await first.getByTestId("review-thread-edit").fill("Explicitly saved edit");
	await pressPlatformShortcut(page, "Enter");
	await expect
		.poll(() => mutations.filter((method) => method === "review.commentUpdate").length)
		.toBe(1);
	await page.getByTestId("changes-review-next").click();
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-thread-edit")).toHaveValue("Explicitly saved edit");
	await first.getByTestId("review-thread-edit").fill("Saved on blur");
	await page.getByTestId("changes-review-next").click();
	await expect
		.poll(() => mutations.filter((method) => method === "review.commentUpdate").length)
		.toBe(2);
	await page.getByTestId("changes-review-prev").click();
	await expect(first.getByTestId("review-thread-edit")).toHaveValue("Saved on blur");
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
	await expect(rich.getByTestId("review-composer-input")).toHaveValue("Unsaved structural note");
	expect(mutations).toEqual([]);
	await rich.getByTestId("review-composer-cancel").click();
	await rich.getByTestId("view-toggle-code").click();
	await rich.getByTestId("view-toggle-json").click();
	await expect(rich.getByTestId("review-composer-input")).toHaveCount(0);
});
