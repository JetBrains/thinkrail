import { describe, expect, test } from "bun:test";
import type { PanelChatTarget } from "@thinkrail/extension-api/web";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type DiscoveryActions, DiscoveryView, IdeaMatrix, SnapshotDiff } from "./Discovery";
import {
	addEvidence,
	confirmScore,
	createWatch,
	deleteWatch,
	diffHunks,
	type Idea,
	ideaPeekEntry,
	isDiscoveryView,
	lineDiff,
	loadDiscovery,
	MATRIX_HEIGHT,
	MATRIX_PAD,
	matrixLayout,
	openDiscoveryChat,
	openReport,
	promoteIdea,
	quadrantOf,
	rankIdeas,
	removeEvidence,
	setScore,
	updateIdea,
	updateWatch,
	type WatchEntry,
} from "./discoveryApi";
import { fakeHost } from "./fixtures.test";
import { IdeaDetails } from "./IdeaPanel";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const noop = () => {};

function ideaOf(overrides: Partial<Idea> = {}): Idea {
	return {
		id: "D-1",
		title: "Offline mode",
		pitch: "",
		evidence: [],
		status: "new",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

const scored = (value: number, effort: number, suggested = false) => ({
	value: { score: value, reasons: [], suggested },
	effort: { score: effort, reasons: [], suggested },
});

function entryOf(overrides: Partial<WatchEntry> = {}): WatchEntry {
	return {
		id: "W-1",
		name: "Linear",
		urls: ["https://linear.app/"],
		notes: "",
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

const ACTIONS: DiscoveryActions = {
	open: noop,
	createIdea: async () => {},
	createWatch: async () => {},
	updateWatch: noop,
	deleteWatch: noop,
	watch: async () => {},
	openReport: noop,
};

describe("the value × effort matrix", () => {
	test("splits the quadrants between 2 and 3: a 3 counts as high value and as costly", () => {
		expect(quadrantOf(5, 1)).toBe("quick-win");
		expect(quadrantOf(3, 2)).toBe("quick-win");
		expect(quadrantOf(3, 3)).toBe("big-bet");
		expect(quadrantOf(2, 2)).toBe("filler");
		expect(quadrantOf(1, 5)).toBe("time-sink");
	});

	test("places each scored idea at its cell's centre, spreads shared cells and leaves the dismissed out", () => {
		const width = 540;
		const layout = matrixLayout(
			[
				ideaOf({ id: "D-1", ...scored(5, 1) }),
				ideaOf({ id: "D-2", ...scored(1, 5, true) }),
				ideaOf({ id: "D-3", ...scored(5, 1) }),
				ideaOf({ id: "D-4", value: { score: 4, reasons: [], suggested: true } }),
				ideaOf({ id: "D-5", status: "dismissed", ...scored(3, 3) }),
			],
			width,
		);
		const cellX = (width - MATRIX_PAD.right - MATRIX_PAD.left) / 5;
		const cellY = (MATRIX_HEIGHT - MATRIX_PAD.bottom - MATRIX_PAD.top) / 5;
		expect(layout.xOf(1)).toBe(MATRIX_PAD.left + cellX / 2);
		expect(layout.yOf(5)).toBeCloseTo(MATRIX_PAD.top + cellY / 2);
		expect(layout.split).toEqual({ x: MATRIX_PAD.left + 2 * cellX, y: layout.yOf(2.5) });
		const byId = Object.fromEntries(layout.points.map((point) => [point.idea.id, point]));
		expect(Object.keys(byId).sort()).toEqual(["D-1", "D-2", "D-3"]);
		expect(byId["D-2"]).toMatchObject({
			quadrant: "time-sink",
			suggested: true,
			shared: 1,
			x: layout.xOf(5),
			y: layout.yOf(1),
		});
		expect(byId["D-1"]?.quadrant).toBe("quick-win");
		expect(byId["D-1"]?.shared).toBe(2);
		expect(byId["D-1"]?.y).toBe(byId["D-3"]?.y);
		expect((byId["D-3"]?.x ?? 0) - (byId["D-1"]?.x ?? 0)).toBe(20);
		expect(((byId["D-1"]?.x ?? 0) + (byId["D-3"]?.x ?? 0)) / 2).toBe(layout.xOf(1));
		expect(layout.unscored.map((idea) => idea.id)).toEqual(["D-4"]);
	});

	test("ranks open ideas by value then effort, then the promoted, then the dismissed", () => {
		const ranked = rankIdeas([
			ideaOf({ id: "D-1", status: "dismissed", ...scored(5, 1) }),
			ideaOf({ id: "D-2" }),
			ideaOf({ id: "D-3", status: "analyzed", ...scored(4, 3) }),
			ideaOf({ id: "D-4", status: "promoted", ...scored(5, 1) }),
			ideaOf({ id: "D-5", status: "analyzed", ...scored(4, 1) }),
			ideaOf({ id: "D-10", status: "analyzed", ...scored(5, 5) }),
		]);
		expect(ranked.map((idea) => idea.id)).toEqual(["D-10", "D-5", "D-3", "D-2", "D-4", "D-1"]);
	});

	test("draws the quadrants, the axes and a dot per scored idea that peeks it", () => {
		const markup = html(
			<IdeaMatrix
				ideas={[
					ideaOf({ id: "D-1", ...scored(5, 1) }),
					ideaOf({ id: "D-2", ...scored(2, 4, true) }),
					ideaOf({ id: "D-3" }),
				]}
				onOpen={noop}
			/>,
		);
		for (const label of ["Quick wins", "Big bets", "Fill-ins", "Time sinks", "Effort →", "Value →"])
			expect(markup).toContain(label);
		expect(markup).toContain('data-idea-id="D-1" data-quadrant="quick-win"');
		expect(markup).toContain('data-idea-id="D-2" data-quadrant="time-sink" data-suggested="true"');
		expect(markup).toContain('aria-label="D-1 · Offline mode: value 5, effort 1"');
		expect(markup).toContain("1 idea needs a value and an effort to show here.");
		expect(markup).toContain("2 ideas placed by value and effort; 1 not scored yet.");
	});
});

describe("the snapshot diff", () => {
	test("diffs lines by their longest common run, in order", () => {
		expect(
			lineDiff("Features: issues\nPricing: $8\nTeams", "Features: issues\nPricing: $10\nTeams\nAI"),
		).toEqual([
			{ kind: "same", text: "Features: issues" },
			{ kind: "removed", text: "Pricing: $8" },
			{ kind: "added", text: "Pricing: $10" },
			{ kind: "same", text: "Teams" },
			{ kind: "added", text: "AI" },
		]);
		expect(lineDiff("a\r\nb", "a\nb")).toEqual([
			{ kind: "same", text: "a" },
			{ kind: "same", text: "b" },
		]);
	});

	test("folds long unchanged runs, keeping two lines of context around each change", () => {
		const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n");
		const after = ["1", "2", "3", "4", "5", "six", "7", "8", "9"].join("\n");
		expect(diffHunks(lineDiff(before, after))).toEqual([
			{ kind: "skip", count: 3 },
			{ kind: "same", text: "4" },
			{ kind: "same", text: "5" },
			{ kind: "removed", text: "6" },
			{ kind: "added", text: "six" },
			{ kind: "same", text: "7" },
			{ kind: "same", text: "8" },
			{ kind: "same", text: "9" },
		]);
	});

	test("shows added and removed lines, or that nothing changed", () => {
		const markup = html(
			<SnapshotDiff
				before={{ at: 0, text: "Pricing: $8\nTeams" }}
				after={{ at: 1, text: "Pricing: $10\nTeams" }}
			/>,
		);
		expect(markup).toContain('data-testid="board-watch-diff"');
		expect(markup).toContain('data-kind="removed"');
		expect(markup).toContain("Pricing: $8");
		expect(markup).toContain('data-kind="added"');
		expect(markup).toContain("Pricing: $10");
		const same = html(<SnapshotDiff before={{ at: 0, text: "x" }} after={{ at: 1, text: "x" }} />);
		expect(same).toContain("Nothing changed between the last two snapshots.");
	});

	test("the watchlist shows the diff only once there is a previous snapshot", () => {
		const markup = html(
			<DiscoveryView
				ideas={[ideaOf({ ...scored(5, 1) })]}
				watchlist={[
					entryOf({
						snapshot: { at: 2, text: "Pricing: $10", artifactPath: ".thinkrail/context/w.md" },
						previous: { at: 1, text: "Pricing: $8" },
					}),
					entryOf({ id: "W-2", name: "Jira", snapshot: { at: 2, text: "Pricing: $7" } }),
					entryOf({ id: "W-3", name: "Asana" }),
				]}
				layout="columns"
				actions={ACTIONS}
			/>,
		);
		expect(markup.match(/data-testid="board-watch-entry"/g)).toHaveLength(3);
		expect(markup.match(/data-testid="board-watch-diff"/g)).toHaveLength(1);
		expect(markup.match(/data-testid="board-watch-snapshot"/g)).toHaveLength(2);
		expect(markup.match(/data-testid="board-watch-report"/g)).toHaveLength(1);
		expect(markup).toContain("No snapshot yet — What changed? takes the first.");
		expect(markup.match(/data-testid="board-watch-changed"/g)).toHaveLength(3);
		expect(markup).toContain('href="https://linear.app/"');
		expect(markup).toContain('data-testid="board-idea-row" data-idea-id="D-1"');
		expect(markup).toContain("grid-cols-2");
	});
});

describe("the discovery writes and chats", () => {
	test("each panel action sends its query", async () => {
		const { host, queries } = fakeHost(() => ({}));
		const idea = ideaOf({ value: { score: 4, reasons: ["Users ask (E-1)"], suggested: true } });
		await setScore(host, "p1", "D-1", "effort", 2);
		await setScore(host, "p1", "D-1", "value", null);
		await confirmScore(host, "p1", idea, "value");
		await confirmScore(host, "p1", idea, "effort");
		await updateIdea(host, "p1", "D-1", { dismissed: true });
		await updateIdea(host, "p1", "D-1", { value: { score: 4, reasons: ["Mine"] } });
		await addEvidence(host, "p1", "D-1", { kind: "url", ref: "https://a.example/", quote: "Q" });
		await addEvidence(host, "p1", "D-1", { kind: "artifact", ref: ".thinkrail/context/r.md" });
		await removeEvidence(host, "p1", "D-1", "E-2");
		await createWatch(host, "p1", { name: "Linear", urls: ["https://linear.app"], notes: "" });
		await updateWatch(host, "p1", "W-1", { urls: [] });
		await deleteWatch(host, "p1", "W-1");
		expect(queries).toEqual([
			{ method: "idea.update", params: { projectId: "p1", ideaId: "D-1", effort: { score: 2 } } },
			{ method: "idea.update", params: { projectId: "p1", ideaId: "D-1", value: null } },
			{ method: "idea.update", params: { projectId: "p1", ideaId: "D-1", value: { score: 4 } } },
			{ method: "idea.update", params: { projectId: "p1", ideaId: "D-1", dismissed: true } },
			{
				method: "idea.update",
				params: { projectId: "p1", ideaId: "D-1", value: { score: 4, reasons: ["Mine"] } },
			},
			{
				method: "idea.addEvidence",
				params: {
					projectId: "p1",
					ideaId: "D-1",
					kind: "url",
					ref: "https://a.example/",
					quote: "Q",
				},
			},
			{
				method: "idea.addEvidence",
				params: {
					projectId: "p1",
					ideaId: "D-1",
					kind: "artifact",
					ref: ".thinkrail/context/r.md",
					workspaceId: "w0",
				},
			},
			{
				method: "idea.removeEvidence",
				params: { projectId: "p1", ideaId: "D-1", evidenceId: "E-2" },
			},
			{
				method: "watchlist.create",
				params: { projectId: "p1", name: "Linear", urls: ["https://linear.app"], notes: "" },
			},
			{ method: "watchlist.update", params: { projectId: "p1", watchId: "W-1", urls: [] } },
			{ method: "watchlist.delete", params: { projectId: "p1", watchId: "W-1" } },
		]);
	});

	test("Research, Analyze, Promote and What changed? start a chat on the server and open it", async () => {
		const chats: PanelChatTarget[] = [];
		const started = {
			projectId: "p1",
			workspaceId: "w-default",
			sessionId: "s9",
			kickoff: "/skill:x",
		};
		const { host, queries } = fakeHost(() => started);
		const opening = { ...host, openChat: (target: PanelChatTarget) => chats.push(target) };
		await openDiscoveryChat(opening, "p1", "research", { ideaId: "D-1" });
		await openDiscoveryChat(opening, "p1", "watch", { watchId: "W-2" });
		expect(await promoteIdea(opening, "p1", "D-1")).toEqual(started);
		expect(queries).toEqual([
			{ method: "discovery.chat", params: { projectId: "p1", kind: "research", ideaId: "D-1" } },
			{ method: "discovery.chat", params: { projectId: "p1", kind: "watch", watchId: "W-2" } },
			{ method: "idea.promote", params: { projectId: "p1", ideaId: "D-1" } },
		]);
		expect(chats).toHaveLength(3);
		expect(chats[0]).toEqual({ projectId: "p1", workspaceId: "w-default", sessionId: "s9" });
		await expect(promoteIdea(fakeHost(() => ({})).host, "p1", "D-1")).rejects.toThrow(
			"unknown shape",
		);
	});

	test("reads discovery.get checked, peeks an idea as its panel and a report where it was written", async () => {
		const view = { projectId: "p1", projectName: "ThinkRail", ideas: [ideaOf()], watchlist: [] };
		expect(isDiscoveryView(view)).toBe(true);
		expect(isDiscoveryView({ ...view, ideas: [{ id: "D-1" }] })).toBe(false);
		expect(await loadDiscovery(fakeHost(() => view).host, "p1")).toEqual(view);
		await expect(loadDiscovery(fakeHost(() => ({})).host, "p1")).rejects.toThrow("unknown shape");
		expect(ideaPeekEntry("p1", ideaOf())).toEqual({
			kind: "extension",
			panel: "idea",
			params: { projectId: "p1", ideaId: "D-1" },
			title: "D-1 · Offline mode",
		});
		const { host, peeks, workspaces } = fakeHost();
		openReport(host, "p1", { path: ".thinkrail/context/r.md" });
		openReport(host, "p1", { path: ".thinkrail/context/r.md", workspaceId: "w-default" });
		expect(peeks).toEqual([{ kind: "file", path: ".thinkrail/context/r.md" }]);
		expect(workspaces).toEqual([
			{
				workspaceId: "w-default",
				projectId: "p1",
				peek: { kind: "file", path: ".thinkrail/context/r.md" },
			},
		]);
	});
});

describe("the idea in Peek", () => {
	test("shows a suggested score to confirm, its reasons, the horizon, the evidence and the actions", () => {
		const { host } = fakeHost();
		const markup = html(
			<IdeaDetails
				host={host}
				projectId="p1"
				idea={ideaOf({
					status: "analyzed",
					pitch: "Work on a plane",
					value: { score: 4, reasons: ["Top request (E-1)"], suggested: true },
					effort: { score: 2, reasons: [], suggested: false },
					horizonSuggestion: { horizon: "next", reason: "After sync" },
					evidence: [
						{
							id: "E-1",
							kind: "url",
							ref: "https://example.com/forum",
							quote: "Please add offline",
							addedBy: "agent",
							at: 0,
						},
						{
							id: "E-2",
							kind: "artifact",
							ref: ".thinkrail/context/research-D-1.md",
							workspaceId: "w-default",
							addedBy: "agent",
							at: 0,
						},
						{ id: "E-3", kind: "note", ref: "javascript:alert(1)", addedBy: "human", at: 0 },
					],
				})}
				write={async () => true}
				onError={noop}
				onDeleted={noop}
			/>,
		);
		expect(markup).toContain('data-testid="board-idea-value" data-suggested="true"');
		expect(markup).toContain('data-testid="board-idea-value-confirm"');
		expect(markup).not.toContain('data-testid="board-idea-effort-confirm"');
		expect(markup).toContain("Top request (E-1)");
		expect(markup).toContain("After sync");
		expect(markup).toContain('href="https://example.com/forum"');
		expect(markup).toContain("Please add offline");
		expect(markup).toContain('data-testid="board-idea-evidence-open"');
		expect(markup).not.toContain('href="javascript');
		for (const action of ["research", "analyze", "promote"])
			expect(markup).toContain(`data-testid="board-idea-chat-${action}"`);
		expect(markup).toContain('data-testid="board-idea-dismiss"');
	});

	test("a promoted idea links its initiative and offers only Research; a dismissed one comes back", () => {
		const { host } = fakeHost();
		const promoted = html(
			<IdeaDetails
				host={host}
				projectId="p1"
				idea={ideaOf({
					status: "promoted",
					initiativeId: "I-3",
					initiative: { id: "I-3", title: "Offline" },
				})}
				write={async () => true}
				onError={noop}
				onDeleted={noop}
			/>,
		);
		expect(promoted).toContain("Promoted to I-3 · Offline");
		expect(promoted).not.toContain('data-testid="board-idea-chat-promote"');
		expect(promoted).not.toContain('data-testid="board-idea-dismiss"');
		const dismissed = html(
			<IdeaDetails
				host={host}
				projectId="p1"
				idea={ideaOf({ status: "dismissed" })}
				write={async () => true}
				onError={noop}
				onDeleted={noop}
			/>,
		);
		expect(dismissed).toContain('data-testid="board-idea-restore"');
	});
});
