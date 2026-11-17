import { cpSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import { E2E_DATA_DIR, E2E_EXTENSION_CATALOG, E2E_EXTENSION_FIXTURES_DIR } from "./paths";
import { E2eWire } from "./wire";

export const PALETTE_NAME = "@thinkrail/example-extension-palette";
/** The published sample, built by `bun run build:extension-fixtures` before the suite starts. */
export const PALETTE_DIR = realpathSync(
	fileURLToPath(new URL("../../extension-examples/palette", import.meta.url)),
);

/** `#3b82f6` triadic with contrast ratings — the sample tool's own output (SDK slice report). */
export const PALETTE_DETAILS = {
	base: "#3b82f6",
	harmony: "triadic",
	colors: [
		{ hex: "#3b82f6", role: "base", contrast: { text: "black", ratio: 5.71, rating: "AA" } },
		{ hex: "#f63b82", role: "triad +120°", contrast: { text: "black", ratio: 5.87, rating: "AA" } },
		{
			hex: "#82f63b",
			role: "triad +240°",
			contrast: { text: "black", ratio: 15.19, rating: "AAA" },
		},
		{
			hex: "#fa9dc0",
			role: "triad +120° tint",
			contrast: { text: "black", ratio: 10.65, rating: "AAA" },
		},
		{
			hex: "#c0fa9d",
			role: "triad +240° tint",
			contrast: { text: "black", ratio: 17.4, rating: "AAA" },
		},
	],
	contrastChecked: true,
};
export const PALETTE_HEXES = PALETTE_DETAILS.colors.map((color) => color.hex);
export const PALETTE_RATINGS = PALETTE_DETAILS.colors.map((color) => color.contrast.rating);

const DECLARATIONS = join(E2E_DATA_DIR, "extensions.json");
const FIXTURES = fileURLToPath(new URL("./extensions/", import.meta.url));

export type ExtensionFixture = "incompatible" | "broken-server" | "throwing-card";

/** A fresh copy of a fixture extension folder under the lane's disposable data dir. */
export function stageExtensionFixture(fixture: ExtensionFixture): string {
	const target = join(E2E_EXTENSION_FIXTURES_DIR, `${fixture}-${Date.now().toString(36)}`);
	mkdirSync(E2E_EXTENSION_FIXTURES_DIR, { recursive: true });
	cpSync(join(FIXTURES, fixture), target, { recursive: true });
	return realpathSync(target);
}

export async function withWire<T>(page: Page, run: (wire: E2eWire) => Promise<T>): Promise<T> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
}

async function installedEntries(wire: E2eWire): Promise<ExtensionCatalogEntry[]> {
	return (await wire.request("extension.list", {})).filter((entry) => entry.kind === "installed");
}

/** Declares folder sources the way the agent skill does — by writing `extensions.json` — and waits for the reconcile. */
export async function declareExtensions(
	page: Page,
	sources: readonly string[],
): Promise<ExtensionCatalogEntry[]> {
	writeFileSync(DECLARATIONS, `${JSON.stringify({ extensions: sources }, null, 2)}\n`);
	return withWire(page, async (wire) => {
		let entries: ExtensionCatalogEntry[] = [];
		await expect
			.poll(
				async () => {
					entries = await installedEntries(wire);
					return sources.every((source) =>
						entries.some((entry) => entry.source === source && entry.state !== undefined),
					);
				},
				{ timeout: 60_000 },
			)
			.toBe(true);
		return entries;
	});
}

/** Back to no installed extensions, with the switch and settings of every name a test may have touched cleared. */
export async function clearInstalledExtensions(page: Page): Promise<void> {
	writeFileSync(DECLARATIONS, `${JSON.stringify({ extensions: [] }, null, 2)}\n`);
	await withWire(page, async (wire) => {
		await expect
			.poll(async () => (await installedEntries(wire)).length, { timeout: 60_000 })
			.toBe(0);
		await wire.request("settings.update", {
			config: { disabledExtensions: [], extensionSettings: { [PALETTE_NAME]: { contrast: true } } },
		});
	});
	rmSync(E2E_EXTENSION_FIXTURES_DIR, { recursive: true, force: true });
}

export interface CatalogListing {
	name: string;
	version: string;
	title?: string;
	description: string;
	author?: string;
	api: string;
	halves: ("server" | "web")[];
	image?: string;
	repository?: string;
}

/** Writes the lane's catalog file (or removes it — an unreachable catalog) and refreshes the host's cached copy. */
export async function serveExtensionCatalog(
	page: Page,
	listings: readonly CatalogListing[] | null,
): Promise<void> {
	if (listings === null) {
		rmSync(E2E_EXTENSION_CATALOG, { force: true });
	} else {
		const catalog = {
			schema: 1,
			generatedAt: "2026-11-17T12:00:00.000Z",
			extensions: listings.map((listing) => ({
				...listing,
				install: `npm:${listing.name}`,
				npm: `https://www.npmjs.com/package/${listing.name}`,
				publishedAt: "2026-11-10T09:30:00.000Z",
			})),
		};
		writeFileSync(E2E_EXTENSION_CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
	}
	await withWire(page, (wire) =>
		wire.request("extensions.browse", { force: true }).then(
			() => undefined,
			() => undefined,
		),
	);
}

export async function openExtensionsSettings(page: Page) {
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-extensions").click();
	const section = page.getByTestId("settings-extensions");
	await expect(section).toBeVisible();
	return section;
}

export async function closeSettings(page: Page): Promise<void> {
	const dialog = page.getByTestId("settings-dialog");
	for (let attempt = 0; attempt < 3 && (await dialog.isVisible()); attempt += 1) {
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden({ timeout: 2_000 }).catch(() => {});
	}
	await expect(dialog).toBeHidden();
}

export function installedRow(page: Page, name: string) {
	return page.locator(`[data-testid="installed-extension-row"][data-name="${name}"]`);
}
