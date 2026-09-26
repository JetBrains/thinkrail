import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { loadJournal, safeStringify } from "./journal";
import { clip, clipTail, isWorkflowRun, type WorkflowRun } from "./model";

export const STORE_KEY = "runs";
export const KEPT_RUNS = 20;
const PROMPT_CHARS = 1_500;
const OUTPUT_CHARS = 1_500;
const VALUE_CHARS = 4_000;
const RUN_ID = /^uc_[\w-]+$/;

export const runsRoot = () =>
	path.join(
		process.env.THINKRAIL_DATA_DIR ?? path.join(homedir(), ".thinkrail"),
		"ultracode",
		"runs",
	);

export const journalDirOf = (runId: string) => path.join(runsRoot(), runId);

const capValue = (value: unknown) => {
	if (value === undefined) return undefined;
	const json = safeStringify(value, 0);
	return json.length > VALUE_CHARS ? clip(json, VALUE_CHARS) : value;
};

export const compactRun = (run: WorkflowRun): WorkflowRun => {
	const result = capValue(run.result);
	const args = capValue(run.args);
	const { result: _result, args: _args, ...rest } = run;
	return {
		...rest,
		...(result !== undefined ? { result } : {}),
		...(args !== undefined ? { args } : {}),
		logs: run.logs.slice(-50),
		agents: run.agents.map(({ result: agentResult, ...agent }) => {
			const capped = capValue(agentResult);
			return {
				...agent,
				prompt: clip(agent.prompt, PROMPT_CHARS),
				...(agent.output !== undefined ? { output: clipTail(agent.output, OUTPUT_CHARS) } : {}),
				...(capped !== undefined ? { result: capped } : {}),
			};
		}),
	};
};

const interrupted = (run: WorkflowRun): WorkflowRun =>
	run.status === "running"
		? {
				...run,
				status: "aborted",
				error: run.error ?? "The host stopped while this run was going.",
				agents: run.agents.map((agent) =>
					agent.state === "running" || agent.state === "queued"
						? { ...agent, state: "aborted" }
						: agent,
				),
			}
		: run;

export const readRuns = (value: unknown) =>
	Array.isArray(value) ? value.filter(isWorkflowRun).slice(0, KEPT_RUNS).map(interrupted) : [];

export const mergeRuns = (first: readonly WorkflowRun[], second: readonly WorkflowRun[]) => {
	const seen = new Set<string>();
	return [...first, ...second]
		.filter((run) => !seen.has(run.runId) && seen.add(run.runId))
		.sort((a, b) => b.startedAt - a.startedAt)
		.slice(0, KEPT_RUNS);
};

export const pruneJournals = (keep: ReadonlySet<string>) => {
	const root = runsRoot();
	let entries: string[];
	try {
		entries = fs.readdirSync(root);
	} catch {
		return;
	}
	for (const entry of entries)
		if (RUN_ID.test(entry) && !keep.has(entry))
			fs.rmSync(path.join(root, entry), { recursive: true, force: true });
};

export const openReplay = (runId: string, retryFailed: boolean) => {
	if (!RUN_ID.test(runId)) throw new Error(`Not a valid Ultracode run id: ${runId}`);
	const file = path.join(journalDirOf(runId), "journal.jsonl");
	let replay: ReturnType<typeof loadJournal>;
	try {
		replay = loadJournal(file, { retryFailed });
	} catch {
		throw new Error(`Cannot resume ${runId}: no journal at ${file}`);
	}
	const { loaded, skipped } = replay.stats();
	if (loaded === 0)
		throw new Error(
			`Cannot resume ${runId}: its journal holds no reusable agent results` +
				`${retryFailed ? " once resumeRetryFailed drops the failed ones" : ""}. Run the script without resumeFromRunId.`,
		);
	return {
		replay,
		note: `⟲ resuming ${runId}: up to ${loaded} results reused${skipped > 0 ? ` (${skipped} unreadable journal lines skipped)` : ""}`,
	};
};
