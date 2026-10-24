import { describe, expect, test } from "bun:test";
import {
	buildReport,
	type CiJob,
	type CiRun,
	isFlake,
	parseTestFailures,
	renderReport,
} from "./ciFlakes";

const bunLog = [
	"2026-10-23T07:36:55.5494219Z ##[group]src/terminal/terminalManager.test.ts:",
	"2026-10-23T07:36:55.5494219Z (pass) attaching twice to a tab returns the SAME shell [11.08ms]",
	"2026-10-23T07:36:55.5542652Z \u001b[31m(fail)\u001b[0m a revived recording is served once, not to every later attach [58.28ms]",
	"2026-10-23T07:36:55.5600000Z ##[endgroup]",
	"2026-10-23T07:36:55.6448110Z (fail) a revived recording is served once, not to every later attach [58.28ms]",
].join("\n");

const playwrightLog = [
	"2026-10-23T07:44:32.2938617Z   1 failed",
	"2026-10-23T07:44:32.2938617Z     [chromium] › e2e/ask-user-question.spec.ts:129:1 › a persisted tall questionnaire reveals page changes ───",
	"2026-10-23T07:44:32.2938617Z   1 flaky",
	"2026-10-23T07:44:32.2939875Z     [chromium] › e2e/chat-scroll.spec.ts:616:2 › oldest-first keeps touch intent through canceled-pointer momentum ",
	"2026-10-23T07:44:32.2940891Z   151 passed (8.3m)",
	"2026-10-23T07:45:20.8218771Z ##[notice]  1 failed",
	"2026-10-23T07:45:20.8218771Z   1 failed",
	"2026-10-23T07:45:20.8218771Z     [chromium] › e2e/ask-user-question.spec.ts:129:1 › a persisted tall questionnaire reveals page changes ",
].join("\n");

describe("parseTestFailures", () => {
	test("reads bun failures once with the file of the group they ran in", () => {
		expect(parseTestFailures(bunLog)).toEqual([
			{
				file: "src/terminal/terminalManager.test.ts",
				title: "a revived recording is served once, not to every later attach",
				kind: "failed",
			},
		]);
	});

	test("keeps same-named tests of different files apart and ignores the closing summary", () => {
		const log = [
			"##[group]src/a/prefs.test.ts:",
			"(fail) idempotent writes preserve the stored document [1.00ms]",
			"##[group]src/b/routes.test.ts:",
			"(fail) idempotent writes preserve the stored document [2.00ms]",
			"##[endgroup]",
			"2 tests failed:",
			"(fail) idempotent writes preserve the stored document [1.00ms]",
			"(fail) idempotent writes preserve the stored document [2.00ms]",
		].join("\n");
		expect(parseTestFailures(log).map((test) => test.file)).toEqual([
			"src/a/prefs.test.ts",
			"src/b/routes.test.ts",
		]);
	});

	test("normalizes a Windows test file path", () => {
		const windowsLog = [
			"2026-10-23T16:26:00.0000000Z ##[group]packages\\artifact-tests\\src\\installerScripts.test.ts:",
			"2026-10-23T16:26:35.0844656Z (fail) install.ps1 validation > recognizes its bin dir on PATH [30948.90ms]",
		].join("\n");
		expect(parseTestFailures(windowsLog)).toEqual([
			{
				file: "packages/artifact-tests/src/installerScripts.test.ts",
				title: "install.ps1 validation > recognizes its bin dir on PATH",
				kind: "failed",
			},
		]);
	});

	test("reads Playwright failed and flaky summaries once each, without box padding", () => {
		expect(parseTestFailures(playwrightLog)).toEqual([
			{
				file: "e2e/ask-user-question.spec.ts",
				title: "a persisted tall questionnaire reveals page changes",
				kind: "failed",
			},
			{
				file: "e2e/chat-scroll.spec.ts",
				title: "oldest-first keeps touch intent through canceled-pointer momentum",
				kind: "flaky",
			},
		]);
	});
});

function run(
	id: number,
	branch: string,
	sha: string,
	conclusion: string,
	event = "pull_request",
	pr: number | null = null,
): CiRun {
	return {
		id,
		event,
		branch,
		pr,
		sha,
		attempt: 1,
		conclusion,
		createdAt: `2026-10-2${id % 10}T00:00:00Z`,
	};
}

function job(
	id: number,
	runId: number,
	name: string,
	conclusion: string,
	failedSteps: string[] = [],
): CiJob {
	return { id, runId, attempt: 1, name, conclusion, failedSteps };
}

const askFailure = parseTestFailures(playwrightLog)[0];
if (!askFailure) throw new Error("fixture has no Playwright failure");
const genuine = { file: "src/x.test.ts", title: "a new feature works", kind: "failed" as const };

describe("buildReport", () => {
	const runs = [
		run(1, "feature-a", "sha-a", "failure", "pull_request", 101),
		run(2, "feature-a", "sha-a", "success", "pull_request", 101),
		run(3, "feature-b", "sha-b", "failure", "pull_request", 102),
		run(4, "gh-readonly-queue/main/pr-103-sha", "sha-c", "failure", "merge_group"),
		run(5, "feature-d", "sha-d", "failure", "pull_request", 104),
	];
	const jobs = [
		job(11, 1, "E2E (no-agent) shard 1/2", "failure", ["Run bun run e2e"]),
		job(12, 1, "CI passed", "failure", ["Run test"]),
		job(31, 3, "E2E (no-agent) shard 2/2", "failure", [
			"Run bun run e2e",
			"Upload Playwright report",
		]),
		job(41, 4, "Binary smoke & e2e shard 1/4", "failure", ["Run bun run e2e:binary --shard=1/4"]),
		job(51, 5, "Unit Tests", "failure", ["Run bun run test"]),
		job(52, 5, "Desktop smoke & e2e shard 2/4", "failure", ["Run bun run desktop:build"]),
	];
	const report = buildReport("2026-10-01", runs, jobs, [
		{ job: jobs[0] as CiJob, tests: [askFailure] },
		{ job: jobs[2] as CiJob, tests: [askFailure] },
		{ job: jobs[3] as CiJob, tests: [askFailure] },
		{ job: jobs[4] as CiJob, tests: [genuine] },
	]);

	test("ranks a cross-change, merge-queue, rerun-confirmed failure as a flake", () => {
		const [ask] = report.flakes;
		expect(ask?.title).toBe(askFailure.title);
		expect(ask?.failed).toBe(3);
		expect([...(ask?.changes ?? [])].sort()).toEqual(["#101", "#102", "#103"]);
		expect(ask?.mergeQueue).toBe(1);
		expect(ask?.rerunConfirmed).toBe(1);
		expect([...(ask?.jobs ?? [])].sort()).toEqual(["Binary smoke & e2e", "E2E (no-agent)"]);
	});

	test("keeps a single-change failure with no passing rerun out of the flakes", () => {
		expect(report.likelyGenuine.map((stats) => stats.title)).toEqual([genuine.title]);
	});

	test("counts attempts that failed only on flakes, excluding unexplained steps and the aggregate gate", () => {
		expect(report.failedAttempts).toBe(4);
		expect(report.flakeOnlyAttempts).toBe(2);
	});

	test("lists failed steps no parsed test explains, including ones beside a test failure", () => {
		expect(report.steps.map((step) => [step.job, step.step, step.count])).toEqual([
			["E2E (no-agent)", "Upload Playwright report", 1],
			["Desktop smoke & e2e", "Run bun run desktop:build", 1],
		]);
	});

	test("counts a PR and its merge-queue entries as one change", () => {
		const queued = buildReport(
			"2026-10-01",
			[
				run(1, "feature-a", "sha-a", "failure", "pull_request", 101),
				run(2, "gh-readonly-queue/main/pr-101-sha", "sha-q", "failure", "merge_group"),
			],
			[
				job(11, 1, "Unit Tests", "failure", ["Run bun run test"]),
				job(21, 2, "Unit Tests", "failure", ["Run bun run test"]),
			],
			[
				{ job: job(11, 1, "Unit Tests", "failure", ["Run bun run test"]), tests: [genuine] },
				{ job: job(21, 2, "Unit Tests", "failure", ["Run bun run test"]), tests: [genuine] },
			],
		);
		expect(queued.flakes).toEqual([]);
		expect([...(queued.likelyGenuine[0]?.changes ?? [])]).toEqual(["#101"]);
	});

	test("renders both test tables and the step table", () => {
		const markdown = renderReport(report);
		expect(markdown).toContain("# CI flakes since 2026-10-01");
		expect(markdown).toContain("4 failed attempts, 2 (50%) failed only on flake-classified tests.");
		expect(markdown).toContain(
			"| `e2e/ask-user-question.spec.ts` › a persisted tall questionnaire reveals page changes | 3 | 0 | 3 | 1 | 1 |",
		);
		expect(markdown).toContain("| `src/x.test.ts` › a new feature works | 1 | 0 | 1 | 0 | 0 |");
		expect(markdown).toContain("| Desktop smoke & e2e | Run bun run desktop:build | 1 | 1 |");
	});
});

describe("isFlake", () => {
	const base = {
		file: null,
		title: "t",
		failed: 1,
		flaky: 0,
		changes: new Set(["#1"]),
		mergeQueue: 0,
		mergeQueueChanges: new Set<string>(),
		rerunConfirmed: 0,
		lastSeen: "2026-10-01",
		jobs: new Set<string>(),
	};

	test("needs evidence beyond failures of one or two changes", () => {
		expect(isFlake(base)).toBe(false);
		expect(isFlake({ ...base, flaky: 1 })).toBe(true);
		expect(isFlake({ ...base, rerunConfirmed: 1 })).toBe(true);
		expect(isFlake({ ...base, changes: new Set(["#1", "#2", "#3"]) })).toBe(true);
		expect(
			isFlake({
				...base,
				changes: new Set(["#1", "#2"]),
				mergeQueue: 1,
				mergeQueueChanges: new Set(["#2"]),
			}),
		).toBe(false);
		expect(
			isFlake({
				...base,
				changes: new Set(["#1", "#2"]),
				mergeQueue: 2,
				mergeQueueChanges: new Set(["#1", "#2"]),
			}),
		).toBe(true);
	});
});
