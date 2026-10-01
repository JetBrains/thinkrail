import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	FIELDS,
	formatLintFinding,
	type LintFinding,
	type LintReport,
	lintSpecs,
	SpecIndex,
	scalar,
} from "pi-spec-graph/core";

export const BASELINE_FILE = "scripts/spec-lint-baseline.json";
const EPHEMERAL_TYPE = "task-spec";

export type LintCounts = Record<string, Record<string, number>>;

export interface CountDelta {
	path: string;
	rule: string;
	count: number;
	allowed: number;
}

export interface RatchetResult {
	regressions: CountDelta[];
	improvements: CountDelta[];
}

export function collectLint(root: string): LintReport {
	const entries = new SpecIndex(root)
		.contentEntries()
		.filter((e) => scalar(e.frontmatter, FIELDS.type) !== EPHEMERAL_TYPE)
		.sort((a, b) => a.path.localeCompare(b.path));
	return lintSpecs(entries);
}

export function countFindings(findings: readonly LintFinding[]): LintCounts {
	const counts: LintCounts = {};
	for (const f of findings) {
		const perRule = counts[f.path] ?? {};
		perRule[f.rule] = (perRule[f.rule] ?? 0) + 1;
		counts[f.path] = perRule;
	}
	const sorted: LintCounts = {};
	for (const path of Object.keys(counts).sort()) {
		const perRule = counts[path] ?? {};
		sorted[path] = Object.fromEntries(
			Object.keys(perRule)
				.sort()
				.map((rule) => [rule, perRule[rule] ?? 0]),
		);
	}
	return sorted;
}

export function compareToBaseline(current: LintCounts, baseline: LintCounts): RatchetResult {
	const regressions: CountDelta[] = [];
	const improvements: CountDelta[] = [];
	const paths = new Set([...Object.keys(current), ...Object.keys(baseline)]);
	for (const path of [...paths].sort()) {
		const now = current[path] ?? {};
		const was = baseline[path] ?? {};
		const rules = new Set([...Object.keys(now), ...Object.keys(was)]);
		for (const rule of [...rules].sort()) {
			const count = now[rule] ?? 0;
			const allowed = was[rule] ?? 0;
			if (count > allowed) regressions.push({ path, rule, count, allowed });
			else if (count < allowed) improvements.push({ path, rule, count, allowed });
		}
	}
	return { regressions, improvements };
}

export function readBaseline(root: string): LintCounts {
	const file = join(root, BASELINE_FILE);
	if (!existsSync(file)) return {};
	return JSON.parse(readFileSync(file, "utf8")) as LintCounts;
}

export function writeBaseline(root: string, counts: LintCounts): void {
	writeFileSync(join(root, BASELINE_FILE), `${JSON.stringify(counts, null, "\t")}\n`);
}

export interface SpecLintRunOptions {
	updateBaseline?: boolean;
	stdout?: (line: string) => void;
	stderr?: (line: string) => void;
}

export function runSpecLintCheck(root: string, options: SpecLintRunOptions = {}): 0 | 1 {
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	const report = collectLint(root);
	const current = countFindings(report.findings);
	const total = report.findings.length;
	const files = Object.keys(current).length;
	const summary = `${report.checked} specs checked; ${total} structure findings in ${files} file${files === 1 ? "" : "s"}`;

	if (options.updateBaseline) {
		writeBaseline(root, current);
		stdout(`check-spec-lint: baseline written to ${BASELINE_FILE} (${summary}).`);
		return 0;
	}

	const { regressions, improvements } = compareToBaseline(current, readBaseline(root));
	if (regressions.length > 0) {
		stderr("Spec structure regressions (over the ratchet baseline):");
		for (const r of regressions) {
			stderr(`  - ${r.path} [${r.rule}]: ${r.count} (baseline ${r.allowed})`);
			for (const f of report.findings) {
				if (f.path === r.path && f.rule === r.rule) stderr(`      ${formatLintFinding(f)}`);
			}
		}
		stderr(
			`\n${summary}. Fix the spec so its count returns to the baseline, or split it; raising the baseline is a reviewed decision (\`bun run check:spec-lint --update-baseline\`).`,
		);
		return 1;
	}
	if (improvements.length > 0) {
		stderr(
			"Spec structure baseline is looser than the specs; tighten it so the gain cannot regress:",
		);
		for (const i of improvements) {
			stderr(`  - ${i.path} [${i.rule}]: ${i.count} (baseline ${i.allowed})`);
		}
		stderr(
			`\n${summary}. Run \`bun run check:spec-lint --update-baseline\` and commit the result.`,
		);
		return 1;
	}
	stdout(`check-spec-lint: OK (${summary}; baseline holds).`);
	return 0;
}
