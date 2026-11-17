import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { ToolRenderer } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import { act, type ReactNode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { setErrorBoundaryReporter } from "../components/ErrorBoundary";
import { deriveInteractionStates } from "./interactionState";
import { deriveRows } from "./rows";
import { ToolRendererBoundary } from "./ToolRendererBoundary";
import {
	currentToolRegistry,
	DefaultToolRenderer,
	getToolRenderer,
	getToolSummary,
	isInteractiveTool,
	registerToolRenderer,
	removeInstalledToolRenderers,
	reserveInstalledOwner,
	resolveProminence,
	setInstalledToolRenderers,
	useToolRegistry,
	useToolRegistryRevision,
	useToolRenderer,
} from "./toolRegistry";
import type { ChatTurn } from "./types";

type ReactGlobals = { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined; window?: unknown };
const globals = globalThis as ReactGlobals;
const saved = { act: globals.IS_REACT_ACT_ENVIRONMENT, window: globals.window };

beforeAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	globals.window = {
		event: undefined,
		HTMLIFrameElement: class {},
		document: { activeElement: null },
	};
});
afterAll(() => {
	globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
	globals.window = saved.window;
});

function headlessContainer(): Element {
	const noop = () => {};
	return {
		nodeType: 1,
		nodeName: "DIV",
		tagName: "DIV",
		namespaceURI: "http://www.w3.org/1999/xhtml",
		textContent: "",
		addEventListener: noop,
		removeEventListener: noop,
		ownerDocument: { nodeType: 9, addEventListener: noop, removeEventListener: noop },
	} as unknown as Element;
}

async function mount(node: ReactNode) {
	const root = createRoot(headlessContainer());
	await act(async () => root.render(node));
	return { unmount: () => act(async () => root.unmount()) };
}

const renderer =
	(label: string): ToolRenderer =>
	() =>
		label;

const turns: ChatTurn[] = [
	{ kind: "user", id: "u1", message: { role: "user", content: "hi", timestamp: 0 } },
	{
		kind: "assistant",
		id: "a1",
		streaming: false,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "weather_late", arguments: {} }],
			stopReason: "toolUse",
			timestamp: 0,
		},
	} as unknown as ChatTurn,
];

describe("installed tool registrations", () => {
	test("publish a new immutable snapshot per change and keep built-ins ahead of installed ones", () => {
		const builtIn = renderer("built-in");
		registerToolRenderer("shared_name", builtIn);
		const before = currentToolRegistry();
		setInstalledToolRenderers("ext-a", {
			shared_name: { renderer: renderer("a") },
			only_a: { renderer: renderer("a-only"), options: { interactive: true } },
		});
		const after = currentToolRegistry();
		expect(after).not.toBe(before);
		expect(after.revision).toBeGreaterThan(before.revision);
		expect(getToolRenderer("only_a", before)).toBe(DefaultToolRenderer);
		expect(getToolRenderer("shared_name")).toBe(builtIn);
		expect(isInteractiveTool("only_a")).toBe(true);
		expect(removeInstalledToolRenderers("ext-a")).toBe(true);
		expect(removeInstalledToolRenderers("ext-a")).toBe(false);
		expect(getToolRenderer("only_a")).toBe(DefaultToolRenderer);
	});

	test("the first owner keeps a name across its updates, a replace drops dropped tools, and removal reveals the next owner", () => {
		const first = renderer("first");
		const firstUpdated = renderer("first, updated");
		const second = renderer("second");
		reserveInstalledOwner("ext-first");
		setInstalledToolRenderers("ext-second", {
			contested: { renderer: second },
			stale: { renderer: second },
		});
		expect(getToolRenderer("contested")).toBe(second);
		setInstalledToolRenderers("ext-first", { contested: { renderer: first } });
		expect(getToolRenderer("contested")).toBe(first);
		setInstalledToolRenderers("ext-first", { contested: { renderer: firstUpdated } });
		expect(getToolRenderer("contested")).toBe(firstUpdated);
		setInstalledToolRenderers("ext-second", { contested: { renderer: second } });
		expect(getToolRenderer("stale")).toBe(DefaultToolRenderer);
		removeInstalledToolRenderers("ext-first");
		expect(getToolRenderer("contested")).toBe(second);
		removeInstalledToolRenderers("ext-second");
	});
});

describe("registry hooks", () => {
	test("a mounted reader re-renders with a renderer registered and removed after first render", async () => {
		const seen: ToolRenderer[] = [];
		const revisions: number[] = [];
		function Reader() {
			seen.push(useToolRenderer("late_tool"));
			revisions.push(useToolRegistryRevision());
			return null;
		}
		const view = await mount(<Reader />);
		expect(seen.at(-1)).toBe(DefaultToolRenderer);
		const late = renderer("late");
		await act(async () => setInstalledToolRenderers("ext-late", { late_tool: { renderer: late } }));
		expect(seen.at(-1)).toBe(late);
		await act(async () => {
			removeInstalledToolRenderers("ext-late");
		});
		expect(seen.at(-1)).toBe(DefaultToolRenderer);
		expect(new Set(revisions).size).toBe(3);
		await view.unmount();
	});

	test("a late primary registration turns a routine activity step into a card row, and removal turns it back", async () => {
		const shapes: string[][] = [];
		const interactive: boolean[] = [];
		function Transcript() {
			const registry = useToolRegistry();
			const rows = useMemo(
				() => deriveRows(turns, {}, false, undefined, [], undefined, registry),
				[registry],
			);
			const states = useMemo(() => deriveInteractionStates(turns, {}, {}, registry), [registry]);
			shapes.push(rows.filter((row) => row.kind !== "divider").map((row) => row.kind));
			interactive.push("call-1" in states);
			return null;
		}
		const view = await mount(<Transcript />);
		expect(shapes.at(-1)).toEqual(["user", "activity"]);
		expect(interactive.at(-1)).toBe(false);
		await act(async () =>
			setInstalledToolRenderers("ext-weather", {
				weather_late: {
					renderer: renderer("card"),
					options: { prominence: "primary", interactive: true },
				},
			}),
		);
		expect(shapes.at(-1)).toEqual(["user", "tool"]);
		expect(interactive.at(-1)).toBe(true);
		expect(resolveProminence("weather_late").prominence).toBe("primary");
		await act(async () => {
			removeInstalledToolRenderers("ext-weather");
		});
		expect(shapes.at(-1)).toEqual(["user", "activity"]);
		expect(interactive.at(-1)).toBe(false);
		await view.unmount();
	});
});

describe("ToolRendererBoundary", () => {
	test("a throwing renderer falls back for its row only, reports once per renderer, and resets on a new renderer or call", async () => {
		const reports: Array<string | undefined> = [];
		setErrorBoundaryReporter((_error, reportId) => reports.push(reportId));
		const consoleError = spyOn(console, "error").mockImplementation(() => {});
		const rendered: string[] = [];
		const Mark = ({ label }: { label: string }) => {
			rendered.push(label);
			return null;
		};
		const broken: ToolRenderer = () => {
			throw new Error("card exploded with a secret path");
		};
		const healthy: ToolRenderer = () => <Mark label="healthy" />;
		const row = (renderer: ToolRenderer, toolCallId: string, label: string) => {
			const Renderer = renderer;
			return (
				<ToolRendererBoundary
					key={label}
					renderer={renderer}
					toolCallId={toolCallId}
					fallback={<Mark label={`fallback:${label}`} />}
				>
					<Renderer
						toolCallId={toolCallId}
						toolName="t"
						args={{}}
						result={null}
						status="done"
						streaming={false}
					/>
				</ToolRendererBoundary>
			);
		};
		const root = createRoot(headlessContainer(), { onCaughtError: () => {} });
		try {
			await act(async () =>
				root.render([
					row(broken, "c1", "one"),
					row(broken, "c2", "two"),
					row(healthy, "c3", "three"),
				]),
			);
			expect(rendered).toContain("fallback:one");
			expect(rendered).toContain("fallback:two");
			expect(rendered).toContain("healthy");
			expect(reports).toEqual(["tool-renderer"]);
			rendered.length = 0;
			await act(async () => root.render([row(healthy, "c1", "one")]));
			expect(rendered).toEqual(["healthy"]);
			rendered.length = 0;
			await act(async () => root.render([row(broken, "c1", "one")]));
			expect(new Set(rendered)).toEqual(new Set(["fallback:one"]));
			rendered.length = 0;
			const brokenOnFirstCall: ToolRenderer = ({ toolCallId }) => {
				if (toolCallId === "c1") throw new Error("first call only");
				return <Mark label="second call" />;
			};
			await act(async () => root.render([row(brokenOnFirstCall, "c1", "one")]));
			expect(rendered.at(-1)).toBe("fallback:one");
			await act(async () => root.render([row(brokenOnFirstCall, "c2", "one")]));
			expect(rendered.at(-1)).toBe("second call");
			expect(reports).toEqual(["tool-renderer", "tool-renderer"]);
		} finally {
			await act(async () => root.unmount());
			setErrorBoundaryReporter(null);
			consoleError.mockRestore();
		}
	});

	test("a throwing summary reads as no summary and reports once", () => {
		const reports: Array<string | undefined> = [];
		setErrorBoundaryReporter((_error, reportId) => reports.push(reportId));
		try {
			registerToolRenderer("throwing_summary", renderer("x"), {
				summary: () => {
					throw new Error("summary exploded");
				},
			});
			const props = {
				toolCallId: "s1",
				toolName: "throwing_summary",
				args: {},
				result: null,
				status: "done" as const,
				streaming: false,
			};
			expect(getToolSummary(currentTranslator(), "throwing_summary", props)).toBe("");
			expect(getToolSummary(currentTranslator(), "throwing_summary", props)).toBe("");
			expect(reports).toEqual(["tool-summary"]);
		} finally {
			setErrorBoundaryReporter(null);
		}
	});
});
