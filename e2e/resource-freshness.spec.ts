import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	openPersistedChat,
	revealWorkbenchTool,
} from "./fixtures/app";
import { commitFile } from "./fixtures/git";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { pagedPdf } from "./fixtures/repo";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { stubResourceWire } from "./perf/interactionDriver";

async function nextFrames(page: Page): Promise<void> {
	await page.evaluate(async () => {
		for (let frame = 0; frame < 2; frame += 1) await new Promise(requestAnimationFrame);
	});
}

function pngChunk(type: string, data: Buffer): Buffer {
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

function solidPng(width: number, height: number, shade: number): Buffer {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 0, 0, 0, 0], 8);
	const row = Buffer.alloc(width + 1, shade);
	row[0] = 0;
	const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", header),
		pngChunk("IDAT", pixels),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

async function openChange(
	page: Page,
	path: string,
	before: string | Buffer,
	after: string | Buffer,
): Promise<string> {
	await openFixtureProject(page);
	const { worktreePath } = await createWorkspaceViaDialog(page);
	commitFile(worktreePath, path, before, `add ${path}`);
	writeFileSync(join(worktreePath, path), after);
	await revealWorkbenchTool(page, "changes");
	await page.getByTestId("changes-scope-trigger").click();
	await page.getByTestId("changes-scope-uncommitted").click();
	await page.getByTestId("change-item").filter({ hasText: path }).dblclick();
	return worktreePath;
}

async function saveComment(surface: Locator, text: string): Promise<void> {
	await surface.getByTestId("review-composer-input").fill(text);
	await surface.getByTestId("review-composer-save").click();
	await expect(surface.getByTestId("review-composer")).toHaveCount(0);
}

test("the CSV diff follows selection, saved threads and on-disk edits", async ({ page }) => {
	const rows = (edit: string) => `a,b,c\n1,2,3\n4,${edit},6\n7,8,9\n`;
	const worktree = await openChange(page, "fresh.csv", rows("five"), rows("edited-one"));
	const diff = page.getByTestId("csv-diff");
	await expect(diff).toContainText("edited-one");
	const cell = (text: string) => diff.locator("td button", { hasText: text }).first();
	const outlined = diff.locator("td.outline-primary");

	await cell("1").click();
	await expect(outlined).toHaveCount(1);
	await expect(outlined).toHaveText("1");
	await expect(diff.getByTestId("review-composer")).toBeVisible();

	await cell("9").click();
	await expect(outlined).toHaveCount(1);
	await expect(outlined).toHaveText("9");

	await cell("7").click({ modifiers: ["Shift"] });
	await expect(outlined).toHaveCount(3);

	await cell("2").click();
	await expect(outlined).toHaveCount(1);
	await saveComment(diff, "First note");
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(1);
	await expect(diff.getByTestId("review-thread-card")).toContainText("First note");
	await expect(diff.locator("td", { hasText: "2" }).first().getByRole("button")).toHaveCount(2);

	await cell("8").click();
	await saveComment(diff, "Second note");
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(2);

	writeFileSync(join(worktree, "fresh.csv"), rows("edited-two"));
	await expect(diff).toContainText("edited-two");
	await expect(diff).not.toContainText("edited-one");
});

test("the JSON diff follows selection, saved threads and on-disk edits", async ({ page }) => {
	const json = (value: string) =>
		`${JSON.stringify({ alpha: "one", beta: value, gamma: 3 }, null, 2)}\n`;
	const worktree = await openChange(page, "fresh.json", json("old"), json("edited-one"));
	const diff = page.getByTestId("json-diff");
	await expect(diff).toContainText("edited-one");
	const node = (pointer: string) =>
		diff.locator(`[data-json-pointer="${pointer}"]`).first().getByRole("button").last();
	const composer = diff.getByTestId("review-composer");

	await node("/alpha").click();
	await expect(composer).toContainText("/alpha");
	await node("/gamma").click();
	await expect(composer).toContainText("/gamma");
	await expect(composer).not.toContainText("/alpha");

	await saveComment(diff, "Gamma note");
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(1);
	await expect(diff.locator('[data-json-pointer="/gamma"]').first()).toContainText("1");
	await node("/alpha").click();
	await saveComment(diff, "Alpha note");
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(2);

	writeFileSync(join(worktree, "fresh.json"), json("edited-two"));
	await expect(diff).toContainText("edited-two");
	await expect(diff).not.toContainText("edited-one");
});

test("the notebook diff follows selection, saved threads and on-disk edits", async ({ page }) => {
	const notebook = (value: string) =>
		JSON.stringify({
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {},
			cells: ["alpha", value, "gamma"].map((source, index) => ({
				cell_type: "code",
				id: `cell-${index}`,
				execution_count: null,
				metadata: {},
				outputs: [],
				source: [`print("${source}")\n`],
			})),
		});
	const worktree = await openChange(page, "fresh.ipynb", notebook("old"), notebook("edited-one"));
	const diff = page.getByTestId("notebook-diff");
	await expect(diff).toContainText("edited-one");
	const cells = diff.getByTestId("notebook-diff-cell");
	const comment = (index: number) => cells.nth(index).getByTestId("notebook-comment-cell-worktree");

	await comment(0).click();
	await expect(cells.nth(0).getByTestId("review-composer")).toBeVisible();
	await comment(2).click();
	await expect(cells.nth(2).getByTestId("review-composer")).toBeVisible();
	await expect(cells.nth(0).getByTestId("review-composer")).toHaveCount(0);

	await saveComment(cells.nth(2), "Gamma note");
	await expect(cells.nth(2).getByTestId("review-thread-card")).toHaveCount(1);
	await comment(0).click();
	await saveComment(cells.nth(0), "Alpha note");
	await expect(diff.getByTestId("review-thread-card")).toHaveCount(2);

	writeFileSync(join(worktree, "fresh.ipynb"), notebook("edited-two"));
	await expect(diff).toContainText("edited-two");
	await expect(diff).not.toContainText("edited-one");
});

const imagePixels = (image: Locator) =>
	image.evaluate((element) => {
		const source = element as HTMLImageElement;
		const canvas = document.createElement("canvas");
		canvas.width = source.naturalWidth;
		canvas.height = source.naturalHeight;
		canvas.getContext("2d")?.drawImage(source, 0, 0);
		return canvas.toDataURL();
	});

test("the PDF diff follows paging, region threads and on-disk edits", async ({ page }) => {
	const worktree = await openChange(page, "fresh.pdf", pagedPdf(5, "BASE"), pagedPdf(5, "ONE"));
	const diff = page.getByTestId("pdf-diff");
	await expect(diff).toContainText("1 / 5");
	const next = diff.getByRole("button", { name: "Next PDF page" });
	const previous = diff.getByRole("button", { name: "Previous PDF page" });
	await next.click();
	await expect(diff).toContainText("2 / 5");
	await next.click();
	await expect(diff).toContainText("3 / 5");
	await previous.click();
	await expect(diff).toContainText("2 / 5");

	const modified = diff.getByRole("img", { name: "Modified PDF page 2" });
	await expect(modified).toBeVisible();
	const box = await modified.boundingBox();
	if (!box) throw new Error("no PDF page geometry");
	await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 6 });
	await page.mouse.up();
	await expect(page.getByTestId("region-selection")).toBeVisible();
	await page.locator('[data-testid="review-add-icon"]:visible').click();
	await saveComment(page.locator("body"), "Page two note");
	await expect(page.getByTestId("review-thread-card")).toHaveCount(1);
	await expect(page.getByTestId("region-comment-marker")).toHaveCount(1);

	const before = await imagePixels(modified);
	writeFileSync(join(worktree, "fresh.pdf"), pagedPdf(5, "TWO"));
	await expect.poll(() => imagePixels(modified), { timeout: 15_000 }).not.toBe(before);
	await expect(diff).toContainText("2 / 5");
});

const BROKEN_IMAGE = "data:image/png;base64,AAAA";
const IMAGE_A = solidPng(40, 30, 40);
const IMAGE_B = solidPng(80, 20, 200);
const IMAGE_C = solidPng(16, 64, 120);

async function openCommittedImage(page: Page, path: string): Promise<string> {
	await openFixtureProject(page);
	const { worktreePath } = await createWorkspaceViaDialog(page);
	commitFile(worktreePath, path, IMAGE_A, `add ${path}`);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: path }).dblclick();
	return worktreePath;
}

test("the image view follows zoom and on-disk edits", async ({ page }) => {
	const worktreePath = await openCommittedImage(page, "fresh.png");
	const view = page.getByTestId("image-view");
	await expect(view).toContainText("40 × 30");

	await view.getByRole("button", { name: "Zoom in" }).click();
	await expect(view).toContainText("120%");
	await view.getByRole("button", { name: "Zoom out" }).click();
	await expect(view).toContainText("100%");

	writeFileSync(join(worktreePath, "fresh.png"), IMAGE_B);
	await expect(view).toContainText("80 × 20");
	await expect(view).not.toContainText("40 × 30");
	writeFileSync(join(worktreePath, "fresh.png"), IMAGE_A);
	await expect(view).toContainText("40 × 30");
});

test("the image diff follows modes and on-disk edits", async ({ page }) => {
	const worktree = await openChange(page, "fresh.png", IMAGE_A, IMAGE_B);
	const diff = page.getByTestId("image-diff");
	await expect(diff).toContainText("40 × 30");
	await expect(diff).toContainText("80 × 20");
	const modes = page.getByTestId("image-diff-mode").getByRole("button");
	for (let mode = (await modes.count()) - 1; mode >= 0; mode -= 1) {
		await modes.nth(mode).click();
		await expect(modes.nth(mode)).toHaveAttribute("data-active", "true");
	}
	writeFileSync(join(worktree, "fresh.png"), IMAGE_C);
	await expect(diff).toContainText("16 × 64");
	await expect(diff).not.toContainText("80 × 20");
	await expect(diff).toContainText("40 × 30");
});

interface HeldImage {
	release: (src?: string) => void;
	settled: Promise<"load" | "error">;
	connected: () => boolean;
	released?: boolean;
}

declare global {
	interface Window {
		__heldImages?: HeldImage[];
	}
}

// React sets an image's `src` as an attribute and again as a property on mount, so both are held.
const holdImageSources = () => {
	const held: HeldImage[] = [];
	window.__heldImages = held;
	const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
	const setAttribute = HTMLImageElement.prototype.setAttribute;
	const seen = new WeakSet<HTMLImageElement>();
	const hold = (image: HTMLImageElement, value: string) => {
		if (seen.has(image)) return;
		seen.add(image);
		const settled = new Promise<"load" | "error">((resolve) => {
			image.addEventListener("load", () => resolve("load"), { once: true });
			image.addEventListener("error", () => resolve("error"), { once: true });
		});
		held.push({
			release: (src) => setAttribute.call(image, "src", src ?? value),
			settled,
			connected: () => image.isConnected,
		});
	};
	const isResource = (value: string) => value.includes(".png");
	HTMLImageElement.prototype.setAttribute = function (name: string, value: string) {
		if (name === "src" && isResource(value)) hold(this, value);
		else setAttribute.call(this, name, value);
	};
	Object.defineProperty(HTMLImageElement.prototype, "src", {
		...descriptor,
		set(value: string) {
			if (isResource(value)) hold(this, value);
			else descriptor?.set?.call(this, value);
		},
	});
};

const releaseMounted = (page: Page) =>
	page.evaluate(() => {
		for (const image of window.__heldImages ?? []) {
			if (image.connected() && !image.released) {
				image.released = true;
				image.release();
			}
		}
	});

const releaseUntilSize = (page: Page, surface: Locator, size: string) =>
	expect(async () => {
		await releaseMounted(page);
		await expect(surface).toContainText(size, { timeout: 500 });
	}).toPass();

const heldCount = (page: Page) => page.evaluate(() => window.__heldImages?.length ?? 0);

async function releaseImage(page: Page, index: number, src?: string) {
	return page.evaluate(
		async ([position, override]) => {
			const image = window.__heldImages?.[position as number];
			if (!image) throw new Error(`no held image ${position}`);
			const connected = image.connected();
			image.release(override as string | undefined);
			return { outcome: await image.settled, connected };
		},
		[index, src] as const,
	);
}

test("the image view hides the old size while a replacement loads", async ({ page }) => {
	await page.addInitScript(holdImageSources);
	const worktreePath = await openCommittedImage(page, "swap.png");
	const view = page.getByTestId("image-view");
	await releaseUntilSize(page, view, "40 × 30");

	const held = await heldCount(page);
	writeFileSync(join(worktreePath, "swap.png"), IMAGE_B);
	await expect.poll(() => heldCount(page)).toBeGreaterThan(held);
	await nextFrames(page);
	await expect(view).not.toContainText("40 × 30");
	await releaseUntilSize(page, view, "80 × 20");
});

test("the image diff hides the old size while a replacement loads", async ({ page }) => {
	await page.addInitScript(holdImageSources);
	const worktree = await openChange(page, "swap.png", IMAGE_A, IMAGE_B);
	const diff = page.getByTestId("image-diff");
	await releaseUntilSize(page, diff, "80 × 20");

	const held = await heldCount(page);
	writeFileSync(join(worktree, "swap.png"), IMAGE_C);
	await expect.poll(() => heldCount(page)).toBeGreaterThan(held);
	await nextFrames(page);
	await expect(diff).not.toContainText("80 × 20");
	await releaseUntilSize(page, diff, "16 × 64");
});

for (const stale of ["load", "error"] as const) {
	test(`a late ${stale} from a replaced image keeps the current image size in the view`, async ({
		page,
	}) => {
		await page.addInitScript(holdImageSources);
		const worktreePath = await openCommittedImage(page, "late.png");
		const view = page.getByTestId("image-view");
		await expect(view).toBeVisible();
		await expect.poll(() => heldCount(page)).toBeGreaterThan(0);
		const first = (await heldCount(page)) - 1;

		writeFileSync(join(worktreePath, "late.png"), IMAGE_B);
		await expect.poll(() => heldCount(page)).toBeGreaterThan(first + 1);
		const current = (await heldCount(page)) - 1;
		await releaseImage(page, current);
		await expect(view).toContainText("80 × 20");

		const late = await releaseImage(page, first, stale === "error" ? BROKEN_IMAGE : undefined);
		expect(late).toEqual({ outcome: stale, connected: false });
		await nextFrames(page);
		await expect(view).toContainText("80 × 20");
		await expect(view).not.toContainText("40 × 30");
	});

	test(`a late ${stale} from a replaced image keeps the current image size in the diff`, async ({
		page,
	}) => {
		await page.addInitScript(holdImageSources);
		const worktree = await openChange(page, "late.png", IMAGE_A, IMAGE_B);
		const diff = page.getByTestId("image-diff");
		await expect(diff).toBeVisible();
		await expect.poll(() => heldCount(page)).toBeGreaterThanOrEqual(2);
		const held = await heldCount(page);
		for (let index = 0; index < held - 1; index += 1) await releaseImage(page, index);
		await expect(diff).toContainText("40 × 30");
		const stuck = held - 1;

		writeFileSync(join(worktree, "late.png"), IMAGE_C);
		await expect.poll(() => heldCount(page)).toBeGreaterThan(held);
		await releaseImage(page, (await heldCount(page)) - 1);
		await expect(diff).toContainText("16 × 64");

		const late = await releaseImage(page, stuck, stale === "error" ? BROKEN_IMAGE : undefined);
		expect(late).toEqual({ outcome: stale, connected: false });
		await nextFrames(page);
		await expect(diff).toContainText("16 × 64");
		await expect(diff).not.toContainText("80 × 20");
	});
}

test("history search highlights the current query and follows the selection", async ({ page }) => {
	await openFixtureProject(page);
	const repo = realpathSync(E2E_FIXTURE_REPO);
	for (let index = 0; index < 4; index += 1) {
		seedWorkspaceSession(repo, {
			name: `History ${index}`,
			messages: [
				{
					role: "user",
					text: `needle about module ${index}`,
					timestamp: 1_700_000_000_000 + index,
				},
			],
		});
	}
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "History 0");
	await page.getByTestId("chat-input").press("Control+r");
	const query = page.getByTestId("history-query");
	await query.fill("needle");
	const marks = page.getByTestId("history-overlay").locator("mark");
	await expect(marks.first()).toHaveText("needle");

	await query.fill("module");
	await expect(marks.first()).toHaveText("module");
	await expect(marks.filter({ hasText: "needle" })).toHaveCount(0);
	const selected = page.locator('[data-testid="history-item"][data-selected="true"]');
	const before = await selected.textContent();
	await query.press("ArrowUp");
	await expect(selected).toHaveCount(1);
	await expect(selected).not.toHaveText(before ?? "");
});

test("the Resources inspector moves its selection and detail with the arrow keys", async ({
	page,
}) => {
	await page.addInitScript(stubResourceWire, 5);
	await openFixtureProject(page);
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "Resource freshness",
		messages: [{ role: "user", text: "Inspect resources.", timestamp: Date.now() }],
	});
	await enterDefaultWorkspace(page);
	await openPersistedChat(page, "Resource freshness");
	await page.getByTestId("resources-trigger").click();
	const inspector = page.getByTestId("resources-inspector");
	const selected = inspector.locator('[data-selected="true"][data-resource-id]');
	const option = (id: string) => inspector.locator(`[data-resource-id="${id}"] [role="option"]`);
	await expect(selected).toHaveCount(1);
	const first = await selected.getAttribute("data-resource-id");
	if (!first) throw new Error("no selected resource");
	await option(first).focus();

	await page.keyboard.press("ArrowDown");
	await expect(selected).toHaveCount(1);
	await expect(selected).not.toHaveAttribute("data-resource-id", first);
	const detail = inspector.getByTestId("resources-inspector-detail");
	const task = await selected.getByRole("option").textContent();
	expect(task).toMatch(/Inspect module \d/);
	await expect(detail).toContainText(task?.match(/Inspect module \d/)?.[0] ?? "");

	await page.keyboard.press("ArrowUp");
	await expect(selected).toHaveAttribute("data-resource-id", first);
});
