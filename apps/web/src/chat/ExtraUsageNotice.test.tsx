import { expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { CLAUDE_USAGE_URL, EXTRA_USAGE_DOCS_URL, ExtraUsageNotice } from "./ExtraUsageNotice";

test("the chat notice links usage and pi's docs and offers dismiss and Don't warn again", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<ExtraUsageNotice context="chat" onDismiss={() => {}} onDisable={() => {}} />
		</TooltipProvider>,
	);
	expect(html).toContain(`href="${CLAUDE_USAGE_URL}"`);
	expect(html).toContain(`href="${EXTRA_USAGE_DOCS_URL}"`);
	expect(html).toContain("Anthropic is billing this chat as extra usage.");
	expect(html).toContain('data-testid="extra-usage-disable"');
	expect(html).toContain('data-testid="extra-usage-dismiss"');
});

test("the sign-in notice is informational only", () => {
	const html = renderToStaticMarkup(<ExtraUsageNotice context="signIn" />);
	expect(html).toContain("Claude Pro/Max usage here is billed as extra usage.");
	expect(html).toContain(`href="${CLAUDE_USAGE_URL}"`);
	expect(html).not.toContain("extra-usage-disable");
	expect(html).not.toContain("extra-usage-dismiss");
});
