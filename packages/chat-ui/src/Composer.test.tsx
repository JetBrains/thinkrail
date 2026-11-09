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

function render(
	externalModelPicker?: { open: (query: string) => void },
	divider?: boolean,
): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<Composer
				value=""
				onChange={() => {}}
				isStreaming={false}
				awaitingResponse={false}
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
				{...(divider === undefined ? {} : { divider })}
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

test("the composer draws its top divider unless the shell moves it elsewhere", () => {
	const composerRoot = (markup: string) =>
		markup.match(/<fieldset data-testid="chat-composer"[^>]*>/)?.[0] ?? "";
	expect(composerRoot(render())).toContain("border-t");
	expect(composerRoot(render(undefined, false))).not.toContain("border-t");
});
