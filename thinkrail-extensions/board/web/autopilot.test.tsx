import { describe, expect, test } from "bun:test";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AutopilotFacts } from "./AutopilotParts";
import { fakeHost, initiativeOf, viewOf } from "./fixtures.test";
import { InitiativeDetails } from "./InitiativePanel";
import {
	type AutopilotView,
	autopilotState,
	isAutopilotView,
	loadContainerAutopilot,
	runInitiative,
	setAutopilot,
} from "./roadmapApi";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
const noop = () => {};

const orchestrator = { projectId: "chats", workspaceId: "chat-c1", sessionId: "orch-c1" };

function autopilotOf(overrides: Partial<AutopilotView> = {}): AutopilotView {
	return {
		projectId: "p1",
		initiativeId: "I-1",
		title: "Checkout",
		on: false,
		pausedReason: null,
		container: null,
		running: 1,
		cap: 3,
		ready: [],
		...overrides,
	};
}

describe("autopilot in the web half", () => {
	test("the state reads on, paused with its reason, or off", () => {
		expect(autopilotState({ on: false, pausedReason: null })).toBe("off");
		expect(autopilotState({ on: true, pausedReason: null })).toBe("on");
		expect(autopilotState({ on: true, pausedReason: { kind: "review", count: 6, limit: 5 } })).toBe(
			"paused",
		);
		const paused = html(
			<AutopilotFacts
				view={autopilotOf({
					on: true,
					pausedReason: { kind: "review", count: 6, limit: 5 },
					ready: [
						{ id: "TR-2", title: "Saved cards", size: "S", offered: true, stale: false },
						{ id: "TR-3", title: "Receipts", offered: false, stale: true },
					],
				})}
			/>,
		);
		expect(paused).toContain('data-state="paused"');
		expect(paused).toContain("Paused: Review is over its limit (6/5)");
		expect(paused).toContain("Agents 1/3");
		expect(paused).toContain("TR-2 · Saved cards");
		expect(paused).toContain("Offered to the orchestrator");
		expect(paused).toContain("Orchestrator didn&#x27;t start it");
		const off = html(<AutopilotFacts view={autopilotOf({ cap: 0 })} />);
		expect(off).toContain('data-state="off"');
		expect(off).toContain("Autopilot off");
		expect(off).toContain("Agents 1");
		expect(off).toContain("No card is ready");
		const orphan = html(
			<AutopilotFacts view={autopilotOf({ on: true, pausedReason: { kind: "orchestrator" } })} />,
		);
		expect(orphan).toContain("Paused: the container has no orchestrator");
	});

	test("the initiative panel offers Run without a container, Open container and the switch with one", () => {
		const initiative = initiativeOf({ id: "I-1", title: "Checkout" });
		const view = viewOf([initiative]);
		const { host } = fakeHost();
		const props = {
			host,
			view,
			board: null,
			initiative,
			write: noop,
			onError: noop,
			onDeleted: noop,
		};
		const fresh = html(<InitiativeDetails {...props} autopilot={autopilotOf()} />);
		expect(fresh).toContain('data-testid="board-initiative-run"');
		expect(fresh).toContain("Run initiative");
		expect(fresh).not.toContain('data-testid="board-initiative-autopilot-switch"');
		const running = html(
			<InitiativeDetails
				{...props}
				autopilot={autopilotOf({
					on: true,
					container: { id: "c1", name: "Checkout", members: 2, orchestrator },
				})}
			/>,
		);
		expect(running).not.toContain('data-testid="board-initiative-run"');
		expect(running).toContain('data-testid="board-initiative-open-container"');
		expect(running).toContain("Container “Checkout” · 2 workspaces");
		expect(running).toContain('data-testid="board-initiative-autopilot-switch"');
		expect(running).toContain('aria-checked="true"');
		expect(running).toContain("Autopilot on");
		const closed = html(
			<InitiativeDetails
				{...props}
				initiative={initiativeOf({ ...initiative, closedAt: 1 })}
				autopilot={autopilotOf()}
			/>,
		);
		expect(closed).not.toContain('data-testid="board-initiative-run"');
		expect(html(<InitiativeDetails {...props} />)).not.toContain("board-initiative-autopilot");
	});

	test("Run, the switch and the container read send their queries and check the replies", async () => {
		const run = {
			projectId: "p1",
			initiativeId: "I-1",
			containerId: "c1",
			orchestrator,
			started: { cardId: "TR-1", workspaceId: "w1", sessionId: "s1" },
		};
		const { host, queries } = fakeHost((method) =>
			method === "initiative.run"
				? run
				: method === "autopilot.ofContainer"
					? autopilotOf({ container: { id: "c1", name: "Checkout", members: 1, orchestrator } })
					: {},
		);
		expect(await runInitiative(host, "p1", "I-1")).toEqual(run);
		await setAutopilot(host, "p1", "I-1", true);
		expect(await loadContainerAutopilot(host, "c1")).toMatchObject({ initiativeId: "I-1" });
		expect(queries).toEqual([
			{ method: "initiative.run", params: { projectId: "p1", initiativeId: "I-1" } },
			{
				method: "initiative.autopilot",
				params: { projectId: "p1", initiativeId: "I-1", on: true },
			},
			{ method: "autopilot.ofContainer", params: { containerId: "c1" } },
		]);
		const nothing = fakeHost(() => null);
		expect(await loadContainerAutopilot(nothing.host, "c9")).toBeNull();
		await expect(
			runInitiative(fakeHost(() => ({ containerId: "c1" })).host, "p1", "I-1"),
		).rejects.toThrow("unknown shape");
	});

	test("a reply is an autopilot view only in its full shape", () => {
		expect(isAutopilotView(autopilotOf())).toBe(true);
		expect(
			isAutopilotView(
				autopilotOf({ container: { id: "c1", name: "x", members: 1, orchestrator: null } }),
			),
		).toBe(true);
		for (const broken of [
			null,
			{ ...autopilotOf(), on: "yes" },
			{ ...autopilotOf(), ready: {} },
			{ ...autopilotOf(), container: { id: "c1", orchestrator: { projectId: "p" } } },
		])
			expect(isAutopilotView(broken)).toBe(false);
	});
});
