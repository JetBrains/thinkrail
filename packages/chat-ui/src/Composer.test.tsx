import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "./Composer";
import type { ModelPreferences } from "./modelPreferences";

const preferences: ModelPreferences = {
	supported: false,
	favorites: [],
	recents: [],
	defaultEffort: undefined,
	isFavorite: () => false,
	toggleFavorite: () => {},
	isDefault: () => false,
	setDefault: () => {},
};

function render(externalModelPicker?: { open: (query: string) => void }): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<Composer
				value=""
				onChange={() => {}}
				isStreaming={false}
				growthLimit="half-chat"
				commands={[]}
				templatePending={false}
				mentionCandidates={[]}
				recentPrompts={[]}
				models={[]}
				modelsRefreshing={false}
				onRefreshModels={() => {}}
				currentModel={null}
				thinkingLevel="off"
				modelPreferences={preferences}
				onMentionQuery={() => {}}
				onSlashActive={() => {}}
				onSelectModel={() => {}}
				onSelectThinking={() => {}}
				onSubmit={() => ({ accepted: true })}
				onAbort={() => {}}
				{...(externalModelPicker ? { externalModelPicker } : {})}
			/>
		</TooltipProvider>,
	);
}

test("without a slot the composer renders the desktop model popover trigger", () => {
	const markup = render();
	expect(markup).toContain('data-testid="model-selector"');
	expect(markup).toContain('aria-haspopup="dialog"');
});

test("an external picker leaves the field free of model controls", () => {
	const markup = render({ open: () => {} });
	expect(markup).not.toContain('data-testid="model-selector"');
	expect(markup).toContain('data-testid="chat-input"');
});
