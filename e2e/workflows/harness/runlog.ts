// The evidence trail — one JSON line per scenario run, appended to e2e/.workflow-runs.jsonl. In-repo but
// gitignored (../SPEC.md § runlog: local evidence by decision, not a committed record), and OUTSIDE
// E2E_DATA_DIR so it survives global teardown and accumulates across runs. Append-only; never read back
// by the harness (THINKRAIL_WORKFLOW_RUNLOG redirects it so unit tests can assert on records without
// polluting the local evidence log).
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CheckResult } from "./checks";
import type { DialogRung } from "./dialog";
import type { JudgeResult } from "./judge";

const RUN_LOG = fileURLToPath(new URL("../../.workflow-runs.jsonl", import.meta.url));

export interface RunRecord {
	at: string;
	model: string;
	scenario: string;
	/** The workflow skill this scenario verifies — family-table attribution. */
	skill: string;
	deterministic: { pass: boolean; failed: string[]; checks: CheckResult[] };
	judge: JudgeResult | null;
	/** Which ladder rung answered each ask_user_question round (script/persona/fallback). */
	dialog: { rung: DialogRung; cancelled: boolean; error?: string }[];
	durationMs: number;
	aborted: boolean;
	/** Set when the run threw before its verdict (provider/auth/fixture failure) — never a silent pass. */
	crashed?: string;
	notes: string;
}

export function appendRunRecord(record: RunRecord): void {
	appendFileSync(process.env.THINKRAIL_WORKFLOW_RUNLOG ?? RUN_LOG, `${JSON.stringify(record)}\n`);
}

export interface AggregatedRunRecord {
	at: string;
	model: string;
	scenario: string;
	skill: string;
	runs: number;
	deterministic: { passRate: number; failed: string[] };
	judge: { items: { statement: string; passRate: number }[] } | null;
	durationMsAvg: number;
	abortedRate: number;
	crashes: number;
	notes: string;
}

export function appendAggregatedRunRecord(records: RunRecord[]): void {
	if (records.length === 0) return;
	const at = records[0].at;
	const model = records[0].model;
	const scenario = records[0].scenario;
	const skill = records[0].skill;
	const runs = records.length;

	const passes = records.filter((r) => r.deterministic.pass).length;
	const passRate = passes / runs;

	const failedSet = new Set<string>();
	for (const r of records) {
		for (const f of r.deterministic.failed) failedSet.add(f);
	}

	let judge: AggregatedRunRecord["judge"] = null;
	const validJudges = records.filter((r) => r.judge !== null).map((r) => r.judge!);
	if (validJudges.length > 0) {
		const statements = validJudges[0].items.map((i) => i.statement);
		const items = statements.map((statement) => {
			let statementPasses = 0;
			let total = 0;
			for (const j of validJudges) {
				const item = j.items.find((i) => i.statement === statement);
				if (item) {
					total++;
					if (item.verdict === "pass") statementPasses++;
				}
			}
			return { statement, passRate: total > 0 ? statementPasses / total : 0 };
		});
		judge = { items };
	}

	const durationMsAvg = records.reduce((sum, r) => sum + r.durationMs, 0) / runs;
	const abortedRate = records.filter((r) => r.aborted).length / runs;
	const crashes = records.filter((r) => !!r.crashed).length;

	const aggregated: AggregatedRunRecord = {
		at,
		model,
		scenario,
		skill,
		runs,
		deterministic: { passRate, failed: Array.from(failedSet) },
		judge,
		durationMsAvg,
		abortedRate,
		crashes,
		notes: `Aggregated ${runs} runs`,
	};
	appendFileSync(process.env.THINKRAIL_WORKFLOW_RUNLOG ?? RUN_LOG, `${JSON.stringify(aggregated)}\n`);
}
