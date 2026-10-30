import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { CLAUDE_USAGE_URL, ExtraUsageNotice } from "./ExtraUsageNotice";

test("the chat notice links usage and offers dismiss and Don't warn again", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<ExtraUsageNotice context="chat" onDismiss={() => {}} onDisable={() => {}} />
		</TooltipProvider>,
	);
	expect(html).toContain(`href="${CLAUDE_USAGE_URL}"`);
	expect(html).toContain(
		"Anthropic bills this chat as extra usage per token ignoring your normal plan limits, because in the current setup Pi is connected directly via API.",
	);
	expect(html).toContain('data-testid="extra-usage-disable"');
	expect(html).toContain('data-testid="extra-usage-dismiss"');
});

test("the sign-in notice is informational only", () => {
	const html = renderToStaticMarkup(<ExtraUsageNotice context="signIn" />);
	expect(html).toContain("Current Claude Pro/Max setup is billed as extra usage per token.");
	expect(html).toContain(`href="${CLAUDE_USAGE_URL}"`);
	expect(html).not.toContain("extra-usage-disable");
	expect(html).not.toContain("extra-usage-dismiss");
});
