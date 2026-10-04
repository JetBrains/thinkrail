import { expect, test } from "bun:test";
import {
	CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	type ModelContextSetting,
} from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelContextControls } from "./ModelContextSettings";

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
	pending = false,
	failed = false,
}: {
	protocolVersion?: number | null;
	settings?: ModelContextSetting[] | null;
	pending?: boolean;
	failed?: boolean;
} = {}) {
	return renderToStaticMarkup(
		<ModelContextControls
			protocolVersion={protocolVersion}
			settings={settings}
			pending={pending}
			failed={failed}
			onChange={() => {}}
			onRetry={() => {}}
		/>,
	);
}

test("old and unknown hosts do not offer context controls", () => {
	expect(render({ protocolVersion: CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION - 1 })).toBe("");
	expect(render({ protocolVersion: null })).toBe("");
});

test("one Default/1M/Custom selector appears while individual settings start collapsed", () => {
	const html = render();
	expect(html.match(/type="radio"/g)).toHaveLength(3);
	expect(html).toContain('data-testid="context-limit-all-default"');
	expect(html).toMatch(/context-limit-all-default[^>]*><input[^>]*checked=""/);
	expect(html).toContain('aria-expanded="false"');
	expect(html).not.toContain('data-testid="context-limit-openai-gpt-5.5"');
	expect(html).toContain("pi CLI");
	expect(html).toContain("restart the host");
});

test("pending settings keep the authoritative 1M override but disable changes", () => {
	const html = render({ settings: [{ ...setting, override: 1_000_000 }], pending: true });
	expect(html).toContain('data-context-override="1000000"');
	expect(html).toMatch(/context-limit-all-1m[^>]*><input[^>]*checked=""/);
	expect(html.match(/type="radio"[^>]*disabled/g)).toHaveLength(3);
});

test("non-preset overrides expose an editable Custom field within the app range", () => {
	const html = render({ settings: [{ ...setting, override: 500_000, contextWindow: 500_000 }] });
	expect(html).toContain('data-testid="context-limit-all-input"');
	expect(html).toContain('value="500000"');
	expect(html).toContain('data-testid="context-limit-all-apply"');
	expect(html).toContain('min="272000"');
	expect(html).toContain('max="1000000"');
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
	expect(html).not.toContain('checked=""');
});

test("the shared control summarizes only rows it governs and names the external ones it leaves alone", () => {
	const html = render({
		settings: [
			{ ...setting, override: 1_000_000, contextWindow: 1_000_000 },
			{ ...setting, provider: "openai-codex", override: 1_050_000, contextWindow: 1_050_000 },
		],
	});
	expect(html).toMatch(/context-limit-all-1m[^>]*><input[^>]*checked=""/);
	expect(html).toContain(
		"1 available model \u00b7 1 kept at a limit set outside the 272,000\u20131,000,000 range",
	);
	expect(
		render({ settings: [{ ...setting, override: 1_050_000, contextWindow: 1_050_000 }] }),
	).not.toContain('data-testid="context-limit-all"');
});

test("failed reads replace stale controls with an actionable retry", () => {
	const html = render({ failed: true });
	expect(html).not.toContain('type="radio"');
	expect(html).toContain("Retry");
});

test("empty and loading states do not invent eligible models", () => {
	expect(render({ settings: [] })).not.toContain('type="radio"');
	expect(render({ settings: null, pending: true })).not.toContain('type="radio"');
});
