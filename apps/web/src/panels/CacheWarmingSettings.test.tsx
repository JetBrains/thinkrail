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
	pending = false,
	failed = false,
}: {
	protocolVersion?: number | null;
	setting?: CacheWarmingSetting | null;
	pending?: boolean;
	failed?: boolean;
} = {}) {
	return renderToStaticMarkup(
		<CacheWarmingControls
			protocolVersion={protocolVersion}
			setting={setting}
			pending={pending}
			failed={failed}
			onSelect={() => {}}
			onRetry={() => {}}
		/>,
	);
}

test("old and unknown hosts do not offer the cache-warming control", () => {
	expect(render({ protocolVersion: CACHE_WARMING_SETTINGS_PROTOCOL_VERSION - 1 })).toBe("");
	expect(render({ protocolVersion: null })).toBe("");
});

test("three modes are offered; ThinkRail's streaming default is checked and labelled as the default", () => {
	const html = render();
	expect(html.match(/type="radio"/g)).toHaveLength(3);
	expect(html).toMatch(/cache-warming-streaming[^>]*><input[^>]*checked=""/);
	expect(html).toContain("ThinkRail default");
	expect(html).toContain('data-cache-warming-source="default"');
	expect(html).toContain("pi&#x27;s default");
	expect(html).toContain("settings.json");
});

test("a user-chosen mode is checked without the default hint and the loading state disables every card", () => {
	const chosen = render({ setting: { mode: "idle", source: "user" } });
	expect(chosen).toMatch(/cache-warming-idle[^>]*><input[^>]*checked=""/);
	expect(chosen).not.toContain("ThinkRail default");
	expect(chosen).toContain('data-cache-warming-source="user"');

	const loading = render({ setting: null, pending: true });
	expect(loading.match(/type="radio"[^>]*disabled/g)).toHaveLength(3);
	expect(loading).toContain('data-cache-warming-source="loading"');
});

test("a failed load shows a retry instead of guessing a mode", () => {
	const html = render({ setting: null, failed: true });
	expect(html).not.toContain('type="radio"');
	expect(html).toContain('data-testid="cache-warming-retry"');
	expect(html).toContain("Couldn&#x27;t load pi&#x27;s cache-warming setting.");
});
