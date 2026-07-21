import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { seedExternalCwdSessions } from "./fixtures/sessions";

// No-agent: Settings → Templates (create/edit/delete, both scopes) + the history overlay's
// save-as-template action. `templates-compose.spec.ts` already covers the composer `/` menu + slot
// session against pre-seeded global fixtures (`e2e/fixtures/templates.ts`, untouched here); this suite
// instead drives the *management* surface end to end — a template created here must show up in (and a
// deleted one must vanish from) that same `/` menu, proving the store's `templatesVersion` bump actually
// invalidates `ChatView`'s cached fetch rather than just exercising the settings panel in isolation.
test.describe("templates management", () => {
	test("global template: create shows up in the composer's / menu, edit updates it, delete removes it from both", async ({
		page,
	}) => {
		await openWorkspaceChat(page);
		const input = page.getByTestId("chat-input");
		const menuHit = page
			.locator('[data-testid="slash-command"][data-source="prompt"]')
			.filter({ hasText: "standup" });

		// Not there yet.
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

		// Now it shows up — the save bumped `templatesVersion`, invalidating the composer's cached fetch.
		await input.fill("/stand");
		await expect(menuHit).toHaveCount(1);
		await input.fill("");

		// Edit: name + scope lock, description changes and the row (and re-fetch) reflect it.
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

		// Delete (confirm popover, mirroring the workspace-remove pattern) — gone from the panel... Scoped
		// to this row: the Global group also lists the suite-wide seeded fixture templates, so an unscoped
		// `template-delete` would be ambiguous.
		await row.getByTestId("template-delete").click();
		await expect(page.getByRole("alertdialog", { name: /Delete standup/ })).toBeVisible();
		await page.getByTestId("template-confirm-delete").click();
		await expect(row).toHaveCount(0);

		// ...and gone from the / menu too.
		await page.keyboard.press("Escape");
		await expect(settingsDialog).toBeHidden();
		await input.fill("/stand");
		await expect(menuHit).toHaveCount(0);
	});

	// Reviewer-flagged regression: the assembler always wraps a real description in frontmatter, so picking
	// the saved template back up must hand back the body exactly as typed — no leaked leading blank line —
	// and an edit-save cycle that only touches the description must never grow the body (unit-level pin:
	// `chat/templateText.test.ts`; this is the end-to-end proof over the real dialog + wire).
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

		// Pick via /roundtrip: the draft must equal the body exactly — no leading blank line leaked in by
		// the client-side splitter.
		await input.fill("/roundtrip");
		await page
			.locator('[data-testid="slash-command"][data-source="prompt"]')
			.filter({ hasText: "roundtrip" })
			.first()
			.click();
		await expect(input).toHaveValue("Notes for the day");
		await input.fill("");

		// Edit only the description, save, reopen: the body must be byte-for-byte unchanged — not
		// compounded with an extra leading blank line from the previous split/assemble cycle.
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

		// Leading "." is the server's own `isValidTemplateName` path-traversal gate, mirrored client-side.
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

		// Open-as-file is project-only — global rows never get this action. Clicking it both opens the real
		// file as a center editor tab (the exact `openFileInTab` action the file tree itself uses) and closes
		// Settings — no separate Escape needed.
		const settingsDialog = page.getByTestId("settings-dialog");
		await row.getByTestId("template-open-file").click();
		await expect(settingsDialog).toBeHidden();
		await expect(
			page.locator('[data-testid="editor-tab"]').filter({ hasText: "scoped-note.md" }),
		).toBeVisible();

		// The file really landed in the worktree: `.pi/prompts/scoped-note.md`, browsable like any other file
		// — `fs.readDir` doesn't special-case dotdirs beyond `.git`, so no app-side special-casing is needed.
		await page.getByTestId("tab-files").click();
		const piDir = page
			.locator('[data-testid="file-node"][data-kind="dir"]')
			.filter({ hasText: /^\.pi$/ });
		await expect(piDir).toBeVisible();
		await piDir.click();
		const promptsDir = page
			.locator('[data-testid="file-node"][data-kind="dir"]')
			.filter({ hasText: /^prompts$/ });
		await expect(promptsDir).toBeVisible();
		await promptsDir.click();
		await expect(
			page
				.locator('[data-testid="file-node"][data-kind="file"]')
				.filter({ hasText: /^scoped-note\.md$/ }),
		).toBeVisible();
	});

	// Save-as-template's other entry point: the Ctrl+R history overlay's selected prompt row. Reuses
	// `seedExternalCwdSessions`'s deterministic fixture ("fix the flaky watcher test") the same way
	// `history-search.spec.ts` does — cycle scope to "all" so the deliberately-unmapped external-cwd
	// session is in view, then act on its (default-selected) prompt row.
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

		// Click affordance: hovering the row reveals its save-as-template button.
		await promptRow.hover();
		await expect(promptRow.getByTestId("history-save-template")).toBeVisible();

		// Keyboard affordance: Cmd/Ctrl+S while this (sole, hence default-selected) prompt row is the
		// keyboard selection — the overlay closes and the shared editor opens, body-prefilled.
		await query.press("Control+s");
		await expect(overlay).toBeHidden();
		const editor = page.getByTestId("template-editor-dialog");
		await expect(editor).toBeVisible();
		await expect(page.getByTestId("template-body-input")).toHaveValue("fix the flaky watcher test");
		await expect(page.getByTestId("template-name-input")).toHaveValue("");

		await page.getByTestId("template-cancel").click();
		await expect(editor).toBeHidden();
	});
});
