import { stripVTControlCharacters } from "node:util";

export interface CiRun {
	id: number;
	event: string;
	branch: string;
	pr: number | null;
	sha: string;
	attempt: number;
	conclusion: string | null;
	createdAt: string;
}

export interface CiJob {
	id: number;
	runId: number;
	attempt: number;
	name: string;
	conclusion: string | null;
	failedSteps: string[];
}

export interface TestFailure {
	file: string | null;
	title: string;
	kind: "failed" | "flaky";
}

export interface JobReport {
	job: CiJob;
	tests: TestFailure[];
}

export interface TestStats {
	file: string | null;
	title: string;
	failed: number;
	flaky: number;
	changes: Set<string>;
	mergeQueue: number;
	mergeQueueChanges: Set<string>;
	rerunConfirmed: number;
	lastSeen: string;
	jobs: Set<string>;
}

export interface StepStats {
	job: string;
	step: string;
	count: number;
	changes: Set<string>;
	lastSeen: string;
}

export interface FlakeReport {
	since: string;
	runs: number;
	failedAttempts: number;
	flakeOnlyAttempts: number;
	flakes: TestStats[];
	likelyGenuine: TestStats[];
	steps: StepStats[];
}

const AGGREGATE_JOB = "CI passed";
const TEST_STEP = /\btest\b|e2e|smoke|check:pi-packages/i;

const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const BUN_FILE = /^(?:##\[group\])?((?:[\w@.-]+[\\/])*[\w.-]+\.test\.tsx?):$/;
const BUN_FAIL = /^\s*\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/;
const BUN_SUMMARY = /^\d+ tests? failed:$/;
const MERGE_QUEUE_PR = /^gh-readonly-queue\/[^/]+\/pr-(\d+)-/;
const PLAYWRIGHT_SECTION = /^\s+\d+ (failed|flaky)$/;
const PLAYWRIGHT_TEST = /^\s+\[[\w-]+\] › (\S+?):\d+:\d+ › (.+?)[\s─]*$/;

export function logLines(text: string): string[] {
	return text.split(/\r?\n/).map((line) => stripVTControlCharacters(line).replace(TIMESTAMP, ""));
}

export function parseTestFailures(text: string): TestFailure[] {
	const found = new Map<string, TestFailure>();
	let file: string | null = null;
	let bunSummary = false;
	let section: TestFailure["kind"] | null = null;
	for (const line of logLines(text)) {
		const fileMatch = BUN_FILE.exec(line.trim());
		if (fileMatch) {
			file = fileMatch[1]?.replaceAll("\\", "/") ?? null;
			bunSummary = false;
		}
		if (BUN_SUMMARY.test(line.trim())) {
			bunSummary = true;
			continue;
		}
		const bunFail = BUN_FAIL.exec(line);
		if (bunFail?.[1]) {
			const title = bunFail[1];
			const known = [...found.values()].some(
				(test) => test.kind === "failed" && test.title === title,
			);
			if (bunSummary && !known)
				found.set(`failed::${title}`, { file: null, title, kind: "failed" });
			if (!bunSummary && !found.has(`failed:${file ?? ""}:${title}`)) {
				found.set(`failed:${file ?? ""}:${title}`, { file, title, kind: "failed" });
			}
			continue;
		}
		const sectionMatch = PLAYWRIGHT_SECTION.exec(line);
		if (sectionMatch) {
			section = sectionMatch[1] === "flaky" ? "flaky" : "failed";
			continue;
		}
		if (!section) continue;
		const testMatch = PLAYWRIGHT_TEST.exec(line);
		if (testMatch?.[1] && testMatch[2]) {
			const key = `${section}:${testMatch[1]} › ${testMatch[2]}`;
			if (!found.has(key)) {
				found.set(key, { file: testMatch[1], title: testMatch[2], kind: section });
			}
			continue;
		}
		if (line.trim() && !line.startsWith("    ")) section = null;
	}
	return [...found.values()];
}

export function isTestJob(job: CiJob): boolean {
	return job.failedSteps.some((step) => TEST_STEP.test(step));
}

export function baseJobName(name: string): string {
	return name.replace(/ shard \d+\/\d+$/, "");
}

export function changeOf(run: CiRun): string {
	if (run.pr !== null) return `#${run.pr}`;
	const queued = MERGE_QUEUE_PR.exec(run.branch)?.[1];
	return queued ? `#${queued}` : run.branch;
}

function passedOnSameSha(job: CiJob, runs: Map<number, CiRun>, jobs: CiJob[]): boolean {
	const sha = runs.get(job.runId)?.sha;
	if (!sha) return false;
	for (const run of runs.values()) if (run.sha === sha && run.conclusion === "success") return true;
	return jobs.some(
		(other) =>
			other.name === job.name &&
			other.conclusion === "success" &&
			runs.get(other.runId)?.sha === sha,
	);
}

export function isFlake(stats: TestStats): boolean {
	return (
		stats.rerunConfirmed > 0 ||
		stats.flaky > 0 ||
		stats.changes.size >= 3 ||
		stats.mergeQueueChanges.size >= 2
	);
}

function flakeScore(stats: TestStats): number {
	return stats.rerunConfirmed * 3 + stats.mergeQueue * 2 + stats.changes.size * 2 + stats.flaky;
}

export function buildReport(
	since: string,
	runList: CiRun[],
	jobs: CiJob[],
	reports: JobReport[],
): FlakeReport {
	const runs = new Map(runList.map((run) => [run.id, run]));
	const tests = new Map<string, TestStats>();
	for (const { job, tests: failures } of reports) {
		const run = runs.get(job.runId);
		if (!run) continue;
		const confirmed = passedOnSameSha(job, runs, jobs);
		for (const failure of failures) {
			const key = `${failure.file ?? ""} › ${failure.title}`;
			const stats = tests.get(key) ?? {
				file: failure.file,
				title: failure.title,
				failed: 0,
				flaky: 0,
				changes: new Set<string>(),
				mergeQueue: 0,
				mergeQueueChanges: new Set<string>(),
				rerunConfirmed: 0,
				lastSeen: run.createdAt,
				jobs: new Set<string>(),
			};
			tests.set(key, stats);
			stats.jobs.add(baseJobName(job.name));
			if (run.createdAt > stats.lastSeen) stats.lastSeen = run.createdAt;
			if (failure.kind === "flaky") {
				stats.flaky += 1;
				continue;
			}
			stats.failed += 1;
			stats.changes.add(changeOf(run));
			if (run.event === "merge_group") {
				stats.mergeQueue += 1;
				stats.mergeQueueChanges.add(changeOf(run));
			}
			if (confirmed) stats.rerunConfirmed += 1;
		}
	}

	const steps = new Map<string, StepStats>();
	const attempts = new Map<string, { flakeOnly: boolean }>();
	const reportByJob = new Map(reports.map((report) => [report.job.id, report]));
	for (const job of jobs) {
		if (job.conclusion !== "failure" || job.name === AGGREGATE_JOB) continue;
		const run = runs.get(job.runId);
		if (!run) continue;
		const attemptKey = `${job.runId}:${job.attempt}`;
		const attempt = attempts.get(attemptKey) ?? { flakeOnly: true };
		attempts.set(attemptKey, attempt);
		const failing = (reportByJob.get(job.id)?.tests ?? []).filter((test) => test.kind === "failed");
		const unexplained =
			isTestJob(job) && failing.length > 0
				? job.failedSteps.filter((step) => !TEST_STEP.test(step))
				: job.failedSteps;
		if (unexplained.length > 0 || failing.length === 0) attempt.flakeOnly = false;
		for (const step of unexplained) {
			const key = `${baseJobName(job.name)} › ${step}`;
			const stats = steps.get(key) ?? {
				job: baseJobName(job.name),
				step,
				count: 0,
				changes: new Set<string>(),
				lastSeen: run.createdAt,
			};
			steps.set(key, stats);
			stats.count += 1;
			stats.changes.add(changeOf(run));
			if (run.createdAt > stats.lastSeen) stats.lastSeen = run.createdAt;
		}
		for (const failure of failing) {
			const stats = tests.get(`${failure.file ?? ""} › ${failure.title}`);
			if (!stats || !isFlake(stats)) attempt.flakeOnly = false;
		}
	}

	const ranked = [...tests.values()].sort((a, b) => flakeScore(b) - flakeScore(a));
	return {
		since,
		runs: runList.length,
		failedAttempts: attempts.size,
		flakeOnlyAttempts: [...attempts.values()].filter((attempt) => attempt.flakeOnly).length,
		flakes: ranked.filter(isFlake),
		likelyGenuine: ranked.filter((stats) => !isFlake(stats)),
		steps: [...steps.values()].sort((a, b) => b.count - a.count),
	};
}

const cell = (text: string) => text.replaceAll("|", "\\|");
const day = (iso: string) => iso.slice(0, 10);

function testRow(stats: TestStats): string {
	const name = stats.file ? `\`${stats.file}\` › ${stats.title}` : stats.title;
	return `| ${cell(name)} | ${stats.failed} | ${stats.flaky} | ${stats.changes.size} | ${stats.mergeQueue} | ${stats.rerunConfirmed} | ${day(stats.lastSeen)} | ${cell([...stats.jobs].sort().join(", "))} |`;
}

export function renderReport(report: FlakeReport): string {
	const share =
		report.failedAttempts === 0
			? 0
			: Math.round((100 * report.flakeOnlyAttempts) / report.failedAttempts);
	const header =
		"| Test | Failed | Flaky | Changes | Merge queue | Rerun passed | Last seen | Jobs |\n|---|---:|---:|---:|---:|---:|---|---|";
	const lines = [
		`# CI flakes since ${report.since}`,
		"",
		`${report.runs} runs; ${report.failedAttempts} failed attempts, ${report.flakeOnlyAttempts} (${share}%) failed only on flake-classified tests.`,
		"",
		"A change is a PR (its PR runs and merge-queue entries count once) or, without a PR, a branch. A test is flake-classified when a later run of the same SHA passed its job, Playwright marked it flaky (failed, then passed on retry), it failed for 3+ changes, or it failed in the merge queue for 2+ changes. Flaky counts come from failed jobs' logs only; a flaky test in an otherwise green job is not seen.",
		"",
		"## Flaky tests",
		"",
		...(report.flakes.length ? [header, ...report.flakes.map(testRow)] : ["None."]),
		"",
		"## Other test failures (no flake evidence: probably genuine)",
		"",
		...(report.likelyGenuine.length ? [header, ...report.likelyGenuine.map(testRow)] : ["None."]),
		"",
		"## Failed steps with no parsed test failure (build, install, download, crashed runner)",
		"",
		...(report.steps.length
			? [
					"| Job | Step | Failures | Changes | Last seen |\n|---|---|---:|---:|---|",
					...report.steps.map(
						(step) =>
							`| ${cell(step.job)} | ${cell(step.step)} | ${step.count} | ${step.changes.size} | ${day(step.lastSeen)} |`,
					),
				]
			: ["None."]),
	];
	return `${lines.join("\n")}\n`;
}
