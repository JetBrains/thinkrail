import { expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { parseModelRef, RunModelLabel } from "./ModelEffortLabel";

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

test("a run label shows the catalog name and effort, keeping the raw reference in its title", () => {
	const actions = { findModel: () => sonnet } as unknown as ChatActions;
	const html = renderToStaticMarkup(
		<ChatActionsContext.Provider value={actions}>
			<RunModelLabel model="anthropic/claude-sonnet-4-5" thinkingLevel="high" />
		</ChatActionsContext.Provider>,
	);
	expect(html).toContain(">Claude Sonnet 4.5<");
	expect(html).toContain('title="anthropic/claude-sonnet-4-5"');
	expect(html).toContain('data-level="high"');
	expect(html).toContain(">high<");
	expect(html).not.toContain("thinking-selector");
	expect(html).toContain("rounded-xs bg-current");
});

test("an uncatalogued run reads as its raw reference, without a level when none was reported, and nothing without a model", () => {
	const raw = renderToStaticMarkup(<RunModelLabel model="acme/custom-7b" thinkingLevel="off" />);
	expect(raw).toContain(">acme/custom-7b<");
	expect(raw).toContain(">off<");
	expect(raw).not.toContain("rounded-xs bg-current");
	expect(
		renderToStaticMarkup(<RunModelLabel model="acme/custom-7b" thinkingLevel={undefined} />),
	).not.toContain("data-level");
	expect(renderToStaticMarkup(<RunModelLabel model={undefined} thinkingLevel={undefined} />)).toBe(
		"",
	);
});
