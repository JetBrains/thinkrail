import { stripVTControlCharacters } from "node:util";

export interface CiRun {
	id: number;
	event: string;
	branch: string;
	headRepo: string | null;
	pr: number | null;
	sha: string;
	attempt: number;
	conclusion: string | null;
	createdAt: string;
}

export interface CiPull {
	number: number;
	head: string;
	headRepo: string | null;
	baseRepo: string;
	bases: { ref: string; since: string }[];
	createdAt: string;
}

export interface CiJob {
	id: number;
	runId: number;
	attempt: number;
	name: string;
	conclusion: string | null;
	failedSteps: string[];
	createdAt: string;
	startedAt: string | null;
}

export interface CheckAnnotation {
	title: string | null;
	message: string;
}

export interface CiCheckRun {
	id: number;
	runId: number;
	name: string;
	conclusion: string | null;
	annotations: CheckAnnotation[];
}

export interface TestFailure {
	file: string | null;
	title: string;
	kind: "failed" | "flaky";
}

export type JobRef = Pick<CiJob, "id" | "runId" | "name">;

export interface JobReport {
	job: JobRef;
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
const PLAYWRIGHT_SUMMARY = "🎭 Playwright Run Summary";

const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const BUN_FILE = /^(?:##\[group\])?((?:[\w@.-]+[\\/])*[\w.-]+\.test\.tsx?):$/;
const BUN_FAIL = /^\s*\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/;
const BUN_SUMMARY = /^\d+ tests? failed:$/;
const MERGE_QUEUE = /^gh-readonly-queue\/.+\/pr-(\d+)-([0-9a-f]+)$/;
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

export function jobReports(
	logs: { job: CiJob; log: string }[],
	checkRuns: CiCheckRun[],
): JobReport[] {
	const reports: JobReport[] = logs
		.filter(({ log }) => log)
		.map(({ job, log }) => ({ job, tests: parseTestFailures(log) }));
	const logged = new Set(reports.map(({ job }) => job.id));
	for (const checkRun of checkRuns) {
		const summaries = checkRun.annotations
			.filter((annotation) => annotation.title === PLAYWRIGHT_SUMMARY)
			.map((annotation) => annotation.message);
		if (summaries.length > 0 && !logged.has(checkRun.id)) {
			reports.push({ job: checkRun, tests: parseTestFailures(summaries.join("\n")) });
		}
	}
	return reports;
}

export function isTestJob(job: CiJob): boolean {
	return job.failedSteps.some((step) => TEST_STEP.test(step));
}

export function attemptsToFetch(
	runs: CiRun[],
	checkRuns: CiCheckRun[],
): { run: CiRun; attempt: number }[] {
	const holdsFailure = new Set(
		checkRuns.filter((checkRun) => checkRun.conclusion === "failure").map(({ runId }) => runId),
	);
	return runs
		.filter((run) => run.conclusion === "failure" || run.attempt > 1 || holdsFailure.has(run.id))
		.flatMap((run) =>
			Array.from({ length: run.attempt }, (_, index) => ({ run, attempt: index + 1 })),
		);
}

export function isCarriedOver(job: CiJob): boolean {
	return job.startedAt !== null && job.startedAt < job.createdAt;
}

export function baseJobName(name: string): string {
	return name.replace(/ shard \d+\/\d+$/, "");
}

export function changeResolver(pulls: CiPull[]): (run: CiRun) => string {
	const byHead = new Map<string, CiPull[]>();
	for (const pull of [...pulls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
		if (pull.headRepo === null) continue;
		const key = `${pull.headRepo}:${pull.head}`;
		byHead.set(key, [...(byHead.get(key) ?? []), pull]);
	}
	const openedBy = (key: string, at: string) =>
		byHead.get(key)?.find((pull) => pull.createdAt <= at)?.number;
	const ownerAt = (key: string, at: string) => {
		const owners = byHead.get(key);
		return openedBy(key, at) ?? (owners?.length === 1 ? owners[0]?.number : undefined);
	};
	const joined = new Map<number, number>();
	const stack = (pr: number): number => {
		const lower = joined.get(pr);
		return lower === undefined ? pr : stack(lower);
	};
	for (const pull of pulls) {
		for (const base of pull.bases) {
			const parent = ownerAt(`${pull.baseRepo}:${base.ref}`, base.since);
			if (parent === undefined) continue;
			const [a, b] = [stack(pull.number), stack(parent)];
			if (a !== b) joined.set(Math.max(a, b), Math.min(a, b));
		}
	}
	return (run) => {
		const queued = MERGE_QUEUE.exec(run.branch)?.[1];
		const pr =
			run.pr ??
			(queued ? Number(queued) : openedBy(`${run.headRepo}:${run.branch}`, run.createdAt));
		return pr === undefined ? run.branch : `#${stack(pr)}`;
	};
}

function passedOnSameSha(job: JobRef, runs: Map<number, CiRun>, jobs: CiJob[]): boolean {
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

const testKey = (test: TestFailure) => `${test.file ?? ""} › ${test.title}`;
const stepKey = (job: JobRef, step: string) => `${baseJobName(job.name)} › ${step}`;

export function buildReport(
	since: string,
	runList: CiRun[],
	jobs: CiJob[],
	reports: JobReport[],
	pulls: CiPull[],
): FlakeReport {
	const runs = new Map(runList.map((run) => [run.id, run]));
	const reportByJob = new Map(reports.map((report) => [report.job.id, report]));
	const failedJobs = jobs
		.filter((job) => job.conclusion === "failure" && job.name !== AGGREGATE_JOB)
		.map((job) => {
			const failing = (reportByJob.get(job.id)?.tests ?? []).filter(
				(test) => test.kind === "failed",
			);
			const unexplained =
				isTestJob(job) && failing.length > 0
					? job.failedSteps.filter((step) => !TEST_STEP.test(step))
					: job.failedSteps;
			return { job, failing, unexplained };
		});

	const failedIn = new Map<number, Set<string>>();
	const record = (runId: number, key: string) =>
		failedIn.set(runId, (failedIn.get(runId) ?? new Set<string>()).add(key));
	for (const { job, tests } of reports) {
		for (const test of tests) if (test.kind === "failed") record(job.runId, testKey(test));
	}
	for (const { job, unexplained } of failedJobs) {
		for (const step of unexplained) record(job.runId, stepKey(job, step));
	}
	const queueEntries = new Map(
		runList.filter((run) => MERGE_QUEUE.test(run.branch)).map((run) => [run.sha, run]),
	);
	const changeOf = changeResolver(pulls);
	const changeFor = (run: CiRun, key: string): string => {
		const base = MERGE_QUEUE.exec(run.branch)?.[2];
		const below = base === undefined ? undefined : queueEntries.get(base);
		return below && failedIn.get(below.id)?.has(key) ? changeFor(below, key) : changeOf(run);
	};

	const tests = new Map<string, TestStats>();
	for (const { job, tests: failures } of reports) {
		const run = runs.get(job.runId);
		if (!run) continue;
		const confirmed =
			failures.some((failure) => failure.kind === "failed") && passedOnSameSha(job, runs, jobs);
		for (const failure of failures) {
			const key = testKey(failure);
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
			const change = changeFor(run, key);
			stats.changes.add(change);
			if (run.event === "merge_group") {
				stats.mergeQueue += 1;
				stats.mergeQueueChanges.add(change);
			}
			if (confirmed) stats.rerunConfirmed += 1;
		}
	}

	const steps = new Map<string, StepStats>();
	const attempts = new Map<string, { flakeOnly: boolean }>();
	for (const { job, failing, unexplained } of failedJobs) {
		const run = runs.get(job.runId);
		if (!run) continue;
		const attemptKey = `${job.runId}:${job.attempt}`;
		const attempt = attempts.get(attemptKey) ?? { flakeOnly: true };
		attempts.set(attemptKey, attempt);
		if (unexplained.length > 0 || failing.length === 0) attempt.flakeOnly = false;
		for (const step of unexplained) {
			const key = stepKey(job, step);
			const stats = steps.get(key) ?? {
				job: baseJobName(job.name),
				step,
				count: 0,
				changes: new Set<string>(),
				lastSeen: run.createdAt,
			};
			steps.set(key, stats);
			stats.count += 1;
			stats.changes.add(changeFor(run, key));
			if (run.createdAt > stats.lastSeen) stats.lastSeen = run.createdAt;
		}
		for (const failure of failing) {
			const stats = tests.get(testKey(failure));
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
		"A change is a PR (its PR runs, its merge-queue entries, and the PRs stacked on its branch count once) or, without a PR, a branch; a merge-queue entry built on another entry's queue commit takes that entry's change for a failure both share. A test is flake-classified when a later run of the same SHA passed its job, Playwright marked it flaky (failed, then passed on retry; read from every Playwright job's run summary, green jobs included), it failed for 3+ changes, or it failed in the merge queue for 2+ changes.",
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
