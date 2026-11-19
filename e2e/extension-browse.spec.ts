import { expect, test } from "@playwright/test";
import { closeSettings, openAppFresh } from "./fixtures/app";
import {
	type CatalogListing,
	clearInstalledExtensions,
	declareExtensions,
	openExtensionsSettings,
	PALETTE_DIR,
	PALETTE_NAME,
	serveExtensionCatalog,
} from "./fixtures/installedExtensions";

const LISTINGS: CatalogListing[] = [
	{
		name: PALETTE_NAME,
		version: "0.1.0",
		title: "Palette",
		description: "Colour palettes from a base colour, shown as swatches.",
		author: "ThinkRail",
		api: "1.0",
		halves: ["server", "web"],
		repository: "https://github.com/JetBrains/thinkrail",
	},
	{
		name: "thinkrail-ext-jira",
		version: "2.0.0",
		title: "Jira",
		description: "Jira issues as agent tools.",
		author: "Sam Lee",
		api: "9.0",
		halves: ["server"],
	},
	{
		name: "thinkrail-ext-weather",
		version: "1.2.0",
		title: "Weather",
		description: "Forecasts in chat.",
		author: "Jane Doe",
		api: "1.0",
		halves: ["server", "web"],
		image: "https://thinkrail-e2e.invalid/preview.png",
		repository: "https://github.com/jane/thinkrail-ext-weather",
	},
];

test.afterEach(async ({ page }) => {
	if (page.isClosed() || !page.url().startsWith("http")) return;
	try {
		await serveExtensionCatalog(page, null);
		await clearInstalledExtensions(page);
	} finally {
		await closeSettings(page);
	}
});

function card(page: import("@playwright/test").Page, name: string) {
	return page.locator(`[data-testid="extension-browse-card"][data-name="${name}"]`);
}

test("Browse lists the catalog with search, installed and incompatible marks, installs from its confirm step and never contacts another origin", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const requested: string[] = [];
	page.on("request", (request) => {
		if (/^https?:/.test(request.url())) requested.push(request.url());
	});
	await openAppFresh(page);
	await serveExtensionCatalog(page, LISTINGS);
	await declareExtensions(page, [PALETTE_DIR]);
	const section = await openExtensionsSettings(page);
	const browse = section.getByTestId("settings-extension-browse");
	await expect(browse.getByTestId("extension-browse-trust")).toContainText(
		"Listings are automatic and unreviewed",
	);
	await expect(browse.getByTestId("extension-browse-card")).toHaveCount(3);

	const weather = card(page, "thinkrail-ext-weather");
	await expect(weather).toContainText("Weather");
	await expect(weather).toContainText("thinkrail-ext-weather · Jane Doe");
	await expect(weather).toContainText("1.2.0");
	await expect(weather).toContainText("Forecasts in chat.");
	await expect(weather.getByTestId("extension-browse-tools")).toHaveText("Agent tools");
	await expect(weather.getByTestId("extension-browse-cards")).toHaveText("Chat cards");
	await expect(weather.getByTestId("extension-browse-npm")).toHaveAttribute(
		"href",
		"https://www.npmjs.com/package/thinkrail-ext-weather",
	);
	await expect(weather.getByTestId("extension-browse-repository")).toHaveAttribute(
		"href",
		"https://github.com/jane/thinkrail-ext-weather",
	);
	for (const listing of await browse.getByTestId("extension-browse-card").all()) {
		await listing.scrollIntoViewIfNeeded();
	}
	await expect(browse.locator("img")).toHaveCount(0);

	await expect(card(page, PALETTE_NAME).getByTestId("extension-browse-installed")).toBeVisible();
	await expect(card(page, PALETTE_NAME).getByTestId("extension-browse-install")).toHaveCount(0);
	const jira = card(page, "thinkrail-ext-jira");
	await expect(jira.getByTestId("extension-browse-incompatible")).toHaveText(
		"Needs a newer ThinkRail",
	);
	await expect(jira.getByTestId("extension-browse-install")).toHaveCount(0);

	const search = browse.getByTestId("extension-browse-search");
	await search.fill("forecast");
	await expect(browse.getByTestId("extension-browse-card")).toHaveCount(1);
	await expect(card(page, "thinkrail-ext-weather")).toBeVisible();
	await search.fill("no-such-extension");
	await expect(browse.getByTestId("extension-browse-no-match")).toBeVisible();
	await search.fill("");
	await expect(browse.getByTestId("extension-browse-card")).toHaveCount(3);
	await search.focus();
	await page.keyboard.press("ArrowDown");
	await expect(
		browse.getByTestId("extension-browse-card").first().locator("[data-focus-row-primary]"),
	).toBeFocused();
	await search.fill("zzz");
	await search.press("Escape");
	await expect(search).toHaveValue("");

	await weather.getByTestId("extension-browse-install").click();
	const dialog = page.getByTestId("install-package-dialog");
	await expect(dialog.getByTestId("install-package-body")).toHaveAttribute("data-step", "confirm");
	await expect(dialog).toContainText("Install Weather?");
	await expect(dialog.getByTestId("install-package-confirm-source")).toHaveText(
		"npm:thinkrail-ext-weather",
	);
	await expect(dialog).toContainText("runs code on this machine and in the app");
	await expect(dialog.getByTestId("install-package-scope")).toHaveCount(0);
	await dialog.getByTestId("install-package-confirm").click();
	await expect(dialog.getByTestId("install-package-body")).toHaveAttribute("data-step", "failed", {
		timeout: 60_000,
	});
	await expect(dialog.getByTestId("install-package-error")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	const hostOrigin = new URL(page.url()).origin;
	expect(requested.filter((url) => new URL(url).origin !== hostOrigin)).toEqual([]);
});

test("Browse says when the catalog is unreachable, keeps the Installed list working and recovers on Retry", async ({
	page,
}) => {
	test.setTimeout(90_000);
	await openAppFresh(page);
	await serveExtensionCatalog(page, null);
	await declareExtensions(page, [PALETTE_DIR]);
	const section = await openExtensionsSettings(page);
	const browse = section.getByTestId("settings-extension-browse");
	await expect(browse.getByTestId("extension-browse-failed")).toContainText(
		"Can't reach the extension catalog.",
	);
	await expect(browse.getByTestId("extension-browse-failed")).toContainText(
		"Your installed extensions keep working.",
	);
	await expect(
		section.locator(`[data-testid="installed-extension-row"][data-name="${PALETTE_NAME}"]`),
	).toHaveAttribute("data-state", "loaded");
	await expect(section.getByTestId("settings-packages")).toBeVisible();

	await serveExtensionCatalog(page, []);
	await browse.getByTestId("extension-browse-retry").click();
	await expect(browse.getByTestId("extension-browse-empty")).toBeVisible();
	await expect(browse.getByTestId("extension-browse-guide")).toHaveAttribute(
		"href",
		"https://thinkrail.ai/docs/build-an-extension/",
	);
});
