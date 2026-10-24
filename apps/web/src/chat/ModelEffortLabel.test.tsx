import { expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { ModelEffortLabel, parseModelRef, RunModelLabel } from "./ModelEffortLabel";

const sonnet: WireModel = {
	provider: "anthropic",
	id: "claude-sonnet-4-5",
	name: "Claude Sonnet 4.5",
	contextWindow: 200_000,
	reasoning: true,
	thinkingLevels: ["off", "low", "medium", "high"],
};

test("parseModelRef splits on the first slash so ids may carry their own", () => {
	expect(parseModelRef("anthropic/claude-sonnet-4-5")).toEqual({
		provider: "anthropic",
		id: "claude-sonnet-4-5",
	});
	expect(parseModelRef("openrouter/anthropic/claude")).toEqual({
		provider: "openrouter",
		id: "anthropic/claude",
	});
	expect(parseModelRef("bare")).toBeNull();
	expect(parseModelRef("/id")).toBeNull();
	expect(parseModelRef("provider/")).toBeNull();
});

test("the label shows the catalog name with the effort, keeping the raw reference in its title", () => {
	const html = renderToStaticMarkup(
		<ModelEffortLabel
			model="anthropic/claude-sonnet-4-5"
			thinkingLevel="high"
			catalogModel={sonnet}
		/>,
	);
	expect(html).toContain(">Claude Sonnet 4.5<");
	expect(html).toContain('title="anthropic/claude-sonnet-4-5 · effort: high"');
	expect(html).toContain('data-testid="model-effort-level"');
	expect(html).toContain(">high<");
	expect(html.match(/opacity-30/g)?.length ?? 0).toBe(0);
});

test("an uncatalogued model reads as its raw reference and a run without effort shows no level", () => {
	const raw = renderToStaticMarkup(<ModelEffortLabel model="acme/custom-7b" thinkingLevel="off" />);
	expect(raw).toContain(">acme/custom-7b<");
	expect(raw).toContain("tr-code-text-small");
	expect(raw).toContain(">off<");
	const bare = renderToStaticMarkup(<ModelEffortLabel model="acme/custom-7b" />);
	expect(bare).not.toContain('data-testid="model-effort-level"');
	expect(bare).toContain('title="acme/custom-7b"');
});

test("a run label resolves through the chat's catalog and renders nothing without a model", () => {
	const actions = { findModel: () => sonnet } as unknown as ChatActions;
	const html = renderToStaticMarkup(
		<ChatActionsContext.Provider value={actions}>
			<RunModelLabel model="anthropic/claude-sonnet-4-5" thinkingLevel="low" />
		</ChatActionsContext.Provider>,
	);
	expect(html).toContain(">Claude Sonnet 4.5<");
	expect(html).toContain(">low<");
	expect(renderToStaticMarkup(<RunModelLabel model={undefined} thinkingLevel={undefined} />)).toBe(
		"",
	);
	expect(
		renderToStaticMarkup(<RunModelLabel model="anthropic/x" thinkingLevel={undefined} />),
	).toContain(">anthropic/x<");
});
