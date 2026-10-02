import { beforeAll, describe, expect, test } from "bun:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
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
const OVER_SIZE_CAP = `flowchart LR\n${Array.from({ length: 140 }, (_, i) => `  N${i} --> N${i + 1}`).join("\n")}`;

beforeAll(() => initTheme("dark", false));

function plain(lines: string[]): string[] {
	return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

function drawn(source: string, width = 200): string[] | undefined {
	const lines = plain(new DiagramComponent(source, undefined, false, theme).render(width));
	return lines.some((line) => line.includes("```")) ? undefined : lines;
}

describe("fitsWidth", () => {
	test("accepts rows within the width, measured in terminal cells", () => {
		expect(fitsWidth(["┌───┐", "│ A │"], 5)).toBe(true);
		expect(fitsWidth(["┌───┐", "│ A │"], 4)).toBe(false);
		expect(fitsWidth(["│ 数据库 │"], 10)).toBe(true);
		expect(fitsWidth(["│ 数据库 │"], 9)).toBe(false);
	});
});

describe("DiagramComponent", () => {
	test("draws every family the renderer knows, also behind frontmatter, directives and comments", () => {
		const sources = [
			"flowchart LR\n A --> B",
			"stateDiagram-v2\n [*] --> A",
			"sequenceDiagram\n A->>B: hi",
			"classDiagram\n A <|-- B",
			"erDiagram\n A ||--o{ B : has",
			'pie\n "a": 1\n "b": 3',
			"mindmap\n root\n  a",
			"timeline\n 2020 : a",
			"gitGraph\n commit\n branch dev\n commit",
		];
		for (const source of sources) {
			for (const prefix of ["", "%% note\n\n", "%%{init: {}}%%\n", "---\ntitle: T\n---\n"]) {
				expect(drawn(`${prefix}${source}`)).toBeDefined();
			}
		}
	});

	test("keeps every label of back-and-forth and parallel edges between the same nodes", () => {
		const cases: Array<[string, string[]]> = [
			[
				"flowchart LR\n  U[User] -->|1. Click login| A[App]\n  A -->|8. Logged in| U",
				["1. Click login", "8. Logged in"],
			],
			["flowchart LR\n  A -->|one| B\n  A -->|two| B", ["one", "two"]],
			["stateDiagram-v2\n  Idle --> Running: start\n  Running --> Idle: stop", ["start", "stop"]],
			["classDiagram\n  A --> B : uses\n  B --> A : owns", ["uses", "owns"]],
			["erDiagram\n  A ||--o{ B : has\n  B }o--|| A : belongs", ["has", "belongs"]],
		];
		for (const [source, labels] of cases) {
			const text = drawn(source)?.join("\n");
			for (const label of labels) expect(text).toContain(label);
		}
	});

	test("draws wide-character labels within the viewport", () => {
		const lines = drawn("flowchart LR\n A[数据库] --> B[End]", 40);
		expect(lines?.some((line) => line.includes("数据库"))).toBe(true);
		for (const line of lines ?? []) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("paints span roles with the pi theme colours", () => {
		const tagging = {
			fg: (color: string, text: string) => `<${color}>${text}`,
			bold: (text: string) => text,
		} as unknown as Theme;
		const text = new DiagramComponent(FLOW, undefined, false, tagging).render(120).join("\n");
		for (const color of ["borderMuted", "text", "accent", "muted"]) {
			expect(text).toContain(`<${color}>`);
		}
	});

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

	test("falls back to the source fence for an incomplete drawing and unknown families", () => {
		for (const source of [
			OVER_SIZE_CAP,
			"flowchart LR\n  A --> B\n  C -->",
			"gantt\n title X",
			"xychart-beta\n x-axis [a, b]\n bar [3, 7]",
		]) {
			const lines = plain(new DiagramComponent(source, undefined, false, theme).render(200));
			expect(lines.some((line) => line.includes("```"))).toBe(true);
			expect(lines.some((line) => line.includes(source.split("\n")[0] as string))).toBe(true);
		}
	});

	test("never emits a row wider than the viewport, including long titles and long source lines", () => {
		const longTitle = "A very long descriptive title that certainly does not fit a narrow terminal";
		const longSource = `flowchart LR\n  A[${"x".repeat(60)}] --> B[${"y".repeat(60)}]`;
		for (const width of [20, 40, 80]) {
			for (const expanded of [false, true]) {
				const lines = new DiagramComponent(longSource, longTitle, expanded, theme).render(width);
				for (const line of lines)
					expect(visibleWidth(stripTerminalSequences(line))).toBeLessThanOrEqual(width);
			}
		}
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
		const narrow = renderVisualizeCall(
			{
				type: "diagram",
				mermaid: FLOW,
				title: "A very long title that does not fit in twenty columns",
			},
			theme,
		).render(20);
		expect(narrow).toHaveLength(1);
		expect(visibleWidth(stripTerminalSequences(narrow[0] as string))).toBeLessThanOrEqual(20);
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
