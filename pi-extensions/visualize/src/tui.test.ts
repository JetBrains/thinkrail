import { beforeAll, describe, expect, test } from "bun:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { diagramFamily } from "./diagramFamily.ts";
import { renderBoxDrawing } from "./probe.ts";
import {
	callSummary,
	DiagramComponent,
	fitsWidth,
	renderVisualizeCall,
	renderVisualizeResult,
} from "./tui.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => `*${text}*`,
} as unknown as Theme;

const FLOW = "flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]";

beforeAll(() => initTheme("dark", false));

function plain(lines: string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

describe("diagramFamily", () => {
	test("detects the renderable families and skips comments", () => {
		expect(diagramFamily("%% note\nflowchart TD\n A")).toBe("flowchart");
		expect(diagramFamily("graph LR\n A")).toBe("flowchart");
		expect(diagramFamily("stateDiagram-v2\n [*] --> A")).toBe("state");
		expect(diagramFamily("sequenceDiagram\n A->>B: hi")).toBe("sequence");
		expect(diagramFamily("classDiagram\n A <|-- B")).toBe("class");
		expect(diagramFamily("erDiagram\n A ||--o{ B : has")).toBe("er");
		expect(diagramFamily("xychart-beta\n x-axis [a]")).toBe("xychart");
	});

	test("returns undefined for families the renderer does not know", () => {
		for (const header of ["gantt", "pie", "mindmap", "gitGraph", "timeline", "nonsense"]) {
			expect(diagramFamily(`${header}\n x`)).toBeUndefined();
		}
	});
});

describe("renderBoxDrawing", () => {
	test("renders a flowchart as box-drawing and returns undefined for unknown families", () => {
		const drawing = renderBoxDrawing(FLOW);
		expect(drawing).toContain("┌");
		expect(drawing).toContain("Start");
		expect(renderBoxDrawing("gantt\n title X")).toBeUndefined();
	});
});

describe("fitsWidth", () => {
	test("accepts rows within width whose cells equal their length", () => {
		expect(fitsWidth(["┌───┐", "│ A │"], 5)).toBe(true);
		expect(fitsWidth(["┌───┐", "│ A │"], 4)).toBe(false);
	});

	test("rejects rows with wide characters the renderer cannot place", () => {
		const row = "│ 数据库 │";
		expect(visibleWidth(row)).toBeGreaterThan(row.length);
		expect(fitsWidth([row], 80)).toBe(false);
	});
});

describe("DiagramComponent", () => {
	test("shows the diagram when it fits and only the diagram when collapsed", () => {
		const lines = plain(new DiagramComponent(FLOW, undefined, false, theme).render(120));
		expect(lines.some((line) => line.includes("Start"))).toBe(true);
		expect(lines.some((line) => line.includes("```"))).toBe(false);
	});

	test("appends the source fence when expanded and prefixes a title", () => {
		const lines = plain(new DiagramComponent(FLOW, "Flow", true, theme).render(120));
		expect(lines[0]).toBe("*Flow*");
		expect(lines.some((line) => line.includes("Start"))).toBe(true);
		expect(lines.some((line) => line.includes("flowchart LR"))).toBe(true);
	});

	test("falls back to the source fence when the diagram is wider than the viewport", () => {
		const lines = plain(new DiagramComponent(FLOW, undefined, false, theme).render(20));
		expect(lines.some((line) => line.includes("┌"))).toBe(false);
		expect(lines.some((line) => line.includes("flowchart LR"))).toBe(true);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
	});

	test("falls back to the source fence for wide-character labels and unknown families", () => {
		const cjk = plain(
			new DiagramComponent("flowchart LR\n A[数据库] --> B[End]", undefined, false, theme).render(
				120,
			),
		);
		expect(cjk.some((line) => line.includes("┌"))).toBe(false);
		expect(cjk.some((line) => line.includes("数据库"))).toBe(true);
		const gantt = plain(
			new DiagramComponent("gantt\n title X", undefined, false, theme).render(120),
		);
		expect(gantt.some((line) => line.includes("gantt"))).toBe(true);
	});

	test("caches per width and recomputes after invalidate", () => {
		const component = new DiagramComponent(FLOW, undefined, false, theme);
		const wide = component.render(120);
		expect(component.render(120)).toBe(wide);
		const narrow = component.render(20);
		expect(narrow).not.toBe(wide);
		component.invalidate();
		expect(component.render(20)).not.toBe(narrow);
	});
});

describe("renderVisualizeCall / renderVisualizeResult", () => {
	test("summarises the call by title, comparison count, or diagram", () => {
		expect(callSummary({ type: "diagram", title: "Topology" })).toBe("Topology");
		expect(callSummary({ type: "comparison", options: [{ name: "a" }, { name: "b" }] })).toBe(
			"comparison — 2 options",
		);
		expect(callSummary({ type: "diagram" })).toBe("diagram");
		const call = plain(renderVisualizeCall({ type: "diagram", mermaid: FLOW }, theme).render(80));
		expect(call[0]).toBe("*visualize *diagram");
	});

	test("renders partial, error, diagram and comparison results", () => {
		const options = { expanded: false, isPartial: false };
		const partial = renderVisualizeResult(
			{ content: [], details: undefined },
			{ ...options, isPartial: true },
			theme,
			{ isError: false },
		);
		expect(plain(partial.render(80))[0]).toContain("Rendering");
		const error = renderVisualizeResult(
			{
				content: [{ type: "text", text: "visualize: invalid Mermaid syntax" }],
				details: undefined,
			},
			options,
			theme,
			{ isError: true },
		);
		expect(plain(error.render(80))[0]).toContain("invalid Mermaid syntax");
		const diagram = renderVisualizeResult(
			{
				content: [{ type: "text", text: "```mermaid\n…\n```" }],
				details: { type: "diagram", mermaid: FLOW },
			},
			options,
			theme,
			{ isError: false },
		);
		expect(diagram).toBeInstanceOf(DiagramComponent);
		const comparison = renderVisualizeResult(
			{
				content: [{ type: "text", text: "### A — ✅ Recommended\n\n**Pros:**\n- x" }],
				details: { type: "comparison", options: [{ name: "A" }] },
			},
			options,
			theme,
			{ isError: false },
		);
		const lines = plain(comparison.render(80)).join("\n");
		expect(lines).toContain("A");
		expect(lines).toContain("x");
	});
});
