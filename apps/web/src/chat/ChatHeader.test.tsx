import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatHeader } from "./ChatHeader";

const stats = {
	sessionId: "s1",
	totalMessages: 2,
	tokens: { input: 14_000, output: 1_500, cacheRead: 0, cacheWrite: 0, total: 15_500 },
	cost: 0.42,
};

test("the header's links sit after the usage figures, before Resources, only when the chat offers any", () => {
	const header = (links?: Parameters<typeof ChatHeader>[0]["links"]) =>
		renderToStaticMarkup(
			<ChatHeader
				stats={stats}
				statusEntries={[]}
				{...(links ? { links } : {})}
				resources={<span data-testid="resources" />}
			/>,
		);
	expect(header()).not.toContain("chat-header-link");
	const html = header([{ id: "insights.session", label: "Session analysis", onOpen: () => {} }]);
	expect(html).toContain('data-action="insights.session"');
	expect(html).toContain(">Session analysis<");
	const order = ["session-stats", "chat-header-link", 'data-testid="resources"'].map((marker) =>
		html.indexOf(marker),
	);
	expect(order.every((at) => at >= 0)).toBe(true);
	expect([...order].sort((a, b) => a - b)).toEqual(order);
});
