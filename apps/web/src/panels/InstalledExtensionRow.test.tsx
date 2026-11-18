import { expect, test } from "bun:test";
import type { ExtensionCatalogEntry } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	extensionSourceKind,
	InstalledExtensionRow,
	type InstalledExtensionRowProps,
} from "./InstalledExtensionRow";
import { nextDisabledExtensions } from "./useInstalledExtensions";

const PALETTE: ExtensionCatalogEntry = {
	name: "@thinkrail/example-extension-palette",
	title: "Palette",
	description: "Colour palettes in chat.",
	enabled: true,
	tools: ["color_palette"],
	hasChildExtensions: false,
	settings: [
		{ key: "contrast", default: true, title: "Contrast ratings", description: "Add WCAG ratings." },
	],
	kind: "installed",
	source: "/Users/me/palette",
	version: "0.0.0",
	state: "loaded",
	api: "1.0",
	web: { url: "/extensions/p/0.0.0-abc/dist/web.js" },
};

const { web: _web, ...WITHOUT_WEB } = PALETTE;

function render(overrides: Partial<InstalledExtensionRowProps> = {}): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ul>
				<InstalledExtensionRow
					entry={PALETTE}
					enabled
					settings={undefined}
					settingsSupported
					webLoad={undefined}
					updateAvailable={false}
					busy={false}
					error={undefined}
					onAction={() => {}}
					{...overrides}
				/>
			</ul>
		</TooltipProvider>,
	);
}

test("a loaded extension shows its kind, source, tools, chat cards, switch and own setting copy", () => {
	const markup = render();
	expect(markup).toContain("Palette");
	expect(markup).toContain("ThinkRail extension");
	expect(markup).toContain('data-testid="installed-extension-tool-color_palette"');
	expect(markup).toContain('data-testid="installed-extension-cards"');
	expect(markup).toContain("Chat cards");
	expect(markup).toContain("/Users/me/palette");
	expect(markup).toContain("0.0.0 installed");
	expect(markup).toContain(`data-testid="extension-toggle-${PALETTE.name}" data-active="true"`);
	expect(markup).toContain("Contrast ratings");
	expect(markup).toContain("Add WCAG ratings.");
	expect(markup).not.toContain("installed-extension-update-available");
});

test("switched off, the row keeps its cards mark and its settings are disabled", () => {
	const markup = render({ enabled: false, settings: { contrast: false } });
	expect(markup).toContain(`data-testid="extension-toggle-${PALETTE.name}" data-active="false"`);
	expect(markup).toMatch(
		/data-testid="extension-setting-toggle-@thinkrail\/example-extension-palette-contrast" data-active="false"[^>]*disabled/,
	);
	expect(markup).toContain('data-testid="installed-extension-cards"');
});

test("a failed extension shows the host's error verbatim and no switch, tools or settings", () => {
	const markup = render({
		entry: { ...WITHOUT_WEB, state: "failed", error: "SyntaxError: Unexpected token ')'" },
	});
	expect(markup).toContain('data-testid="installed-extension-failed-tag"');
	expect(markup).toContain("SyntaxError: Unexpected token &#x27;)&#x27;");
	expect(markup).not.toContain("Failed to load: SyntaxError");
	expect(markup).not.toContain('role="switch"');
	expect(markup).not.toContain("installed-extension-tool-");
});

test("an incompatible extension says which side is out of date, with the reason and a hint", () => {
	const newer = render({
		entry: {
			...PALETTE,
			state: "incompatible",
			api: "2.0",
			error: "built for extension API 2.0; this ThinkRail supports 1.0",
		},
	});
	expect(newer).toContain("Needs a newer ThinkRail");
	expect(newer).toContain("built for extension API 2.0; this ThinkRail supports 1.0");
	expect(newer).toContain("Update ThinkRail to use it.");
	expect(newer).not.toContain('role="switch"');
	const older = render({ entry: { ...PALETTE, state: "incompatible", api: "0.3" } });
	expect(older).toContain("Built for an older ThinkRail");
	expect(older).toContain("extension API 1.0");
});

test("a web half that failed in this window says the tools still work", () => {
	const markup = render({
		webLoad: { name: PALETTE.name, status: "failed", reason: "import", message: "boom" },
	});
	expect(markup).toContain('data-testid="installed-extension-web-failed"');
	expect(markup).toContain("boom");
	expect(markup).toContain("Its tools still work");
	expect(markup).toContain('role="switch"');
});

test("update available, busy and an inline action error render on the row", () => {
	const markup = render({ updateAvailable: true, busy: true, error: "Couldn't update Palette" });
	expect(markup).toContain('data-testid="installed-extension-update-available"');
	expect(markup).toContain('data-testid="installed-extension-action-error"');
	expect(markup).not.toMatch(/data-testid="extension-toggle-[^"]+"[^>]* disabled=""/);
});

test("the row is a list row: the menu opener is its primary, the switches and the menu are sides", () => {
	const markup = render();
	expect(markup).toContain(`data-focus-row="extension:${PALETTE.source}"`);
	expect(markup).toContain(`data-setting-id="installed-extension-${PALETTE.name}"`);
	expect(markup).toContain(`data-setting-id="extension-setting-${PALETTE.name}-contrast"`);
	expect(markup).toMatch(/data-focus-row-primary=""[^>]*aria-haspopup="menu"/);
	expect(markup).toMatch(
		/data-setting-side=""[^>]*role="switch"[^>]*data-testid="extension-toggle-/,
	);
	expect(markup).toMatch(
		/data-setting-side=""[^>]*role="switch"[^>]*data-testid="extension-setting-toggle-/,
	);
	expect(markup).toMatch(/data-setting-side=""[^>]*data-testid="installed-extension-menu"/);
	expect(markup).not.toContain("truncate");
	expect(markup).not.toContain(`title="${PALETTE.source}"`);
});

test("source tags and the disabled list follow the declaration", () => {
	expect(extensionSourceKind("npm:thinkrail-ext-weather")).toBe("npm");
	expect(extensionSourceKind("git:github.com/a/b")).toBe("git");
	expect(extensionSourceKind("https://github.com/a/b")).toBe("git");
	expect(extensionSourceKind("/Users/me/palette")).toBe("local");
	expect(nextDisabledExtensions(["a", "x"], "x", true)).toEqual(["a"]);
	expect(nextDisabledExtensions(["a"], "x", false)).toEqual(["a", "x"]);
});
