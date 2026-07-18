import { expect, type Page, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// The Appearance settings section: the theme picker. Themes are SERVER-SYNCED (config.json on the host,
// delivered in server.welcome), so a pick survives a reload. This test leaves the host back on Dark so the
// shared e2e data dir stays in its default state for other specs.
test("appearance section switches the theme and persists it across a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const html = page.locator("html");
	// Fresh data dir → DEFAULT_CONFIG → Dark.
	await expect(html).toHaveAttribute("data-theme", "dark");

	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog).toContainText("Theme");

	// Dark is the active option to start.
	await expect(page.getByTestId("theme-option-dark")).toHaveAttribute("data-active", "true");

	// Pick Light → the swap applies (converged on the settings.changed broadcast) and the option marks active.
	await page.getByTestId("theme-option-light").click();
	await expect(html).toHaveAttribute("data-theme", "light");
	await expect(page.getByTestId("theme-option-light")).toHaveAttribute("data-active", "true");

	// Pick Darcula → applies live too.
	await page.getByTestId("theme-option-darcula").click();
	await expect(html).toHaveAttribute("data-theme", "darcula");

	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();

	// Server-synced: a reload comes back on Darcula (from server.welcome's config, not a fresh default).
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(html).toHaveAttribute("data-theme", "darcula");

	// Leave the host back on Dark so the shared data dir stays default for the other specs.
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await page.getByTestId("theme-option-dark").click();
	await expect(html).toHaveAttribute("data-theme", "dark");
});

async function pickTheme(page: Page, theme: string): Promise<void> {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await page.getByTestId(`theme-option-${theme}`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("settings-dialog")).toBeHidden();
}

// Monaco rebuilds its theme from the CSS tokens — and the BUILT stylesheet is minified, so a token can
// come back as short hex (`#ffffff` → `#fff`), which Monaco rejects. This suite runs against the built
// app, so opening a real file under each theme guards that whole token → Monaco path: an unopenable file
// (the editor ErrorBoundary) or an editor that silently keeps the previous palette both fail here.
test("Monaco opens files and re-themes under every theme", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// Mount the editor UNDER Light — the regression case: `--surface-content` resolves to `#fff` from
	// minified CSS, which used to throw in defineTheme and crash the panel before first paint.
	await pickTheme(page, "light");
	await page.getByTestId("tab-files").click();
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
	await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);
	const editor = page.locator(".monaco-editor").first();
	await expect(editor).toHaveCSS("background-color", "rgb(255, 255, 255)");

	// Swap with the editor open — the data-theme observer must redefine + reapply, not keep the old palette.
	await pickTheme(page, "darcula");
	await expect(editor).toHaveCSS("background-color", "rgb(43, 43, 43)");
	await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);

	await pickTheme(page, "gruvbox");
	await expect(editor).toHaveCSS("background-color", "rgb(29, 32, 33)");
	await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);

	// Back to Dark — also restores the suite's default state for the other specs.
	await pickTheme(page, "dark");
	await expect(editor).toHaveCSS("background-color", "rgb(23, 23, 25)");
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
});
