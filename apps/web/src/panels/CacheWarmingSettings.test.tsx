import { expect, test } from "bun:test";
import {
	CACHE_WARMING_SETTINGS_PROTOCOL_VERSION,
	type CacheWarmingSetting,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { CacheWarmingControls } from "./CacheWarmingSettings";

function render({
	protocolVersion = CACHE_WARMING_SETTINGS_PROTOCOL_VERSION,
	setting = { mode: "streaming", source: "default" },
	failed = false,
}: {
	protocolVersion?: number | null;
	setting?: CacheWarmingSetting | null;
	failed?: boolean;
} = {}) {
	return renderToStaticMarkup(
		<CacheWarmingControls
			protocolVersion={protocolVersion}
			setting={setting}
			failed={failed}
			onSelect={() => {}}
			onRetry={() => {}}
		/>,
	);
}

function option(html: string, mode: string): string {
	return html.match(new RegExp(`<button[^>]*data-testid="cache-warming-${mode}"[^>]*>`))?.[0] ?? "";
}

test("old and unknown hosts do not offer the cache-warming control", () => {
	expect(render({ protocolVersion: CACHE_WARMING_SETTINGS_PROTOCOL_VERSION - 1 })).toBe("");
	expect(render({ protocolVersion: null })).toBe("");
});

test("three cheap segments; ThinkRail's streaming default is selected and labelled as the default", () => {
	const html = render();
	expect(html.match(/role="option"/g)).toHaveLength(3);
	expect(html).toContain('data-layout="segmented"');
	expect(html).toContain('data-cost="cheap"');
	expect(option(html, "streaming")).toContain('aria-selected="true"');
	expect(option(html, "off")).toContain('aria-selected="false"');
	expect(html).toContain('data-setting-id="prompt-cache"');
	expect(html).toContain("Keep the prompt cache warm");
	expect(html).toContain("Nothing is sent after the run ends.");
	expect(html).toContain("ThinkRail default");
	expect(html).toContain('data-cache-warming-source="default"');
	expect(html).toContain("settings.json");
	expect(html).not.toContain("data-setting-changed");
	expect(html).not.toContain("data-setting-reset");
});

test("a mode other than the default is Changed with a Reset; the default chosen by the user is not", () => {
	const chosen = render({ setting: { mode: "idle", source: "user" } });
	expect(option(chosen, "idle")).toContain('aria-selected="true"');
	expect(chosen).toContain("pi&#x27;s default");
	expect(chosen).not.toContain("ThinkRail default");
	expect(chosen).toContain('data-cache-warming-source="user"');
	expect(chosen).toContain("data-setting-changed");
	expect(chosen).toContain('data-testid="settings-reset-prompt-cache"');

	const streaming = render({ setting: { mode: "streaming", source: "user" } });
	expect(streaming).not.toContain("data-setting-changed");
	expect(streaming).not.toContain("ThinkRail default");
});

test("while the mode loads every segment is disabled and nothing is selected", () => {
	const loading = render({ setting: null });
	expect(loading.match(/<button[^>]*role="option"[^>]*disabled=""/g)).toHaveLength(3);
	expect(loading).not.toContain('aria-selected="true"');
	expect(loading).toContain('data-cache-warming-source="loading"');
});

test("a failed load shows a retry instead of guessing a mode", () => {
	const html = render({ setting: null, failed: true });
	expect(html).not.toContain('role="option"');
	expect(html).toMatch(/<button[^>]*tabindex="0"[^>]*data-testid="cache-warming-retry"/);
	expect(html).toContain("Couldn&#x27;t load pi&#x27;s cache-warming setting.");
});
