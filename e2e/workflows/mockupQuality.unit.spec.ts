import { expect, test } from "@playwright/test";
import type { PiEvent } from "@thinkrail/contracts";
import { EventLog, runChecks } from "./harness";
import {
	advisoryProblems,
	bindingProblems,
	mockupArtifacts,
	mockupChecks,
	mockupSignals,
	visibleText,
} from "./mockupQuality";

function call(id: string, name: string, args: Record<string, unknown>, isError = false): PiEvent[] {
	return [
		{ type: "tool_execution_start", toolCallId: id, toolName: name, args } as PiEvent,
		{ type: "tool_execution_end", toolCallId: id, toolName: name, result: {}, isError } as PiEvent,
	];
}

function reply(text: string): PiEvent {
	return {
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }] },
	} as unknown as PiEvent;
}

const GOOD =
	'<style>.h{display:flex;color:#0f766e}</style><header class="h"><span>leafline</span><nav><a>Features</a></nav><input placeholder="Search"></header>';

function logOf(...events: PiEvent[][]): EventLog {
	const log = new EventLog();
	for (const event of events.flat()) log.push(event);
	return log;
}

test("mockupArtifacts collects visualize documents, question previews and reply fences, skipping errors", () => {
	const log = logOf(
		call("1", "visualize", { type: "mockup", before: "<p>a</p>", after: "<p>b</p>" }),
		call("2", "visualize", { type: "mockup", html: "<p>bad</p>" }, true),
		call("3", "visualize", {
			type: "comparison",
			options: [{ name: "A", html: "<p>A</p>" }, { name: "B" }],
		}),
		call("4", "ask_user_question", {
			questions: [{ options: [{ label: "X", preview: "Pick X\n\n```mockup\n<p>X</p>\n```" }] }],
		}),
		[reply("Here:\n\n~~~mockup\n<p>R</p>\n~~~\n\n```html\n<p>code sample</p>\n```")],
	);
	expect(mockupArtifacts(log).map((a) => [a.location, a.html])).toEqual([
		["visualize #1 before", "<p>a</p>"],
		["visualize #1 after", "<p>b</p>"],
		["visualize #3 options[0].html", "<p>A</p>"],
		["ask #1 q1 option 1 fence 1", "<p>X</p>"],
		["assistant reply 1 fence 1", "<p>R</p>"],
	]);
	expect(mockupSignals.shown().test(log)).toBe(true);
	expect(mockupSignals.shown().test(new EventLog())).toBe(false);
});

test("binding problems: empty, scripted, remote and oversized documents", () => {
	expect(bindingProblems(GOOD)).toEqual([]);
	expect(bindingProblems("<div><input></div>")).toEqual([]);
	expect(bindingProblems("<style>p{}</style><div>  </div>")).toEqual(["no visible content"]);
	expect(bindingProblems("<p>x</p><script>1</script>")).toEqual(["contains <script>"]);
	expect(bindingProblems('<img src="https://cdn.example/a.png" alt="x">')).toEqual([
		"loads an http(s) resource",
	]);
	expect(bindingProblems(`<p>${"x".repeat(256 * 1024)}</p>`)).toEqual(["over 256 KB"]);
	expect(visibleText("<head><title>T</title></head><!-- c --><p>Hi&nbsp;there</p>")).toBe(
		"Hi there",
	);
});

test("advisory problems: unstyled, thin, unbalanced and handler-laden markup", () => {
	expect(advisoryProblems(GOOD)).toEqual([]);
	expect(advisoryProblems("<div><p>x</p>")).toEqual([
		"no styling",
		"only 2 element(s)",
		"<div> opened 1× but closed 0×",
	]);
	expect(advisoryProblems(`${GOOD}<button onclick="go()">Go</button>`)).toContain(
		"uses on* event handlers",
	);
});

test("mockup checks report pairs, per-surface alternatives, validity and fidelity", () => {
	const log = logOf(
		call("1", "visualize", { type: "mockup", before: GOOD, after: GOOD }),
		call("2", "ask_user_question", {
			questions: [
				{
					options: [
						{ label: "A", preview: `\`\`\`mockup\n${GOOD}\n\`\`\`` },
						{ label: "B", preview: "```mockup\n<p>B</p>\n```" },
					],
				},
			],
		}),
	);
	const results = runChecks(
		[
			mockupChecks.shown(3),
			mockupChecks.pairShown(),
			mockupChecks.optionsShown(2),
			mockupChecks.valid(),
			mockupChecks.wellFormed(),
			mockupChecks.reuses("brand color", /#0f766e/),
		],
		{ log, cwd: "/unused" },
	);
	expect(results.map((r) => r.pass)).toEqual([true, true, true, true, false, true]);
	expect(results[4]?.detail).toContain("ask #1 q1 option 2 fence 1: no styling");
	expect(runChecks([mockupChecks.valid()], { log: new EventLog(), cwd: "/" })[0]?.pass).toBe(false);
});
