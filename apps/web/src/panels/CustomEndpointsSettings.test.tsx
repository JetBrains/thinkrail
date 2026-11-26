import { expect, test } from "bun:test";
import type { CustomEndpoint, ModelContextSetting, ModelContextTarget } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import {
	CustomEndpointsSettings,
	type CustomEndpointsState,
	EndpointModelItem,
	type ModelRowContext,
	modelRowContext,
} from "./CustomEndpointsSettings";
import type { EndpointModelRow } from "./customEndpointDraft";
import { ModelContextLoadFailed } from "./ModelContextSettings";

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
	context = { setting, failed: false, change: () => Promise.resolve(true) },
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
	expect(input).not.toContain("data-draft-dirty");
	expect(input).not.toContain('disabled=""');
	expect(render()).not.toContain("custom-endpoints-context-reset");
	expect(contextInput(render({ model: { ...row, contextWindow: null } }))).toContain(
		'placeholder="Unknown"',
	);
});

test("a user-set window shows its value with a way back to the detected one", () => {
	const html = render({
		context: {
			setting: { ...setting, override: 262_144 },
			failed: false,
			change: () => Promise.resolve(true),
		},
	});
	expect(contextInput(html)).toContain('value="262144"');
	expect(html).toContain('data-testid="custom-endpoints-context-reset"');
	expect(html).toContain('aria-label="Use the detected context window for relay/glm"');
});

test("a model pi doesn't serve yet, an unused model or a busy dialog can't be changed", () => {
	const unsaved = contextInput(
		render({
			context: { setting: undefined, failed: false, change: () => Promise.resolve(false) },
		}),
	);
	expect(unsaved).toContain('disabled=""');
	expect(unsaved).toContain("Save the server to set this model&#x27;s context window");
	expect(contextInput(render({ model: { ...row, selected: false } }))).toContain('disabled=""');
	expect(contextInput(render({ busy: true }))).toContain('disabled=""');
});

test("a failed context read locks the field and offers Retry instead of asking to save the server", () => {
	for (const failed of [
		{ setting, failed: true, change: () => Promise.resolve(false) },
		{ setting: undefined, failed: true, change: () => Promise.resolve(false) },
	]) {
		const input = contextInput(render({ context: failed }));
		expect(input).toContain('disabled=""');
		expect(input).toContain("Couldn&#x27;t load pi context settings.");
		expect(input).not.toContain("Save the server");
	}
	const alert = renderToStaticMarkup(<ModelContextLoadFailed pending={false} onRetry={() => {}} />);
	expect(alert).toContain('role="alert"');
	expect(alert).toContain("Couldn&#x27;t load pi context settings.");
	expect(alert).toMatch(/<button[^>]*>.*Retry.*<\/button>/);
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
	expect(saved.failed).toBe(false);
	expect(modelRowContext({ ...state, failed: true }, "custom-gw", "relay/glm").failed).toBe(true);
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

const gateway: CustomEndpoint = {
	id: "custom-gw",
	name: "Gateway",
	baseUrl: "https://llm.example.com/v1",
	hasApiKey: false,
	models: [
		{
			id: "relay/glm",
			contextWindow: 65_536,
			maxTokens: null,
			reasoning: null,
			vision: null,
			tools: null,
			chatTemplateThinking: null,
		},
	],
};

function servers(endpoints: CustomEndpoint[] | null, failed = false): string {
	const state: CustomEndpointsState = {
		endpoints,
		failed,
		load: () => Promise.resolve(),
		replace: () => {},
	};
	return renderToStaticMarkup(<CustomEndpointsSettings state={state} />);
}

test("no servers yet shows an empty state whose Add server catches focus after the last removal", () => {
	const html = servers([]);
	expect(html).toContain('data-testid="custom-endpoints-empty"');
	expect(html).toContain('data-setting-id="custom-servers"');
	expect(html).toContain("No custom servers yet.");
	expect(html).toContain("Any OpenAI-compatible server");
	const add = html.match(/<button[^>]*data-testid="custom-endpoints-add"[^>]*>/)?.[0] ?? "";
	expect(add).toContain('data-focus-fallback="custom-servers"');
	expect(add).toContain('tabindex="0"');
	expect(html).not.toContain('data-key-scope="settings.list"');
});

test("servers are a keyboard list: Enter edits, Remove is a side, and the address is visible text", () => {
	const html = servers([gateway, { ...gateway, id: "custom-lab", name: "Lab", models: [] }]);
	const list = html.match(/<ul[^>]*>/)?.[0] ?? "";
	expect(list).toContain('data-key-scope="settings.list"');
	expect(list).toContain('data-focus-list="custom-servers"');
	expect(list).toContain('data-setting-id="custom-servers"');
	const edits = html.match(/<button[^>]*data-testid="custom-endpoints-edit"[^>]*>/g) ?? [];
	expect(edits).toHaveLength(2);
	expect(edits[0]).toContain("data-setting-primary");
	expect(edits[0]).toContain('tabindex="0"');
	expect(edits[1]).toContain('tabindex="-1"');
	expect(edits[0]).toContain('aria-label="Edit Gateway"');
	const removes = html.match(/<button[^>]*data-testid="custom-endpoints-remove"[^>]*>/g) ?? [];
	expect(removes[0]).toContain('tabindex="0"');
	expect(removes[0]).toContain('aria-label="Remove Gateway"');
	expect(html).toContain("https://llm.example.com/v1 · 1 model");
	expect(html).not.toContain('title="https://llm.example.com/v1"');
	expect(html).not.toContain("custom-endpoints-empty");
	expect(html.match(/data-testid="custom-endpoints-add"/g)).toHaveLength(1);
});

test("a failed server list offers Retry instead of an empty state", () => {
	const html = servers(null, true);
	expect(html).toContain("Couldn&#x27;t load custom servers.");
	expect(html).toMatch(/<button[^>]*tabindex="0"[^>]*data-testid="custom-endpoints-retry"/);
	expect(html).not.toContain("custom-endpoints-empty");
});
