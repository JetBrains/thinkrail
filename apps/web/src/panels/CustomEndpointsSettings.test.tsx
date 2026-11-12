import { expect, test } from "bun:test";
import type { ModelContextSetting, ModelContextTarget } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	EndpointModelItem,
	type ModelRowContext,
	modelRowContext,
} from "./CustomEndpointsSettings";
import type { EndpointModelRow } from "./customEndpointDraft";

const row: EndpointModelRow = {
	id: "relay/glm",
	contextWindow: 65_536,
	maxTokens: null,
	reasoning: null,
	vision: null,
	tools: null,
	chatTemplateThinking: null,
	selected: true,
};

const setting: ModelContextSetting = {
	provider: "custom-gw",
	id: "relay/glm",
	name: "relay/glm",
	contextWindow: 65_536,
	override: null,
};

function render({
	model = row,
	context = { setting, change: () => Promise.resolve(true) },
	busy = false,
}: {
	model?: EndpointModelRow;
	context?: ModelRowContext | null;
	busy?: boolean;
} = {}) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<EndpointModelItem
				model={model}
				divided={false}
				busy={busy}
				context={context}
				onSelect={() => {}}
			/>
		</TooltipProvider>,
	);
}

function contextInput(html: string): string {
	return html.match(/<input[^>]*data-testid="custom-endpoints-context"[^>]*>/)?.[0] ?? "";
}

test("an older host gets the row's facts without a context window field", () => {
	const html = render({ context: null });
	expect(html).toContain("66K context");
	expect(html).not.toContain('data-testid="custom-endpoints-context"');
});

test("a saved model without an override offers an empty field over the detected window", () => {
	const input = contextInput(render());
	expect(input).toContain('value=""');
	expect(input).toContain('placeholder="Detected"');
	expect(input).toContain('aria-label="Context window for relay/glm"');
	expect(input).toContain("1,024–10,000,000");
	expect(input).toContain("data-settings-draft-input");
	expect(input).not.toContain('disabled=""');
	expect(render()).not.toContain("custom-endpoints-context-reset");
	expect(contextInput(render({ model: { ...row, contextWindow: null } }))).toContain(
		'placeholder="Unknown"',
	);
});

test("a user-set window shows its value with a way back to the detected one", () => {
	const html = render({
		context: { setting: { ...setting, override: 262_144 }, change: () => Promise.resolve(true) },
	});
	expect(contextInput(html)).toContain('value="262144"');
	expect(html).toContain('data-testid="custom-endpoints-context-reset"');
	expect(html).toContain('aria-label="Use the detected context window for relay/glm"');
});

test("a model pi doesn't serve yet, an unused model or a busy dialog can't be changed", () => {
	const unsaved = contextInput(
		render({ context: { setting: undefined, change: () => Promise.resolve(false) } }),
	);
	expect(unsaved).toContain('disabled=""');
	expect(unsaved).toContain("Save the server to set this model&#x27;s context window");
	expect(contextInput(render({ model: { ...row, selected: false } }))).toContain('disabled=""');
	expect(contextInput(render({ busy: true }))).toContain('disabled=""');
});

test("a row targets its own endpoint's model and an unsaved endpoint sends nothing", async () => {
	const calls: [ModelContextTarget, number | null][] = [];
	const state = {
		settings: [setting, { ...setting, provider: "custom-other" }],
		pending: false,
		failed: false,
		retry: () => {},
		change: (target: ModelContextTarget, contextWindow: number | null) => {
			calls.push([target, contextWindow]);
			return Promise.resolve(true);
		},
	};
	const saved = modelRowContext(state, "custom-gw", "relay/glm");
	expect(saved.setting).toBe(setting);
	expect(await saved.change(131_072)).toBe(true);
	expect(await saved.change(null)).toBe(true);
	expect(calls).toEqual([
		[{ provider: "custom-gw", id: "relay/glm" }, 131_072],
		[{ provider: "custom-gw", id: "relay/glm" }, null],
	]);
	const unsaved = modelRowContext(state, undefined, "relay/glm");
	expect(unsaved.setting).toBeUndefined();
	expect(await unsaved.change(131_072)).toBe(false);
	expect(calls).toHaveLength(2);
});
