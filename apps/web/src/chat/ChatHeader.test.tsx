import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatAction } from "@/lib";
import { ChatHeader, chatHeaderLinks } from "./ChatHeader";

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

describe("an action that opens beside the chat", () => {
	const runs: string[] = [];
	const action = (id: string, pane?: true): ChatAction => ({
		id,
		label: id,
		menuLabel: id,
		icon: () => null,
		run: ({ sessionId }) => runs.push(`${id}:${sessionId}`),
		...(pane ? { pane } : {}),
	});
	const actions = [action("insights.session", true), action("insights.export")];
	const target = { workspaceId: "w1", sessionId: "s1" };

	test("is a toggle, pressed while its pane shows, that closes the pane when pressed again", () => {
		runs.length = 0;
		let closed = 0;
		const closePane = () => {
			closed += 1;
		};
		const shut = chatHeaderLinks(actions, target, undefined);
		expect(shut.map(({ id, pressed }) => [id, pressed])).toEqual([
			["insights.session", false],
			["insights.export", undefined],
		]);
		shut[0]?.onOpen();
		expect(runs).toEqual(["insights.session:s1"]);

		const open = chatHeaderLinks(actions, target, { id: "insights.session", onClose: closePane });
		expect(open[0]?.pressed).toBe(true);
		open[0]?.onOpen();
		open[1]?.onOpen();
		expect(closed).toBe(1);
		expect(runs).toEqual(["insights.session:s1", "insights.export:s1"]);

		const other = chatHeaderLinks(actions, target, { id: "notes.outline", onClose: closePane });
		expect(other[0]?.pressed).toBe(false);
	});

	test("renders as a pressed button beside the plain links", () => {
		const html = (pressed: boolean) =>
			renderToStaticMarkup(
				<ChatHeader
					stats={stats}
					statusEntries={[]}
					links={chatHeaderLinks(
						actions,
						target,
						pressed ? { id: "insights.session", onClose: () => {} } : undefined,
					)}
				/>,
			);
		expect(html(true)).toMatch(
			/<button[^>]*aria-pressed="true"[^>]*data-testid="chat-header-toggle"[^>]*data-action="insights.session"/,
		);
		expect(html(false)).toContain('aria-pressed="false"');
		expect(html(false)).toContain('data-testid="chat-header-link" data-action="insights.export"');
	});
});
