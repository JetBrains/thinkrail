import { afterAll, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { tempDir } from "../test/builders.ts";
import { alignmentPage, alignSessions } from "./align.ts";
import { buildSessionAnalysis } from "./analysis.ts";
import { compareSlices } from "./compare.ts";
import { buildContextView } from "./context.ts";
import { buildSessionCost } from "./costWhy.ts";
import { statsScope } from "./crossSession.ts";
import { DigestStore, digestOf } from "./digest.ts";
import { buildSessionFiles } from "./files.ts";
import { buildFindings } from "./findings.ts";
import { buildHotspots } from "./hotspots.ts";
import { buildSessionsList } from "./list.ts";
import { createRedactor } from "./redact.ts";
import { buildSequences } from "./sequences.ts";
import { SessionIndex } from "./sessionIndex.ts";
import { summarizeSessionText } from "./summary.ts";
import { buildSessionTimeline } from "./timeline.ts";
import { recordedTotals } from "./totals.ts";
import type { BuiltTrace } from "./trace.ts";
import { TraceStore } from "./traceStore.ts";
import { buildUsage } from "./usage.ts";

const FIXTURE = join(
	import.meta.dir,
	"../../../e2e/workflows/fixtures/brainstorming-mid-flow/session.jsonl",
);
const GOLDEN = join(import.meta.dir, "../test/golden/brainstorming-mid-flow.json");
const root = tempDir("golden");

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The fixture aligned with itself, revisions blanked like the trace's. */
async function selfAlignment(trace: BuiltTrace) {
	const page = alignmentPage(
		await alignSessions({ sessionId: "a", trace }, { sessionId: "b", trace }),
		0,
	);
	return { ...page, a: { ...page.a, revision: "" }, b: { ...page.b, revision: "" } };
}

async function analyse(run: string): Promise<string> {
	const text = readFileSync(FIXTURE, "utf8");
	const dir = join(root, run, "--tmp-thinkrail-e2e-workflow-ws-1--");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "session.jsonl");
	copyFileSync(FIXTURE, file);
	const index = new SessionIndex({
		sessionFiles: async () => [file],
		childTranscriptDirs: async () => [],
	});
	const state = await index.ensureFresh(10_000);
	const listInput = {
		index,
		projects: [{ id: "p1", name: "Workflow", kind: "repository" as const }],
		place: () => ({
			projectId: "p1",
			workspaceId: "w1",
			workspaceName: "workflow-ws-1",
			workspace: "open" as const,
		}),
		status: () => ({ live: false, outcome: "interrupted" as const }),
	};
	const list = await buildSessionsList(listInput, state);
	const summary = summarizeSessionText("session.jsonl", text);
	const store = new TraceStore({ redactor: createRedactor("/home/fixture") });
	const built = await store.trace(file);
	const statsInput = {
		...listInput,
		digests: new DigestStore(async (indexed) => {
			const trace = await store.trace(indexed.file);
			return trace ? digestOf(trace, indexed) : null;
		}),
		contextWindow: async () => 200_000,
		budgetMs: 60_000,
	};
	const scope = await statsScope(statsInput, state);
	const stats = {
		usage: await buildUsage(statsInput, scope.ready),
		hotspots: buildHotspots(scope.ready, "touches", listInput.projects),
		findings: await buildFindings(statsInput, scope.ready, new Set(), store.redaction),
		sequences: buildSequences(scope.ready),
		compare: await compareSlices(
			scope.ready,
			{ scope: { kind: "all" }, by: "model" },
			listInput.projects,
		),
		alignment: built ? await selfAlignment(built) : null,
	};
	const trace = built ? { meta: { ...built.meta, revision: "" }, events: built.events } : null;
	const timeline = built
		? {
				...(await buildSessionTimeline(built, { contextWindow: async () => 200_000 })),
				revision: "",
			}
		: null;
	const analysis = built ? { ...buildSessionAnalysis(built, []), revision: "" } : null;
	const window = { contextWindow: async () => 200_000 };
	const context = built ? { ...(await buildContextView(built, window)), revision: "" } : null;
	const cost = built ? { ...(await buildSessionCost(built, window)), revision: "" } : null;
	const files = built ? { ...buildSessionFiles(built), revision: "" } : null;
	return `${JSON.stringify({ summary, list, trace, timeline, analysis, context, cost, files, stats }, null, "\t")}\n`;
}

test("the brainstorming fixture analyses to the committed golden, identically on every run", async () => {
	const first = await analyse("first");
	const second = await analyse("second");
	expect(second).toBe(first);
	expect(JSON.parse(first)).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
});

test("the fixture's headline totals equal pi's own parse", () => {
	const text = readFileSync(FIXTURE, "utf8");
	const summary = summarizeSessionText("session.jsonl", text);
	expect(summary?.spend).toEqual(recordedTotals(parseSessionEntries(text)));
	expect(summary?.counts).toMatchObject({ userMessages: 1, assistantMessages: 5, toolResults: 5 });
	expect(Object.keys(summary?.models ?? {})).toEqual(["anthropic/claude-opus-4-8"]);
});
