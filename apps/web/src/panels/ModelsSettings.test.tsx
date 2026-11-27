import { afterEach, expect, test } from "bun:test";
import {
	AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	REVIEW_FIX_ROUNDS_SETTING_PROTOCOL_VERSION,
	type WireModel,
} from "@thinkrail/contracts";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { useAppStore } from "@/store";
import { CHAT_PAIR_RESET, ModelsSettings, REVIEW_PAIR_RESET } from "./ModelsSettings";

const sonnet: WireModel = {
	provider: "anthropic",
	id: "sonnet",
	name: "Sonnet",
	contextWindow: 200_000,
	reasoning: true,
	thinkingLevels: ["low", "medium", "high"],
};

const serverState = useAppStore.getInitialState();
const saved = { ...serverState };

afterEach(() => Object.assign(serverState, saved));

function withState(patch: Partial<typeof serverState>): void {
	Object.assign(serverState, patch);
}

function render(): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ModelsSettings />
		</TooltipProvider>,
	);
}

function tag(html: string, testId: string): string {
	return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

test("unset chat and review pairs have no Reset, and the review picker follows the default", () => {
	const html = render();
	expect(html).toContain('data-setting-id="chat-model"');
	expect(html).toContain('data-setting-id="review-model"');
	expect(html).not.toContain('data-testid="settings-reset-chat-model"');
	expect(html).not.toContain('data-testid="settings-reset-review-model"');
	const review = html.slice(html.indexOf('data-testid="review-model-row"'));
	expect(tag(review, "model-selector")).toContain('tabindex="0"');
	expect(review).toContain("Default");
});

test("a chosen pair is Changed and its Reset clears model and effort together", () => {
	withState({
		defaultModel: sonnet,
		defaultEffort: "high",
		reviewEffort: "low",
		protocolVersion: AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
		agentReviewEnabled: true,
	});
	const html = render();
	expect(tag(html, "settings-reset-chat-model")).toContain("data-setting-reset");
	expect(tag(html, "settings-reset-review-model")).toContain("data-setting-reset");
	expect(tag(html, "settings-reset-agent-review")).toContain("data-setting-reset");
	expect(html).not.toContain('data-testid="settings-reset-auto-fix"');
	expect(tag(html, "agent-review-toggle")).toContain('tabindex="0"');
	expect(tag(html, "review-autofix-toggle")).toContain('tabindex="0"');
	expect(CHAT_PAIR_RESET).toEqual({ defaultModel: null, defaultEffort: null });
	expect(REVIEW_PAIR_RESET).toEqual({ reviewModel: null, reviewEffort: null });
});

test("the fix-rounds row is hidden against an older host and disabled while auto-fix is off", () => {
	withState({ protocolVersion: REVIEW_FIX_ROUNDS_SETTING_PROTOCOL_VERSION - 1 });
	expect(render()).not.toContain('data-setting-id="auto-fix-rounds"');

	withState({ protocolVersion: REVIEW_FIX_ROUNDS_SETTING_PROTOCOL_VERSION, reviewAutoFix: false });
	const off = render();
	expect(off).toContain('data-setting-id="auto-fix-rounds"');
	expect(tag(off, "review-autofix-rounds-input")).toContain(' disabled=""');
	expect(tag(off, "review-autofix-rounds-input")).toContain('value="3"');
	expect(off).not.toContain('data-testid="settings-reset-auto-fix-rounds"');

	withState({ reviewAutoFix: true, reviewAutoFixRounds: 5 });
	const on = render();
	expect(tag(on, "review-autofix-rounds-input")).not.toContain(' disabled=""');
	expect(tag(on, "review-autofix-rounds-input")).toContain('value="5"');
	expect(tag(on, "settings-reset-auto-fix-rounds")).toContain("data-setting-reset");
});
