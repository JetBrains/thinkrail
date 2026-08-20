import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import { seedExternalCwdSessions } from "./fixtures/sessions";
import {
	clearTemplateFixtures,
	removeGlobalTemplates,
	seedTemplateFixtures,
} from "./fixtures/templates";

test.describe("templates management", () => {
	test("Global empty state offers starter templates; adding them fills the composer's / menu", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		clearTemplateFixtures();

		try {
			const input = page.getByTestId("chat-input");
			await input.fill("/");
			const nudge = page.getByTestId("slash-templates-empty");
			await expect(nudge).toBeVisible();
			await nudge.click();

			const settingsDialog = page.getByTestId("settings-dialog");
			await expect(settingsDialog).toContainText("Prompt templates");

			const globalRows = page.locator('[data-testid="template-row"][data-scope="global"]');
			await expect(globalRows).toHaveCount(0);
			const offer = page.getByTestId("template-starters");
			await expect(offer).toBeVisible();

			await offer.click();
			await expect(globalRows).toHaveCount(5);
			for (const name of ["review", "explain", "tests", "commit", "rename"]) {
				await expect(
					page.locator(`[data-testid="template-row"][data-name="${name}"][data-scope="global"]`),
				).toBeVisible();
			}
			await expect(offer).toHaveCount(0);

			await page.keyboard.press("Escape");
			await expect(settingsDialog).toBeHidden();

			await input.fill("/rev");
			await expect(
				page
					.locator('[data-testid="slash-command"][data-source="prompt"]')
					.filter({ hasText: "review" }),
			).toHaveCount(1);
			await expect(nudge).toHaveCount(0);
			await input.fill("");
		} finally {
			removeGlobalTemplates(["review", "explain", "tests", "commit", "rename"]);
			seedTemplateFixtures();
		}
	});

	test("global template: create shows up in the composer's / menu, edit updates it, delete removes it from both", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		const menuHit = page
			.locator('[data-testid="slash-command"][data-source="prompt"]')
			.filter({ hasText: "standup" });

		await input.fill("/stand");
		await expect(menuHit).toHaveCount(0);
		await input.fill("");

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-templates").click();
		const settingsDialog = page.getByTestId("settings-dialog");
		await expect(settingsDialog).toContainText("Prompt templates");

		await page.getByTestId("template-new-global").click();
		const editor = page.getByTestId("template-editor-dialog");
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-scope-global")).toHaveAttribute("data-active", "true");

		await page.getByTestId("template-name-input").fill("standup");
		await page.getByTestId("template-description-input").fill("Daily standup notes");
		await page.getByTestId("template-body-input").fill("What did you do yesterday?");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();

		const row = page.locator('[data-testid="template-row"][data-name="standup"]');
		await expect(row).toBeVisible();
		await expect(row).toContainText("standup");
		await expect(row).toContainText("Daily standup notes");

		await page.keyboard.press("Escape");
		await expect(settingsDialog).toBeHidden();

		await input.fill("/stand");
		await expect(menuHit).toHaveCount(1);
		await input.fill("");

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-templates").click();
		await row.getByTestId("template-edit").click();
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-name-input")).toBeDisabled();
		await expect(page.getByTestId("template-scope-project")).toBeDisabled();
		await page.getByTestId("template-description-input").fill("Standup notes, revised");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();
		await expect(row).toContainText("Standup notes, revised");

		await row.getByTestId("template-delete").click();
		await expect(page.getByRole("alertdialog", { name: /Delete standup/ })).toBeVisible();
		await page.getByTestId("template-confirm-delete").click();
		await expect(row).toHaveCount(0);

		await page.keyboard.press("Escape");
		await expect(settingsDialog).toBeHidden();
		await input.fill("/stand");
		await expect(menuHit).toHaveCount(0);
	});

	test("frontmatter round-trip: picking a saved template gets the body verbatim, and an edit-save cycle never grows it", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		const settingsDialog = page.getByTestId("settings-dialog");
		const editor = page.getByTestId("template-editor-dialog");

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-templates").click();
		await page.getByTestId("template-new-global").click();
		await expect(editor).toBeVisible();

		await page.getByTestId("template-name-input").fill("roundtrip");
		await page.getByTestId("template-description-input").fill("Round-trip check");
		await page.getByTestId("template-body-input").fill("Notes for the day");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();

		await page.keyboard.press("Escape");
		await expect(settingsDialog).toBeHidden();

		await input.fill("/roundtrip");
		await page
			.locator('[data-testid="slash-command"][data-source="prompt"]')
			.filter({ hasText: "roundtrip" })
			.first()
			.click();
		await expect(input).toHaveValue("Notes for the day");
		await input.fill("");

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-templates").click();
		const row = page.locator('[data-testid="template-row"][data-name="roundtrip"]');
		await row.getByTestId("template-edit").click();
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-body-input")).toHaveValue("Notes for the day");
		await page.getByTestId("template-description-input").fill("Round-trip check, revised");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();

		await row.getByTestId("template-edit").click();
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-body-input")).toHaveValue("Notes for the day");
		await page.getByTestId("template-cancel").click();
	});

	test("an invalid template name shows an inline error instead of saving", async ({ page }) => {
		await openWorkspaceChat(page);
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-templates").click();
		await page.getByTestId("template-new-global").click();
		const editor = page.getByTestId("template-editor-dialog");
		await expect(editor).toBeVisible();

		await page.getByTestId("template-name-input").fill(".hidden");
		await page.getByTestId("template-body-input").fill("anything");
		await page.getByTestId("template-save").click();

		await expect(page.getByTestId("template-error")).toBeVisible();
		await expect(editor).toBeVisible();
		await expect(page.locator('[data-testid="template-row"][data-name=".hidden"]')).toHaveCount(0);
	});

	test("a project-scoped template is written into the worktree and shows up in the Files tree", async ({
		page,
	}) => {
		await openWorkspaceChat(page);

		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-templates").click();
		await page.getByTestId("template-new-project").click();
		const editor = page.getByTestId("template-editor-dialog");
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-scope-project")).toHaveAttribute("data-active", "true");

		await page.getByTestId("template-name-input").fill("scoped-note");
		await page.getByTestId("template-body-input").fill("Project-scoped body");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();

		const row = page.locator(
			'[data-testid="template-row"][data-name="scoped-note"][data-scope="project"]',
		);
		await expect(row).toBeVisible();

		const settingsDialog = page.getByTestId("settings-dialog");
		await row.getByTestId("template-open-file").click();
		await expect(settingsDialog).toBeHidden();
		await expect(
			page.locator('[data-testid="editor-tab"]').filter({ hasText: "scoped-note.md" }),
		).toBeVisible();

		await page.getByTestId("tab-files").click();
		const promptsDir = page
			.locator('[data-testid="file-node"][data-kind="dir"]')
			.filter({ hasText: /^\.pi\/prompts$/ });
		await expect(promptsDir).toBeVisible();
		await promptsDir.click();
		await expect(
			page
				.locator('[data-testid="file-node"][data-kind="file"]')
				.filter({ hasText: /^scoped-note\.md$/ }),
		).toBeVisible();
	});

	test("history overlay: save-as-template opens the shared editor prefilled with the selected prompt", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		seedExternalCwdSessions();

		const input = page.getByTestId("chat-input");
		const overlay = page.getByTestId("history-overlay");
		const query = page.getByTestId("history-query");
		const scopeBadge = page.getByTestId("history-scope");
		const promptRow = page
			.locator('[data-testid="history-item"][data-kind="prompt"]')
			.filter({ hasText: "fix the flaky watcher test" });

		await input.press("Control+r");
		await expect(overlay).toBeVisible();
		await query.fill("flaky");
		await query.press("Control+r");
		await query.press("Control+r");
		await expect(scopeBadge).toHaveAttribute("data-scope", "all");
		await expect(promptRow).toBeVisible();

		await promptRow.hover();
		await expect(promptRow.getByTestId("history-save-template")).toBeVisible();

		await query.press("Control+s");
		await expect(overlay).toBeHidden();
		const editor = page.getByTestId("template-editor-dialog");
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-body-input")).toHaveValue("fix the flaky watcher test");
		await expect(page.getByTestId("template-name-input")).toHaveValue("");

		await page.getByTestId("template-cancel").click();
		await expect(editor).toBeHidden();
	});

	test("a project template shadowing a same-named global one leaves both visible and independently editable", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		await page.getByTestId("open-settings").click();
		await page.getByTestId("settings-nav-templates").click();
		const editor = page.getByTestId("template-editor-dialog");

		await page.getByTestId("template-new-global").click();
		await expect(editor).toBeVisible();
		await page.getByTestId("template-name-input").fill("foo");
		await page.getByTestId("template-description-input").fill("Global foo");
		await page.getByTestId("template-body-input").fill("Global foo body");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();

		const globalRow = page.locator(
			'[data-testid="template-row"][data-name="foo"][data-scope="global"]',
		);
		await expect(globalRow).toBeVisible();
		await expect(globalRow).toContainText("Global foo");

		await page.getByTestId("template-new-project").click();
		await expect(editor).toBeVisible();
		await page.getByTestId("template-name-input").fill("foo");
		await page.getByTestId("template-description-input").fill("Project foo");
		await page.getByTestId("template-body-input").fill("Project foo body");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();

		const projectRow = page.locator(
			'[data-testid="template-row"][data-name="foo"][data-scope="project"]',
		);
		await expect(projectRow).toBeVisible();
		await expect(projectRow).toContainText("Project foo");
		await expect(globalRow).toBeVisible();
		await expect(globalRow).toContainText("Global foo");

		await globalRow.getByTestId("template-edit").click();
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-scope-global")).toHaveAttribute("data-active", "true");
		await page.getByTestId("template-description-input").fill("Global foo, revised");
		await page.getByTestId("template-save").click();
		await expect(editor).toBeHidden();

		await expect(globalRow).toContainText("Global foo, revised");
		await expect(projectRow).toContainText("Project foo");
		await expect(projectRow).not.toContainText("revised");
	});

	test("editing a template whose frontmatter fence is past the listing scan window keeps its metadata", async ({
		page,
	}) => {
		const hugeHint = "p".repeat(16 * 1024);
		const filePath = join(E2E_PI_AGENT_DIR, "prompts", "deep-meta.md");
		writeFileSync(
			filePath,
			`---\ndescription: "buried description"\nargument-hint: "${hugeHint}"\n---\nOriginal body\n`,
		);
		try {
			await openWorkspaceChat(page);
			await page.getByTestId("open-settings").click();
			await page.getByTestId("settings-nav-templates").click();

			const row = page.locator(
				'[data-testid="template-row"][data-name="deep-meta"][data-scope="global"]',
			);
			await expect(row).toBeVisible();
			await expect(row).not.toContainText("buried description");

			await row.getByTestId("template-edit").click();
			const editor = page.getByTestId("template-editor-dialog");
			await expect(editor).toBeVisible();
			await expect(page.getByTestId("template-description-input")).toHaveValue(
				"buried description",
			);
			await expect(page.getByTestId("template-body-input")).toHaveValue("Original body");

			await page.getByTestId("template-body-input").fill("Edited body");
			await page.getByTestId("template-save").click();
			await expect(editor).toBeHidden();

			const onDisk = readFileSync(filePath, "utf-8");
			expect(onDisk).toContain('description: "buried description"');
			expect(onDisk).toContain(`argument-hint: "${hugeHint}"`);
			expect(onDisk).toContain("Edited body");
			expect(onDisk).not.toContain("Original body");
		} finally {
			removeGlobalTemplates(["deep-meta"]);
		}
	});

	test("editing a hand-created template with a whitespace-bearing name round-trips to the same file", async ({
		page,
	}) => {
		const promptsDir = join(E2E_PI_AGENT_DIR, "prompts");
		const filePath = join(promptsDir, "report .md");
		writeFileSync(filePath, `---\ndescription: "Trailing-space name"\n---\nHand-created body\n`);
		try {
			await openWorkspaceChat(page);
			await page.getByTestId("open-settings").click();
			await page.getByTestId("settings-nav-templates").click();

			const row = page.locator(
				'[data-testid="template-row"][data-name="report "][data-scope="global"]',
			);
			await expect(row).toBeVisible();
			await row.getByTestId("template-edit").click();
			const editor = page.getByTestId("template-editor-dialog");
			await expect(editor).toBeVisible();
			await expect(page.getByTestId("template-name-input")).toHaveValue("report ");
			await expect(page.getByTestId("template-body-input")).toHaveValue("Hand-created body");

			await page.getByTestId("template-body-input").fill("Edited body");
			await page.getByTestId("template-save").click();
			await expect(editor).toBeHidden();

			const onDisk = readFileSync(filePath, "utf-8");
			expect(onDisk).toContain("Edited body");
			expect(onDisk).toContain('description: "Trailing-space name"');
			expect(existsSync(join(promptsDir, "report.md"))).toBe(false);
		} finally {
			removeGlobalTemplates(["report ", "report"]);
		}
	});
});
