import { describe, expect, test } from "bun:test";
import { applyLocale } from "@thinkrail/locales/react";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import type { ChatRow } from "./rows";
import { ChatTurnView } from "./turns";

function renderRow(row: ChatRow, isFinalAnswer: boolean): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ChatTurnView row={row} agentResponded isFinalAnswer={isFinalAnswer} />
		</TooltipProvider>,
	);
}

describe("message copy layout", () => {
	test("places an assistant copy action inside the bottom-left content band", () => {
		const html = renderRow({ kind: "markdown", id: "answer", text: "100. Final answer" }, true);

		expect(html).toContain("pl-24");
		expect(html).toContain("list-inside");
		expect(html).toContain("bottom-0 left-0");
		expect(html).not.toContain("pb-24");
	});

	test("places a user copy action inside the bottom-right content band", () => {
		const html = renderRow(
			{
				kind: "user",
				id: "prompt",
				message: { role: "user", content: "User prompt", timestamp: 0 },
			},
			false,
		);

		expect(html).toContain("pr-24");
		expect(html).toContain("right-0 bottom-8");
		expect(html).not.toContain("pb-24");
	});
});

describe("system and failure notices", () => {
	test("an extension notice keeps its text; the round closer and failure notices follow the language", () => {
		expect(renderRow({ kind: "system", id: "n", text: "Just so you know" }, false)).toContain(
			"Just so you know",
		);
		expect(renderRow({ kind: "system", id: "done" }, false)).toContain("✓ Done");
		applyLocale("de", {
			de: { "chat.turn.done": "✓ Fertig", "chat.failure.truncated": "Antwort abgeschnitten." },
		});
		try {
			expect(renderRow({ kind: "system", id: "done" }, false)).toContain("✓ Fertig");
			expect(
				renderRow({ kind: "error", id: "e", text: "", failure: "truncated" }, false),
			).toContain("Antwort abgeschnitten.");
			expect(
				renderRow({ kind: "error", id: "e", text: "429 rate limited", failure: "error" }, false),
			).toContain("429 rate limited");
		} finally {
			applyLocale("en", {});
		}
	});

	test("a subscription-limit failure swaps Try again for the usage page and provider settings", () => {
		const text =
			"The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.";
		const row: ChatRow = { kind: "error", id: "e", text, failure: "error", recovery: "try-again" };
		const render = (actions: ChatActions | null) =>
			renderToStaticMarkup(
				<ChatActionsContext.Provider value={actions}>
					<TooltipProvider>
						<ChatTurnView row={row} agentResponded isFinalAnswer={false} onTryAgain={() => {}} />
					</TooltipProvider>
				</ChatActionsContext.Provider>,
			);
		const html = render({ openProviderSettings: () => {} } as unknown as ChatActions);
		expect(html).toContain(text);
		expect(html).toContain('href="https://chatgpt.com/settings/usage"');
		expect(html).toContain("Check ChatGPT usage");
		expect(html).toContain('data-testid="agent-open-provider-settings"');
		expect(html).not.toContain('data-testid="agent-try-again"');
		expect(render(null)).not.toContain("agent-open-provider-settings");
		expect(
			renderToStaticMarkup(
				<TooltipProvider>
					<ChatTurnView
						row={{ ...row, text: "429 rate limited" }}
						agentResponded
						isFinalAnswer={false}
						onTryAgain={() => {}}
					/>
				</TooltipProvider>,
			),
		).toContain('data-testid="agent-try-again"');
	});
});
