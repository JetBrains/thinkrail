import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type AttemptReview,
	BoardReplyError,
	type Card,
	canReview,
	durationText,
	latestReview,
	loadPacket,
	openEvidence,
	packetPr,
	packetToPr,
	reviewCard,
	tallyOf,
} from "./api";
import { type CardActions, CardTile } from "./CardTile";
import { cardOf, fakeHost, liveOf } from "./fixtures.test";
import { ConformanceChip, SmartReviewSection } from "./SmartReview";

const noop = () => {};
const ACTIONS: CardActions = {
	open: noop,
	enter: noop,
	start: noop,
	adopt: noop,
	cancelStart: noop,
	keyDown: noop,
};
const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const disabled = (markup: string, testId: string) =>
	new RegExp(`<button[^>]*disabled=""[^>]*data-testid="${testId}"`).test(markup);

const review: AttemptReview = {
	at: Date.UTC(2026, 0, 2),
	summary: "One requirement is missing.",
	items: [
		{
			id: "ac-1",
			source: "criterion",
			text: "Greets in French",
			verdict: "met",
			evidence: [{ path: "src/greet.ts", line: 3, note: "bonjour" }],
			tests: ["src/greet.test.ts"],
		},
		{
			id: "ac-2",
			source: "criterion",
			text: "Says goodbye",
			verdict: "unmet",
			evidence: [{ path: "src/greet.ts", line: 9, note: "no farewell" }],
			tests: [],
			commentId: "rc_1",
		},
		{
			id: "ac-3",
			source: "task-spec",
			text: "Is fast",
			verdict: "untested",
			evidence: [],
			tests: [],
		},
	],
};

const attempt = (over: Partial<Card["attempts"][number]> = {}) => ({
	workspaceId: "w1",
	sessionId: "s1",
	workflow: "implement" as const,
	startedAt: 1,
	notes: [],
	...over,
});

const reviewed = (over: Partial<Card> = {}) =>
	cardOf({
		category: "review",
		column: "review",
		attempts: [attempt({ review })],
		live: [liveOf({ chat: { state: "idle", unread: false, title: "c" } })],
		...over,
	});

describe("conformance math and targets", () => {
	test("the tally counts verdicts; the latest attempt's review is the card's", () => {
		expect(tallyOf(review)).toEqual({ met: 1, unmet: 1, untested: 1, total: 3 });
		expect(latestReview(reviewed())).toBe(review);
		expect(latestReview(cardOf({ attempts: [attempt({ review }), attempt()] }))).toBeUndefined();
	});

	test("Smart review needs an open attempt; Add to PR needs its pull request", () => {
		expect(canReview(reviewed())).toBe(true);
		expect(canReview(cardOf())).toBe(false);
		expect(canReview(reviewed({ live: [liveOf({ open: false })] }))).toBe(false);
		expect(canReview(reviewed({ virtual: true }))).toBe(false);
		expect(packetPr(reviewed())).toBeNull();
		expect(
			packetPr(
				reviewed({ live: [liveOf({ pr: { kind: "pull-request", number: 31, state: "open" } })] }),
			),
		).toBe(31);
		expect(durationText(125 * 60_000)).toBe("2h 05m");
	});

	test("evidence opens at its line in Peek here, else in its own workspace's tab", () => {
		const { host, peeks, files } = fakeHost();
		expect(openEvidence(host, "w0", { path: "src/greet.ts", line: 9 })).toBe("peek");
		expect(peeks).toEqual([{ kind: "file", path: "src/greet.ts", line: 9 }]);
		expect(openEvidence(host, "w1", { path: "src/greet.ts" })).toBe("file");
		expect(files).toEqual([{ workspaceId: "w1", path: "src/greet.ts" }]);
	});

	test("the queries Smart review, the packet and Add to PR send, and their reply checks", async () => {
		const { host, queries } = fakeHost((method) =>
			method === "card.packetToPr" ? { pr: 31, updated: true } : { cardId: "TR-1" },
		);
		await reviewCard(host, "TR-1");
		expect(await packetToPr(host, "TR-1")).toEqual({ pr: 31, updated: true });
		await expect(loadPacket(host, "TR-1")).rejects.toBeInstanceOf(BoardReplyError);
		expect(queries.map((query) => [query.method, query.params])).toEqual([
			["card.review", { cardId: "TR-1" }],
			["card.packetToPr", { cardId: "TR-1" }],
			["card.packet", { cardId: "TR-1" }],
		]);
	});
});

describe("Smart review rendered", () => {
	test("the tile shows the conformance chip once reviewed, marked by its worst verdict", () => {
		const markup = html(
			<ul>
				<CardTile card={reviewed()} actions={ACTIONS} starting={false} />
			</ul>,
		);
		expect(markup).toContain('data-testid="board-conformance"');
		expect(markup).toContain('data-verdict="unmet"');
		expect(markup).toContain("1/3 met");
		expect(html(<ConformanceChip card={cardOf()} />)).toBe("");
		const allMet = { ...review, items: review.items.slice(0, 1) };
		expect(
			html(<ConformanceChip card={reviewed({ attempts: [attempt({ review: allMet })] })} />),
		).toContain('data-verdict="met"');
	});

	test("the card's section: the button, the table with verdict chips, evidence and tests, and the comments link", () => {
		const { host } = fakeHost();
		const markup = html(
			<SmartReviewSection host={host} projectId="p1" card={reviewed()} onChanged={noop} />,
		);
		expect(markup).toContain('data-testid="board-review-run"');
		expect(markup).toContain("Review again");
		expect(markup.match(/data-testid="board-review-item"/g)).toHaveLength(3);
		expect(markup).toContain('data-verdict="untested"');
		expect(markup).toContain("src/greet.ts:9");
		expect(markup).toContain("src/greet.test.ts");
		expect(markup).toContain("One requirement is missing.");
		expect(markup).toContain('data-testid="board-review-comments"');
		expect(markup).toContain('data-testid="board-packet-to-pr"');
		expect(disabled(markup, "board-packet-to-pr")).toBe(true);
		expect(disabled(markup, "board-review-run")).toBe(false);
	});

	test("while it runs the button waits and says so; a failure shows; nothing to review says why", () => {
		const { host } = fakeHost();
		const running = html(
			<SmartReviewSection
				host={host}
				projectId="p1"
				card={reviewed({ reviewing: true })}
				onChanged={noop}
			/>,
		);
		expect(running).toContain('data-testid="board-review-running"');
		expect(disabled(running, "board-review-run")).toBe(true);
		const failed = html(
			<SmartReviewSection
				host={host}
				projectId="p1"
				card={reviewed({ reviewError: "The reviewer did not complete (aborted)." })}
				onChanged={noop}
			/>,
		);
		expect(failed).toContain("Smart review failed: The reviewer did not complete (aborted).");
		const closed = html(
			<SmartReviewSection
				host={host}
				projectId="p1"
				card={reviewed({ attempts: [attempt()], live: [liveOf({ open: false })] })}
				onChanged={noop}
			/>,
		);
		expect(closed).toContain("start the card first");
		expect(closed).not.toContain('data-testid="board-review-comments"');
	});
});
