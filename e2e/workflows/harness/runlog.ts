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
	skill: string;
	deterministic: { pass: boolean; failed: string[]; checks: CheckResult[] };
	judge: JudgeResult | null;
	dialog: { rung: DialogRung; cancelled: boolean; error?: string }[];
	durationMs: number;
	aborted: boolean;
	crashed?: string;
	notes: string;
}

export function appendRunRecord(record: RunRecord): void {
	appendFileSync(process.env.THINKRAIL_WORKFLOW_RUNLOG ?? RUN_LOG, `${JSON.stringify(record)}\n`);
}
