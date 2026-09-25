import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject, openPersistedChat } from "./fixtures/app";
import { installRepoExtension, reloadExtension, removeExtension } from "./fixtures/extensions";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";
import { shot } from "./fixtures/screenshots";
import { seedWorkspaceSession } from "./fixtures/sessions";

const GROUP = "extension-project-notes";
const EXTENSION = "project-notes";
const BASE_TS = 1_700_950_000_000;

const clearStore = () =>
	rmSync(join(E2E_DATA_DIR, "ext-store", `${EXTENSION}.json`), { force: true });

const seedChat = () =>
	seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "notes chat",
		messages: [
			{ role: "user", text: "Remember that we deploy only from main", timestamp: BASE_TS },
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "pin-1",
						name: "add_project_note",
						arguments: {
							title: "Deploys",
							body: "Deploy only from `main`, never from a feature branch.",
						},
					},
				],
				stopReason: "toolUse",
				timestamp: BASE_TS + 1_000,
			},
			{
				role: "toolResult",
				toolCallId: "pin-1",
				toolName: "add_project_note",
				content: [{ type: "text", text: 'Saved project note "Deploys".' }],
				details: {
					note: {
						id: "n-deploys",
						title: "Deploys",
						body: "Deploy only from `main`, never from a feature branch.",
						enabled: true,
						source: "agent",
						createdAt: BASE_TS + 1_500,
						updatedAt: BASE_TS + 1_500,
					},
					sent: true,
				},
				isError: false,
				timestamp: BASE_TS + 2_000,
			},
		],
	});

const openPanel = async (page: Page) => {
	await page.getByTestId("ext-menu").first().click();
	await page.getByTestId(`ext-open-${EXTENSION}-notes`).click();
	return page.getByTestId("project-notes");
};

const addNote = async (page: Page, title: string, body: string) => {
	const panel = page.getByTestId("project-notes");
	await panel.getByTestId("project-notes-new").click();
	await panel.getByTestId("project-notes-title").fill(title);
	await panel.getByTestId("project-notes-body").fill(body);
	await panel.getByTestId("project-notes-save").click();
	await expect(panel.getByTestId("project-notes-editor")).toBeHidden();
};

test.use({ viewport: { width: 1600, height: 1400 } });

test.beforeEach(clearStore);

test.afterEach(async () => {
	await removeExtension(EXTENSION);
	clearStore();
});

test("project-notes adds, edits, toggles, caps, and deletes notes", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");

	const status = page.getByTestId("project-notes-status");
	await expect(status).toBeHidden();
	const panel = await openPanel(page);
	await expect(panel.getByTestId("project-notes-empty")).toBeVisible();
	await shot(panel, GROUP, "10-project-notes-empty");

	await panel.getByTestId("project-notes-new").click();
	await panel.getByTestId("project-notes-title").fill("Package manager");
	await panel
		.getByTestId("project-notes-body")
		.fill("- Use `bun`, never `npm` or `yarn`.\n- Pin exact versions through the root catalog.");
	await expect(panel.getByTestId("project-notes-size")).toContainText("tokens");
	await shot(panel, GROUP, "10-project-notes-editor");
	await panel.getByTestId("project-notes-save").click();

	await addNote(
		page,
		"Tests",
		"Run `bun run test` and the focused E2E spec before handing off. Never skip a failing test.",
	);
	await addNote(page, "", "API handlers live in packages/server/src/host. Keep them thin.");

	const notes = panel.getByTestId("project-notes-note");
	await expect(notes).toHaveCount(3);
	await expect(panel.getByTestId("project-notes-active")).toHaveText("3 active");
	await expect(status).toHaveText("3 notes");
	await expect(notes.nth(2)).toContainText("API handlers live in packages/server/src/host.");

	await notes.nth(1).getByTestId("project-notes-toggle").click();
	await expect(notes.nth(1)).toHaveAttribute("data-enabled", "false");
	await expect(status).toHaveText("2 notes");
	await shot(status, GROUP, "10-project-notes-status");
	await page.mouse.move(0, 0);
	await shot(panel, GROUP, "10-project-notes-panel");

	await notes.nth(0).getByTestId("project-notes-open").click();
	await panel.getByTestId("project-notes-title").fill("Package manager (bun)");
	await panel.getByTestId("project-notes-save").click();
	await expect(notes.nth(0)).toContainText("Package manager (bun)");

	await addNote(
		page,
		"Architecture notes",
		`The web app talks only to contracts. ${"x".repeat(3_000)}`,
	);
	await addNote(page, "Style guide", `Arrow functions and interfaces. ${"y".repeat(3_000)}`);
	await expect(notes).toHaveCount(5);
	await expect(panel.getByTestId("project-notes-over-cap")).toContainText("1 note is past the cap");
	await expect(notes.nth(4)).toHaveAttribute("data-sent", "false");
	await expect(status).toHaveAttribute("data-over-cap", "true");
	await page.mouse.move(0, 0);
	await shot(panel, GROUP, "10-project-notes-over-cap");
	await notes.nth(4).scrollIntoViewIfNeeded();
	await shot(panel, GROUP, "10-project-notes-over-cap-list");

	await notes.nth(3).getByTestId("project-notes-open").click();
	await panel.getByTestId("project-notes-delete").click();
	await expect(panel.getByTestId("project-notes-delete")).toHaveText("Delete for good");
	await panel.getByTestId("project-notes-delete").click();
	await expect(notes).toHaveCount(4);
	await expect(notes.nth(3)).toHaveAttribute("data-sent", "true");
	await expect(panel.getByTestId("project-notes-over-cap")).toBeHidden();
	await shot(page, GROUP, "10-project-notes-app");
});

test("the add_project_note tool card renders from a seeded transcript", async ({ page }) => {
	await openFixtureProject(page);
	seedChat();
	await enterDefaultWorkspace(page);
	installRepoExtension(EXTENSION);
	expect((await reloadExtension(EXTENSION)).status).toBe("active");
	await openPersistedChat(page, "notes chat");

	const card = page.getByTestId("project-notes-tool");
	await expect(card).toHaveAttribute("data-state", "saved");
	await expect(card).toContainText("Deploys");
	await expect(card).toContainText("sent with every run");
	await shot(card, GROUP, "10-project-notes-tool-card");

	await card.getByTestId("project-notes-tool-open").click();
	await expect(page.getByTestId("project-notes")).toBeVisible();
});
