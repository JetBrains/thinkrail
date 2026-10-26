import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
	TEXT_SEARCH_LIMITS,
	TEXT_SEARCH_PROTOCOL_VERSION,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

const FIND_DIR = join(E2E_FIXTURE_REPO, "find");

function seedFindFixtures(): void {
	mkdirSync(FIND_DIR, { recursive: true });
	writeFileSync(
		join(FIND_DIR, "alpha.ts"),
		["export const needle = 1;", "export const needles = 2;", "// Needle in a haystack", ""].join(
			"\n",
		),
	);
	writeFileSync(join(FIND_DIR, "beta.md"), ["# Beta", "", "A needle here.", ""].join("\n"));
	writeFileSync(
		join(FIND_DIR, "blob.bin"),
		Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("needle"), Buffer.from([0])]),
	);
	writeFileSync(
		join(FIND_DIR, "many.txt"),
		`${Array.from({ length: TEXT_SEARCH_LIMITS.lines + 100 }, (_, i) => `limit-probe ${i + 1}`).join("\n")}\n`,
	);
}

test.beforeEach(() => seedFindFixtures());
test.afterEach(() => rmSync(FIND_DIR, { recursive: true, force: true }));

function dialog(page: Page) {
	return page.getByTestId("find-in-files");
}

function input(page: Page) {
	return page.getByTestId("find-in-files-input");
}

function matches(page: Page) {
	return page.getByTestId("find-in-files-match");
}

function fileHeader(page: Page, path: string) {
	return page.locator(`[data-testid="find-in-files-file"][data-path="${path}"]`);
}

function editorLine(page: Page, text: string) {
	return page.locator('[data-testid="editor-pane"]:visible .view-line', { hasText: text });
}

async function openFindInFiles(page: Page): Promise<void> {
	await pressPlatformShortcut(page, "Shift+F");
	await expect(dialog(page)).toBeVisible();
	await expect(input(page)).toBeFocused();
}

async function expectStatus(page: Page, text: string): Promise<void> {
	await expect(page.getByTestId("find-in-files-status")).toHaveText(text, { timeout: 15_000 });
}

test("Mod+Shift+F searches as you type, groups matches by file, previews the selection, and Enter opens the file at the line", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openFindInFiles(page);
	await expect(page.getByTestId("find-in-files-scope")).toContainText("Default");

	await input(page).fill("needle");
	await expectStatus(page, "4 matches in 2 files");
	await expect(fileHeader(page, "find/alpha.ts")).toContainText("3");
	await expect(fileHeader(page, "find/beta.md")).toContainText("1");
	await expect(fileHeader(page, "find/blob.bin")).toHaveCount(0);
	await expect(matches(page)).toHaveCount(4);
	const first = matches(page).first();
	await expect(first).toHaveAttribute("aria-selected", "true");
	await expect(first.locator("mark")).toHaveText("needle");

	const preview = page.getByTestId("find-in-files-preview");
	await expect(preview.locator(".view-line", { hasText: "needle = 1" })).toBeVisible({
		timeout: 15_000,
	});
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	const third = matches(page).nth(2);
	await expect(third).toHaveAttribute("aria-selected", "true");
	await expect(third).toHaveAttribute("data-line", "3");
	await expect(preview.locator(".view-line", { hasText: "Needle in a haystack" })).toBeVisible();

	await page.keyboard.press("Enter");
	await expect(dialog(page)).toBeHidden();
	const tab = page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "alpha.ts" });
	await expect(tab).toBeVisible();
	await expect(editorLine(page, "Needle in a haystack")).toBeInViewport();
	await expect(
		page.locator('[data-testid="editor-pane"]:visible .view-overlays .selected-text').first(),
	).toBeVisible();

	await openFindInFiles(page);
	await expect(input(page)).toHaveValue("needle");
	await expect(matches(page)).toHaveCount(4);
	await expect(matches(page).nth(2)).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Escape");
	await expect(dialog(page)).toBeHidden();
});

test("smart case, the Aa and W toggles narrow the search, and the limit banner says where the host stopped", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openFindInFiles(page);

	await input(page).fill("Needle");
	await expectStatus(page, "1 match in 1 file");
	await expect(matches(page)).toHaveAttribute("data-line", "3");

	await input(page).fill("needle");
	await expectStatus(page, "4 matches in 2 files");
	await page.getByTestId("find-in-files-case").click();
	await expect(page.getByTestId("find-in-files-case")).toHaveAttribute("aria-pressed", "true");
	await expectStatus(page, "3 matches in 2 files");
	await expect(input(page)).toBeFocused();

	await page.getByTestId("find-in-files-word").click();
	await expectStatus(page, "2 matches in 2 files");
	await page.keyboard.press("Alt+KeyC");
	await expect(page.getByTestId("find-in-files-case")).toHaveAttribute("aria-pressed", "false");
	await expectStatus(page, "3 matches in 2 files");
	await page.keyboard.press("Alt+KeyW");
	await expect(page.getByTestId("find-in-files-word")).toHaveAttribute("aria-pressed", "false");
	await expectStatus(page, "4 matches in 2 files");

	await input(page).fill("limit-probe");
	await expect(page.getByTestId("find-in-files-limit")).toContainText(
		`first ${TEXT_SEARCH_LIMITS.lines} matches`,
		{ timeout: 20_000 },
	);
	await expectStatus(page, `${TEXT_SEARCH_LIMITS.lines} matches in 1 file`);
	await expect(matches(page)).toHaveCount(TEXT_SEARCH_LIMITS.lines);

	await input(page).fill("no-such-text-anywhere");
	await expect(page.getByTestId("find-in-files-empty")).toContainText("Nothing found in Default", {
		timeout: 15_000,
	});
	await input(page).fill("n");
	await expect(matches(page)).toHaveCount(0);
	await expect(page.getByTestId("find-in-files-empty")).toHaveCount(0);
});

test("from Project Home the palette's command opens the window, the search covers the Default workspace, and Enter enters it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await expect(defaultWorkspaceRow(page)).not.toHaveAttribute("data-active", "true");

	await pressPlatformShortcut(page, "k");
	await page.getByTestId("search-input").fill(">find in files");
	const command = page.locator(
		'[data-testid="search-row"][data-item-id="command:files.findInFiles"]',
	);
	await expect(command).toBeVisible();
	await expect(command.locator("kbd")).not.toHaveCount(0);
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("search-palette")).toBeHidden();
	await expect(dialog(page)).toBeVisible();
	await expect(input(page)).toBeFocused();
	await expect(page.getByTestId("find-in-files-scope")).toContainText("sample-project");

	await input(page).fill("needle here");
	await expectStatus(page, "1 match in 1 file");
	await page.keyboard.press("Shift");
	await page.keyboard.press("Shift");
	await expect(page.getByTestId("search-palette")).toHaveCount(0);
	await expect(dialog(page)).toBeVisible();

	await page.keyboard.press("Enter");
	await expect(dialog(page)).toBeHidden();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(
		page.locator('[data-testid="editor-tab"][data-kind="file"]', { hasText: "beta.md" }),
	).toBeVisible();
	await expect(editorLine(page, "A needle here.")).toBeInViewport();
});

test("an older host hides the command, and the window says the host needs an update without asking it", async ({
	page,
}) => {
	const hostRequests: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (socket) => {
		const server = socket.connectToServer();
		socket.onMessage((message) => {
			const frame = JSON.parse(String(message)) as { method?: string };
			if (frame.method === "search.text") hostRequests.push(frame.method);
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(String(message)) as {
				channel?: string;
				data: { protocolVersion: number };
			};
			if (frame.channel === WS_CHANNELS.serverWelcome) {
				frame.data.protocolVersion = TEXT_SEARCH_PROTOCOL_VERSION - 1;
				socket.send(JSON.stringify(frame));
			} else socket.send(message);
		});
	});
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	await pressPlatformShortcut(page, "k");
	await page.getByTestId("search-input").fill(">find in files");
	await expect(
		page.locator('[data-testid="search-row"][data-item-id="command:files.findInFiles"]'),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("search-palette")).toBeHidden();

	await openFindInFiles(page);
	await input(page).fill("needle");
	await expect(page.getByTestId("find-in-files-status")).toContainText("update it");
	await page.waitForTimeout(500);
	expect(hostRequests).toEqual([]);
	await expect(matches(page)).toHaveCount(0);
});
