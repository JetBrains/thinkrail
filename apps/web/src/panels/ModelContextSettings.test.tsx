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
	expect(html).toContain("host restart");
});

test("pending settings keep the authoritative 1M override but disable changes", () => {
	const html = render({ settings: [{ ...setting, override: 1_000_000 }], pending: true });
	expect(html).toContain('data-context-override="1000000"');
	expect(html).toMatch(/context-limit-all-1m[^>]*><input[^>]*checked=""/);
	expect(html.match(/type="radio"[^>]*disabled/g)).toHaveLength(3);
});

test("non-preset overrides expose an editable Custom field that auto-saves", () => {
	const html = render({ settings: [{ ...setting, override: 500_000, contextWindow: 500_000 }] });
	expect(html).toContain('data-testid="context-limit-all-input"');
	expect(html).toContain('value="500000"');
	// No Apply button - input auto-saves on blur or Enter
	expect(html).not.toContain('data-testid="context-limit-all-apply"');
	expect(html).toContain('inputMode="numeric"');
});

test("different overrides show mixed state without a preset selected", () => {
	const html = render({
		settings: [
			setting,
			{ ...setting, provider: "context-proxy", override: 750_000, contextWindow: 750_000 },
		],
	});
	// Main control shows mixed state when shared models have different overrides
	expect(html).toContain('data-context-override="mixed"');
	// No preset should be selected
	expect(html).not.toContain('checked=""');
});

test("the shared control governs only eligible models and hides when none are eligible", () => {
	// When shared model has 1M override, main control shows 1M selected
	const html = render({
		settings: [
			{ ...setting, override: 1_000_000, contextWindow: 1_000_000 },
			{ ...setting, provider: "openai-codex", override: 1_050_000, contextWindow: 1_050_000 },
		],
	});
	expect(html).toMatch(/context-limit-all-1m[^>]*><input[^>]*checked=""/);
	// When only external models exist (outside range), the main control is hidden
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
