import { expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelEffortPicker } from "./ModelEffortPicker";
import type { ModelPreferences } from "./useModelPreferences";

const sonnet: WireModel = {
	provider: "anthropic",
	id: "sonnet",
	name: "Sonnet",
	contextWindow: 200_000,
	reasoning: true,
	thinkingLevels: ["low", "medium", "high"],
};

const preferences: ModelPreferences = {
	supported: true,
	favorites: [],
	recents: [],
	defaultEffort: "medium",
	isFavorite: () => false,
	toggleFavorite: () => {},
	isDefault: () => false,
	setDefault: () => {},
};

function trigger(tabIndex?: number): string {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<ModelEffortPicker
				models={[sonnet]}
				current={sonnet}
				level="high"
				onSelect={() => {}}
				onSelectLevel={() => {}}
				refreshing={false}
				onRefresh={() => {}}
				preferences={preferences}
				{...(tabIndex === undefined ? {} : { tabIndex })}
			/>
		</TooltipProvider>,
	);
	return html.match(/<button[^>]*data-testid="model-selector"[^>]*>/)?.[0] ?? "";
}

test("the composer's trigger keeps no explicit tabindex; Settings asks for a tab stop", () => {
	expect(trigger()).not.toContain("tabindex");
	expect(trigger(0)).toContain('tabindex="0"');
});
