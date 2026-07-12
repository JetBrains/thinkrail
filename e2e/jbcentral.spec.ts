import { expect, test } from "@playwright/test";
import { openAppFresh } from "./fixtures/app";

// The in-app JetBrains AI (jbcentral proxy) connect flow, driven against a **stub `central`** on the host's
// PATH (see playwright.config `fakeBinDir`). This exercises the real host path — resolve the `central` binary,
// `proxy start --return-key`, write the models.json proxy override, refresh the registry — deterministically,
// with no real CLI / network / JetBrains auth. It's the regression guard for the class of bug where the CLI
// rename (jbcentral → central) or a flag change silently breaks connect: the stub is named `central`, so if
// the integration looked for the wrong binary, this fails at detection.

test("connects and disconnects JetBrains AI via the stub central CLI", async ({ page }) => {
	await openAppFresh(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings-providers")).toBeVisible();

	const card = page.getByTestId("jetbrains-ai-card");
	await expect(card).toBeVisible();
	// The stub `central` is on PATH → detected as installed (would fail if we looked for `jbcentral`).
	await expect(card).toHaveAttribute("data-installed", "true");

	// Normalize to a disconnected starting point (the isolated models.json copy could already be wired).
	if ((await card.getAttribute("data-wired")) === "true") {
		await page.getByTestId("jetbrains-disconnect").click();
		await expect(card).toHaveAttribute("data-wired", "false");
	}

	// Connect → host runs `central proxy start --return-key`, writes the proxy override into models.json,
	// refreshes the registry. `data-wired` is derived from a provider baseUrl matching the jbcentral shape,
	// so it flipping true proves the wire took effect end-to-end.
	await page.getByTestId("jetbrains-connect").click();
	await expect(card).toHaveAttribute("data-wired", "true");
	await expect(page.getByTestId("jetbrains-connected")).toBeVisible();
	// A wired provider now reports the JetBrains AI proxy source.
	await expect(
		page.getByTestId("provider-row").filter({ hasText: "JetBrains AI proxy" }).first(),
	).toBeVisible();

	// Disconnect → override removed, registry refreshed, back to the Connect affordance.
	await page.getByTestId("jetbrains-disconnect").click();
	await expect(card).toHaveAttribute("data-wired", "false");
	await expect(page.getByTestId("jetbrains-connect")).toBeVisible();
});
