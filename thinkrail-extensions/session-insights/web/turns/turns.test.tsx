import { describe, expect, test } from "bun:test";
import type { TurnSummary } from "@thinkrail/pi-session-insights/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES } from "../fixtures.test";
import { summary } from "../timeline/fixtures.test";
import { llm, sampleEvents, T0, tool, turn } from "../trace/events.test";
import { TraceModel } from "../trace/model";
import { keepTurn, locateInTurn, turnOf, turnSteps } from "./steps";
import { TurnCard } from "./TurnsView";

const html = (node: ReactNode) => renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

describe("turn steps", () => {
	const model = new TraceModel(sampleEvents());

	test("are the turn's model calls, each with the tools it issued", () => {
		const steps = turnSteps(model, model.indexOf("u1"));
		expect(steps.map((step) => model.at(step.index)?.id)).toEqual(["a1", "a2"]);
		expect(steps[0]?.tools.map((at) => model.at(at)?.id)).toEqual(["t1", "t2"]);
		expect(steps[1]?.tools).toEqual([]);
	});

	test("locate a selection in its turn and step; outside every turn there is none", () => {
		expect(turnOf(model, model.indexOf("s1"))).toBe(model.indexOf("u1"));
		expect(locateInTurn(model, model.indexOf("s1"))).toEqual({
			turn: model.indexOf("u1"),
			step: model.indexOf("a1"),
		});
		expect(locateInTurn(model, model.indexOf("u2"))).toEqual({
			turn: model.indexOf("u2"),
			step: null,
		});
		expect(locateInTurn(model, model.indexOf("m0"))).toBeNull();
		expect(locateInTurn(model, -1)).toBeNull();
	});

	test("filters keep turns with errors or subagents", () => {
		const quiet = summary("u2", 2, {
			errors: { value: 0, origin: "counted" },
			subagents: { value: 0, origin: "counted" },
		});
		expect(keepTurn(summary("u1", 1), "errors")).toBe(true);
		expect(keepTurn(quiet, "errors")).toBe(false);
		expect(keepTurn(quiet, "subagents")).toBe(false);
		expect(keepTurn(quiet, "all")).toBe(true);
	});
});

describe("a turn card", () => {
	const model = new TraceModel(sampleEvents());
	const card = (options: { expanded: boolean; selected: number; turn?: TurnSummary }) =>
		html(
			<TurnCard
				model={model}
				index={model.indexOf(options.turn?.id ?? "u1")}
				turn={options.turn ?? summary("u1", 1)}
				gaps={[]}
				sources={SOURCES}
				expanded={options.expanded}
				selected={options.selected}
				palette={null}
				onToggle={() => {}}
				onSelect={() => {}}
			/>,
		);

	test("shows the turn's figures, a subagent badge and its strip, folded until opened", () => {
		const markup = card({ expanded: false, selected: -1 });
		expect(markup).toContain('data-testid="turn-card"');
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain("prompt 1");
		expect(markup).toContain("2 model calls");
		expect(markup).toContain("2 tool calls");
		expect(markup).toContain("1 error");
		expect(markup).toContain("$0.02");
		expect(markup).toContain("1 subagent");
		expect(markup).toContain('data-testid="turn-strip"');
		expect(markup).not.toContain('data-testid="turn-steps"');
	});

	test("opens into its steps and marks the selected tool call", () => {
		const markup = card({ expanded: true, selected: model.indexOf("t1") });
		expect(markup).toContain('aria-expanded="true"');
		expect(markup.match(/data-testid="turn-step"/g)).toHaveLength(2);
		expect(markup).toMatch(/data-testid="turn-step-tool" data-event-id="t1" aria-pressed="true"/);
		expect(markup).toMatch(/data-testid="turn-step-tool" data-event-id="t2" aria-pressed="false"/);
		expect(markup).toContain('data-selected="true"');
	});

	test("labels a turn a background completion started and reads tokens where cost is $0", () => {
		const events = [
			turn("c1", 3, T0, T0 + 5_000, "background"),
			llm("a9", "c1", T0 + 1_000, T0 + 5_000, { stop: "stop", calls: 0 }),
			tool("t9", "a9", T0 + 2_000, T0 + 3_000),
		];
		const background = new TraceModel(events);
		const markup = html(
			<TurnCard
				model={background}
				index={0}
				turn={summary("c1", 3, {
					trigger: "background",
					cost: { value: 0, origin: "notRecorded" },
				})}
				gaps={[]}
				sources={SOURCES}
				expanded={false}
				selected={-1}
				palette={null}
				onToggle={() => {}}
				onSelect={() => {}}
			/>,
		);
		expect(markup).toContain('data-trigger="background"');
		expect(markup).toContain("background command finished");
		expect(markup).toContain("20 tokens");
		expect(markup).toContain('data-origin="notRecorded"');
	});
});
