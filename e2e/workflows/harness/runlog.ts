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
