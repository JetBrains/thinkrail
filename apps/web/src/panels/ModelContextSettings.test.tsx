import { expect, test } from "bun:test";
import {
	CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION,
	CUSTOM_MODEL_CONTEXT_WINDOW_LIMITS,
	MODEL_CONTEXT_WINDOW_LIMITS,
	type ModelContextSetting,
} from "@thinkrail/contracts";
import { localKeys } from "@thinkrail/ui/local-keys";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";
import {
	dom,
	type FakeNode,
	headlessReact,
	parseMarkup,
	press,
	resetDom,
} from "../settingsKit/settingsFakeDom.test";
import { settingsKeyDown } from "../settingsKit/useSettingsKeyboard";
import type { CustomEndpointsState } from "./CustomEndpointsSettings";
import {
	contextPreset,
	customServerIds,
	ModelContextControls,
	modelContextLimitsFor,
	modelContextRows,
	useContextLimit,
} from "./ModelContextSettings";

const setting: ModelContextSetting = {
	provider: "openai",
	id: "gpt-5.5",
	name: "GPT-5.5",
	contextWindow: 272_000,
	override: null,
};

function render({
	protocolVersion = CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	settings = [setting],
	customServers = new Set(),
	pending = false,
	failed = false,
	expanded = [],
}: {
	protocolVersion?: number | null;
	settings?: ModelContextSetting[] | null;
	customServers?: ReadonlySet<string> | null;
	pending?: boolean;
	failed?: boolean;
	expanded?: string[];
} = {}) {
	return renderToStaticMarkup(
		<ModelContextControls
			protocolVersion={protocolVersion}
			settings={settings}
			customServers={customServers}
			pending={pending}
			failed={failed}
			defaultExpanded={expanded}
			onChange={() => {}}
			onRetry={() => {}}
		/>,
	);
}

function tag(html: string, testId: string): string {
	return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

function selected(html: string, testId: string): boolean {
	return tag(html, testId).includes('aria-selected="true"');
}

const options = (html: string) => html.match(/role="option"/g)?.length ?? 0;

const walkKeys = localKeys(null, "settings", LOCAL_KEY_DEFAULTS.settings);

function walkFrom(html: string, testId: string, key: string) {
	const root = parseMarkup(html);
	const target = root.querySelector(`[data-testid="${testId}"]`);
	if (!target) throw new Error(`no ${testId}`);
	resetDom();
	const handled = settingsKeyDown(
		{ defaultPrevented: false, nativeEvent: press(key) },
		root,
		target,
		walkKeys,
		{ toNav: () => {} },
	);
	const focused: FakeNode | null = dom.focused;
	return { handled, landed: focused?.getAttribute("data-testid") ?? null };
}

test("old and unknown hosts do not offer context controls", () => {
	expect(render({ protocolVersion: CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION - 1 })).toBe("");
	expect(render({ protocolVersion: null })).toBe("");
});

test("one cheap Default/1M/Custom choice for every GPT model, with the per-model tree collapsed", () => {
	const html = render();
	expect(options(html)).toBe(3);
	expect(html).toContain('data-cost="cheap"');
	expect(html).toContain('data-setting-row="context-window"');
	expect(html).toContain("All GPT models");
	expect(selected(html, "context-limit-all-default")).toBe(true);
	expect(html).toContain('role="tree"');
	expect(tag(html, "model-context-provider")).toContain('aria-expanded="false"');
	expect(html).not.toContain('data-testid="context-limit-openai-gpt-5.5"');
	expect(html).toContain("pi CLI");
	expect(html).toContain("host restart");
	expect(html).not.toContain("data-setting-reset");
});

test("a pending save keeps the authoritative 1M override and the choice stays operable", () => {
	const html = render({ settings: [{ ...setting, override: 1_000_000 }], pending: true });
	expect(html).toContain('data-context-override="1000000"');
	expect(selected(html, "context-limit-all-1m")).toBe(true);
	expect(html).not.toMatch(/<button[^>]*role="option"[^>]*disabled=""/);
	expect(html).toContain('data-testid="settings-reset-context-window"');
});

test("non-preset overrides expose an editable Custom field that saves next to the choice, in the same row", () => {
	const html = render({ settings: [{ ...setting, override: 500_000, contextWindow: 500_000 }] });
	const input = tag(html, "context-limit-all-input");
	expect(selected(html, "context-limit-all-custom")).toBe(true);
	expect(input).toContain('value="500000"');
	expect(input).toContain('inputMode="numeric"');
	expect(input).toContain("data-setting-clean");
	expect(input).toContain('tabindex="0"');
	expect(input).toContain('aria-invalid="false"');
	expect(html).not.toContain("undefined");
	expect(walkFrom(html, "context-limit-all-custom", "ArrowRight")).toEqual({
		handled: true,
		landed: "context-limit-all-input",
	});
	expect(walkFrom(html, "context-limit-all-input", "ArrowLeft").handled).toBe(false);
});

test("inside an expanded model's choice, → past Custom reaches its field, and → on the model reaches its Reset", () => {
	const html = render({
		settings: [{ ...setting, override: 500_000, contextWindow: 500_000 }],
		expanded: ["openai"],
	});
	expect(walkFrom(html, "context-limit-openai-gpt-5.5-custom", "ArrowRight").landed).toBe(
		"context-limit-openai-gpt-5.5-input",
	);
	expect(walkFrom(html, "context-limit-openai-gpt-5.5", "ArrowRight").landed).toBe(
		"context-limit-openai-gpt-5.5-reset",
	);
});

test("different overrides show Customized instead of claiming a uniform preset", () => {
	const html = render({
		settings: [
			setting,
			{ ...setting, provider: "context-proxy", override: 750_000, contextWindow: 750_000 },
		],
	});
	expect(html).toContain("Customized by model");
	expect(html).toContain('data-context-override="mixed"');
	expect(html).not.toContain('aria-selected="true"');
	expect(html).toContain('data-testid="settings-reset-context-window"');
	expect(html).not.toContain("undefined");
});

test("the per-model tree groups models by provider, and an expanded model holds its own choice and Reset", () => {
	const html = render({
		settings: [
			setting,
			{ ...setting, id: "gpt-5", name: "GPT-5", override: 1_000_000, contextWindow: 1_000_000 },
			{ ...setting, provider: "openai-codex" },
		],
		expanded: ["openai"],
	});
	const providers = html.match(/<div[^>]*data-testid="model-context-provider"[^>]*>/g) ?? [];
	expect(providers).toHaveLength(2);
	expect(providers[0]).toContain('data-provider="openai"');
	expect(providers[0]).toContain('aria-expanded="true"');
	expect(providers[0]).toContain('aria-level="1"');
	expect(providers[1]).toContain('aria-expanded="false"');
	expect(html).toContain("1 of 2 customized");
	expect(html).toContain("All Default");
	const model = tag(html, "context-limit-openai-gpt-5.5");
	expect(model).toContain('role="treeitem"');
	expect(model).toContain('aria-level="2"');
	expect(model).toContain('data-context-override="null"');
	expect(model).toMatch(/tabindex="-?\d"/);
	expect(selected(html, "context-limit-openai-gpt-5.5-default")).toBe(true);
	expect(selected(html, "context-limit-openai-gpt-5-1m")).toBe(true);
	expect(html).toContain('aria-label="Context window for GPT-5 (openai)"');
	const reset = tag(html, "context-limit-openai-gpt-5-reset");
	expect(reset).toContain("data-setting-reset");
	expect(reset).toMatch(/tabindex="-?\d"/);
	expect(html).not.toContain('data-testid="context-limit-openai-codex-gpt-5.5"');
	expect(options(html)).toBe(9);
});

test("a preset names the override, a value outside the presets is Custom, and a mixed group has none", () => {
	expect(contextPreset(null)).toBe("default");
	expect(contextPreset(1_000_000)).toBe("1m");
	expect(contextPreset(600_000)).toBe("custom");
	expect(contextPreset(undefined)).toBeNull();
});

test("the shared control summarizes only rows it governs and names the external ones it leaves alone", () => {
	const html = render({
		settings: [
			{ ...setting, override: 1_000_000, contextWindow: 1_000_000 },
			{ ...setting, provider: "openai-codex", override: 1_050_000, contextWindow: 1_050_000 },
		],
	});
	expect(selected(html, "context-limit-all-1m")).toBe(true);
	expect(html).toContain(
		"1 available model \u00b7 1 kept at a limit set outside the 272,000\u20131,000,000 range",
	);
	expect(
		render({ settings: [{ ...setting, override: 1_050_000, contextWindow: 1_050_000 }] }),
	).not.toContain('data-testid="context-limit-all"');
});

test("failed reads replace stale controls with an actionable retry", () => {
	const html = render({ failed: true });
	expect(options(html)).toBe(0);
	expect(html).toContain('role="alert"');
	expect(html).toMatch(/<button[^>]*tabindex="0"[^>]*>.*Retry/);
});

test("empty and loading states do not invent eligible models", () => {
	expect(options(render({ settings: [] }))).toBe(0);
	expect(render({ settings: [] })).toContain("No eligible models");
	expect(options(render({ settings: null, pending: true }))).toBe(0);
});

test("custom server rows belong to their server's dialog, not the GPT block", () => {
	const custom: ModelContextSetting = {
		provider: "custom-gw",
		id: "relay",
		name: "relay",
		contextWindow: 8_192,
		override: 8_192,
	};
	const customServers = new Set(["custom-gw"]);
	const html = render({ settings: [setting, custom], customServers });
	expect(html).toContain("1 available model");
	expect(html).not.toContain("kept at a limit");
	expect(html).not.toContain("custom-gw");
	expect(render({ settings: [custom], customServers })).toContain("No eligible models");
});

test("a hand-written custom-* provider the Custom servers dialog cannot show keeps a targeted row", () => {
	const responses: ModelContextSetting = {
		provider: "custom-responses",
		id: "gpt-5.5",
		name: "GPT-5.5",
		contextWindow: 272_000,
		override: null,
	};
	const customServers = new Set(["custom-gw"]);
	expect(modelContextRows([setting, responses], customServers)).toEqual([setting, responses]);
	const html = render({ settings: [setting, responses], customServers });
	expect(html).toContain("1 available model");
	expect(html).not.toContain("kept at a limit");
	const alone = render({ settings: [responses], customServers });
	expect(alone).not.toContain("No eligible models");
	expect(alone).not.toContain('data-testid="context-limit-all"');
	expect(alone).toContain('data-testid="model-context-provider"');
	expect(alone).toContain('data-provider="custom-responses"');
});

test("custom server rows wait for the server list instead of flashing in and out", () => {
	const loading: CustomEndpointsState = {
		endpoints: null,
		failed: false,
		load: () => Promise.resolve(),
		replace: () => {},
	};
	expect(customServerIds(loading)).toBeNull();
	expect(modelContextRows([setting], null)).toBeNull();
	expect(options(render({ customServers: null }))).toBe(0);
	expect(customServerIds({ ...loading, failed: true })).toEqual(new Set());
	expect(customServerIds(null)).toEqual(new Set());
	expect(
		customServerIds({
			...loading,
			failed: true,
			endpoints: [
				{ id: "custom-gw", name: "Gateway", baseUrl: "http://gw", hasApiKey: false, models: [] },
			],
		}),
	).toEqual(new Set(["custom-gw"]));
});

test("a custom provider gets the wider range only from a host that accepts it", () => {
	expect(modelContextLimitsFor("custom-responses", CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION)).toEqual(
		CUSTOM_MODEL_CONTEXT_WINDOW_LIMITS,
	);
	expect(
		modelContextLimitsFor("custom-responses", CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION - 1),
	).toEqual(MODEL_CONTEXT_WINDOW_LIMITS);
	expect(modelContextLimitsFor("openai", CUSTOM_MODEL_CONTEXT_PROTOCOL_VERSION)).toEqual(
		MODEL_CONTEXT_WINDOW_LIMITS,
	);
});

const react = headlessReact();

async function mountLimit(saved: number | null) {
	const sent: (number | null)[] = [];
	let limit: ReturnType<typeof useContextLimit> | null = null;
	function Probe({ override }: { override: number | null }) {
		limit = useContextLimit(override, String(override), (next) => sent.push(next));
		return null;
	}
	const current = () => {
		if (!limit) throw new Error("not rendered");
		return limit;
	};
	const render = react.mount();
	await render(<Probe override={saved} />);
	return {
		sent,
		value: () => current().value,
		latest: () => current().latest,
		select: (id: "default" | "1m" | "custom") => act(async () => current().select(id)),
		save: (next: number) => act(async () => current().save(next)),
		reset: () => act(async () => current().reset()),
		host: (override: number | null) => render(<Probe override={override} />),
	};
}

test("Custom picked before the 1M save answers survives that reply; a change from elsewhere drops it", async () => {
	const limit = await mountLimit(null);
	await limit.select("1m");
	await limit.select("custom");
	expect(limit.value()).toBe("custom");
	await limit.host(1_000_000);
	expect(limit.value()).toBe("custom");
	expect(limit.sent).toEqual([1_000_000]);
	await limit.host(null);
	expect(limit.value()).toBe("default");

	const peer = await mountLimit(null);
	await peer.select("custom");
	await peer.host(1_000_000);
	expect(peer.value()).toBe("1m");
});

test("a later pick is compared with the latest requested value, so it is still sent and outlives the earlier reply", async () => {
	const limit = await mountLimit(null);
	await limit.select("1m");
	await limit.select("default");
	expect(limit.sent).toEqual([1_000_000, null]);
	expect(limit.latest()).toBeNull();
	await limit.host(1_000_000);
	expect(limit.value()).toBe("1m");
	await limit.host(null);
	expect(limit.value()).toBe("default");
	await limit.select("default");
	expect(limit.sent).toEqual([1_000_000, null]);

	const chain = await mountLimit(null);
	await chain.select("1m");
	await chain.select("default");
	await chain.select("custom");
	await chain.host(1_000_000);
	await chain.host(null);
	expect(chain.value()).toBe("custom");
});

test("the Custom field's save and Reset are requested values too; a saved number's reply shows what it is", async () => {
	const limit = await mountLimit(1_000_000);
	await limit.reset();
	await limit.select("1m");
	expect(limit.sent).toEqual([null, 1_000_000]);
	await limit.host(null);
	await limit.host(1_000_000);
	expect(limit.value()).toBe("1m");

	await limit.select("custom");
	await limit.save(600_000);
	expect(limit.value()).toBe("custom");
	expect(limit.latest()).toBe(600_000);
	await limit.host(600_000);
	expect(limit.value()).toBe("custom");
	await limit.save(1_000_000);
	await limit.host(1_000_000);
	expect(limit.value()).toBe("1m");
	await limit.select("custom");
	await limit.reset();
	expect(limit.value()).toBe("1m");
	await limit.host(null);
	expect(limit.value()).toBe("default");
	expect(limit.sent).toEqual([null, 1_000_000, 600_000, 1_000_000, null]);
});
