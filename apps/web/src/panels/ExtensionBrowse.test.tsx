import { expect, test } from "bun:test";
import type { ExtensionBrowseEntry } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AUTHORING_GUIDE_URL,
	ExtensionBrowse,
	type ExtensionBrowseRead,
	matchesBrowseQuery,
} from "./ExtensionBrowse";

const WEATHER: ExtensionBrowseEntry = {
	name: "thinkrail-ext-weather",
	version: "1.2.0",
	title: "Weather",
	description: "Forecasts in chat.",
	author: "Jane Doe",
	api: "1.0",
	halves: ["server", "web"],
	image: "https://example.com/preview.png",
	install: "npm:thinkrail-ext-weather",
	npm: "https://www.npmjs.com/package/thinkrail-ext-weather",
	repository: "https://github.com/jane/thinkrail-ext-weather",
	publishedAt: "2026-11-10T09:30:00.000Z",
	installed: false,
};
const CARDS: ExtensionBrowseEntry = {
	name: "@acme/thinkrail-review-cards",
	version: "0.3.1",
	description: "Review cards for diffs.",
	api: "1.0",
	halves: ["web"],
	install: "npm:@acme/thinkrail-review-cards",
	npm: "https://www.npmjs.com/package/@acme/thinkrail-review-cards",
	publishedAt: "2026-11-12T16:05:12.345Z",
	installed: true,
};
const JIRA: ExtensionBrowseEntry = {
	...WEATHER,
	name: "thinkrail-ext-jira",
	title: "Jira",
	api: "2.0",
	halves: ["server"],
	install: "npm:thinkrail-ext-jira",
};

function render(read: ExtensionBrowseRead, query = "") {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ExtensionBrowse
				read={read}
				query={query}
				onQueryChange={() => {}}
				onRetry={() => {}}
				onInstall={() => {}}
			/>
		</TooltipProvider>,
	);
}

const loaded = (extensions: ExtensionBrowseEntry[]): ExtensionBrowseRead => ({
	status: "loaded",
	result: { generatedAt: "2026-11-17T12:00:00.000Z", extensions },
});

test("a card shows its copy, halves, links, a lazy no-referrer image and the right action", () => {
	const markup = render(loaded([WEATHER, CARDS, JIRA]));
	expect(markup).toContain("Listings are automatic and unreviewed");
	expect(markup).toContain("runs code on this machine and in the app");
	expect(markup).toContain("Weather");
	expect(markup).toContain("thinkrail-ext-weather · Jane Doe");
	expect(markup).toContain("Forecasts in chat.");
	expect(markup).toContain('data-testid="extension-browse-tools"');
	expect(markup).toContain('data-testid="extension-browse-cards"');
	expect(markup).toContain('href="https://www.npmjs.com/package/thinkrail-ext-weather"');
	expect(markup).toContain('href="https://github.com/jane/thinkrail-ext-weather"');
	expect(markup).toMatch(
		/<img[^>]*loading="lazy"[^>]*referrerPolicy="no-referrer"|<img[^>]*referrerpolicy="no-referrer"[^>]*/i,
	);
	expect(markup).toContain("aspect-video");
	expect(markup.match(/data-testid="extension-browse-install"/g)).toHaveLength(1);
	expect(markup).toContain('data-testid="extension-browse-installed"');
	expect(markup).toContain('data-testid="extension-browse-incompatible"');
	expect(markup).toContain("Needs a newer ThinkRail");
	expect(markup).toContain("Built for extension API 2.0, which this ThinkRail can&#x27;t load.");
});

test("listings are one keyboard list after the search field, said in visible text", () => {
	const markup = render(loaded([WEATHER, CARDS, JIRA]));
	expect(markup).toContain('data-setting-id="extension-browse"');
	expect(markup).toMatch(
		/data-setting-row="extension-browse-search"[^>]*>[\s\S]*data-setting-stop=""/,
	);
	expect(markup).toContain('data-focus-list="extension-browse"');
	expect(markup).toContain(`data-focus-row="${WEATHER.name}"`);
	expect(markup).toMatch(/data-focus-row-primary=""[^>]*aria-haspopup="dialog"/);
	expect(markup).toMatch(
		/aria-disabled="true"[^>]*data-focus-row-primary=""|data-focus-row-primary=""[^>]*aria-disabled="true"/,
	);
	expect(markup).toMatch(/data-setting-side=""[^>]*data-testid="extension-browse-install"/);
	expect(markup).toMatch(/data-setting-side=""[^>]*data-testid="extension-browse-npm"/);
	expect(markup).not.toContain("truncate");
	expect(markup).not.toContain(" title=");
});

test("the search narrows by title, name, description or author and says when nothing matches", () => {
	expect(matchesBrowseQuery(WEATHER, "jane")).toBe(true);
	expect(matchesBrowseQuery(WEATHER, "FORECAST")).toBe(true);
	expect(matchesBrowseQuery(CARDS, "weather")).toBe(false);
	expect(matchesBrowseQuery(CARDS, "  ")).toBe(true);
	const none = render(loaded([WEATHER]), "zzz");
	expect(none).toContain('data-testid="extension-browse-no-match"');
	expect(none).toContain("zzz");
});

test("an empty catalog links to the authoring guide", () => {
	const markup = render(loaded([]));
	expect(markup).toContain('data-testid="extension-browse-empty"');
	expect(markup).toContain(`href="${AUTHORING_GUIDE_URL}"`);
	expect(markup).not.toContain("extension-browse-search");
});

test("an unreachable, offline or invalid catalog says so with a retry", () => {
	const unreachable = render({ status: "failed", code: "EXTENSION_CATALOG_UNREACHABLE" });
	expect(unreachable).toContain("Can&#x27;t reach the extension catalog.");
	expect(unreachable).toContain("Your installed extensions keep working.");
	expect(unreachable).toContain('data-testid="extension-browse-retry"');
	expect(render({ status: "failed", code: undefined })).toContain(
		"Can&#x27;t reach the extension catalog.",
	);
	expect(render({ status: "failed", code: "EXTENSION_CATALOG_OFFLINE" })).toContain("offline mode");
	expect(render({ status: "failed", code: "EXTENSION_CATALOG_INVALID" })).toContain(
		"couldn&#x27;t be read",
	);
	expect(render({ status: "loading" })).toContain('data-status="loading"');
});
