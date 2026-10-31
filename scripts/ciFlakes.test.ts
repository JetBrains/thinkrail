import { describe, expect, test } from "bun:test";
import {
	attemptsToFetch,
	buildReport,
	type CiCheckRun,
	type CiJob,
	type CiPull,
	type CiRun,
	isCarriedOver,
	isFlake,
	jobReports,
	parseTestFailures,
	renderReport,
} from "./ciFlakes";

const REPO = "JetBrains/thinkrail";

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

const runnerNotice = {
	title: "",
	message:
		'"The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026. For more information, see https://github.com/actions/runner-images/issues/14748"',
};

const greenE2eAnnotations = [
	{
		title: "🎭 Playwright Run Summary",
		message:
			"  2 flaky\n    [chromium] › e2e/activity-breadcrumbs.spec.ts:240:2 › oldest-first disclosure expansion preserves following and detached reading anchors \n    [chromium] › e2e/chat-scroll.spec.ts:616:2 › oldest-first keeps touch intent through canceled-pointer momentum \n  305 passed (8.2m)",
	},
	{
		title:
			"[chromium] › e2e/chat-scroll.spec.ts:616:2 › oldest-first keeps touch intent through canceled-pointer momentum",
		message:
			'  2) [chromium] › e2e/chat-scroll.spec.ts:616:2 › oldest-first keeps touch intent through canceled-pointer momentum \n    Error: expect(locator).toHaveAttribute(expected) failed\n\n    Locator:  getByTestId(\'chat-scroll\')\n    Expected: "following"\n    Received: "detached"\n    Timeout:  5000ms',
	},
	{
		title:
			"[chromium] › e2e/activity-breadcrumbs.spec.ts:240:2 › oldest-first disclosure expansion preserves following and detached reading anchors",
		message:
			"  1) [chromium] › e2e/activity-breadcrumbs.spec.ts:240:2 › oldest-first disclosure expansion preserves following and detached reading anchors \n    Error: expect(received).toBeLessThanOrEqual(expected)\n\n    Expected: <= 2\n    Received:    233.078125",
	},
	runnerNotice,
];

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
	attempt = 1,
): CiRun {
	return {
		id,
		event,
		branch,
		headRepo: REPO,
		pr,
		sha,
		attempt,
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
	attempt = 1,
): CiJob {
	return {
		id,
		runId,
		attempt,
		name,
		conclusion,
		failedSteps,
		createdAt: "2026-10-20T00:00:00Z",
		startedAt: "2026-10-20T00:00:05Z",
	};
}

function pull(number: number, head: string, bases: string[], headRepo = REPO): CiPull {
	return { number, head, headRepo, baseRepo: REPO, bases, createdAt: "2026-10-01T00:00:00Z" };
}

function checkRun(
	id: number,
	runId: number,
	name: string,
	conclusion: string,
	annotations = greenE2eAnnotations,
): CiCheckRun {
	return { id, runId, name, conclusion, annotations };
}

const askFailure = parseTestFailures(playwrightLog)[0];
if (!askFailure) throw new Error("fixture has no Playwright failure");
const genuine = { file: "src/x.test.ts", title: "a new feature works", kind: "failed" as const };
const unitJob = (id: number, runId: number, attempt = 1) =>
	job(id, runId, "Unit Tests", "failure", ["Run bun run test"], attempt);

describe("buildReport", () => {
	const runs = [
		run(1, "feature-a", "sha-a", "failure", "pull_request", 101),
		run(2, "feature-a", "sha-a", "success", "pull_request", 101),
		run(3, "feature-b", "sha-b", "failure", "pull_request", 102),
		run(4, "gh-readonly-queue/main/pr-103-abc123", "sha-c", "failure", "merge_group"),
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
	const report = buildReport(
		"2026-10-01",
		runs,
		jobs,
		[
			{ job: jobs[0] as CiJob, tests: [askFailure] },
			{ job: jobs[2] as CiJob, tests: [askFailure] },
			{ job: jobs[3] as CiJob, tests: [askFailure] },
			{ job: jobs[4] as CiJob, tests: [genuine] },
		],
		[],
	);

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

	test("counts a PR and its merge-queue entries as one change, also once the PR is closed", () => {
		const queued = buildReport(
			"2026-10-01",
			[
				run(1, "feature-a", "sha-a", "failure"),
				run(2, "gh-readonly-queue/main/pr-101-abc123", "sha-q", "failure", "merge_group"),
			],
			[unitJob(11, 1), unitJob(21, 2)],
			[
				{ job: unitJob(11, 1), tests: [genuine] },
				{ job: unitJob(21, 2), tests: [genuine] },
			],
			[pull(101, "feature-a", ["main"])],
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

describe("merge-queue entries built on another entry", () => {
	const buttons = {
		file: "src/styles/buttonUsage.test.ts",
		title: "button system adoption > uses only the five variants and three sizes",
		kind: "failed" as const,
	};
	const own = {
		file: "src/ci.test.ts",
		title: "docs-only changes skip app suites",
		kind: "failed" as const,
	};
	const runs = [
		run(
			1,
			"gh-readonly-queue/main/pr-817-affe5dec64b9c670c624f846e8daeab93f236f8b",
			"58cb1c455d00d660523098530314790f9074e4de",
			"failure",
			"merge_group",
		),
		run(
			2,
			"gh-readonly-queue/main/pr-952-58cb1c455d00d660523098530314790f9074e4de",
			"c6bbe2ab6c1104bed689787bc0a0a220be8704fb",
			"failure",
			"merge_group",
		),
		run(
			3,
			"gh-readonly-queue/main/pr-817-8efbea8924c7c9c6ee8016b3cacf1f57fe3c8fa9",
			"b90c71f555ca9ca838ac6deb6445e9f72a1d45b6",
			"failure",
			"merge_group",
		),
	];
	const report = buildReport(
		"2026-10-01",
		runs,
		[unitJob(11, 1), unitJob(21, 2), unitJob(31, 3)],
		[
			{ job: unitJob(11, 1), tests: [buttons] },
			{ job: unitJob(21, 2), tests: [buttons, own] },
			{ job: unitJob(31, 3), tests: [buttons] },
		],
		[],
	);
	const stats = (title: string) =>
		[...report.flakes, ...report.likelyGenuine].find((test) => test.title === title);

	test("charge a failure the entry below also had to that entry's change", () => {
		expect(report.flakes).toEqual([]);
		expect(stats(buttons.title)?.mergeQueue).toBe(3);
		expect([...(stats(buttons.title)?.mergeQueueChanges ?? [])]).toEqual(["#817"]);
	});

	test("keep a failure the entry below did not have on the entry's own change", () => {
		expect([...(stats(own.title)?.changes ?? [])]).toEqual(["#952"]);
	});
});

describe("stacked PRs", () => {
	const onboarding = {
		file: "e2e/onboarding.spec.ts",
		title:
			"the onboarding wizard verifies the connection in place, then collapses to one line over the two project cards @dev-seam",
		kind: "failed" as const,
	};
	const pulls = [
		pull(804, "global-search-research", ["main"]),
		pull(887, "global-search-chats", ["global-search-start"]),
		pull(888, "global-search-continue", ["global-search-chats"]),
		pull(933, "global-search-find", ["global-search-continue"]),
		pull(939, "global-search-specs", ["global-search-find"]),
		pull(941, "global-search-workspace-tools", ["main", "global-search-specs"]),
		pull(806, "global-search-start", ["global-search-host"]),
		pull(805, "global-search-host", ["global-search-research"]),
		pull(1021, "main", ["main"], "a-fork/thinkrail"),
		pull(950, "unrelated", ["main"]),
	];
	const branches: [number, string][] = [
		[887, "global-search-chats"],
		[888, "global-search-continue"],
		[933, "global-search-find"],
		[939, "global-search-specs"],
		[941, "global-search-workspace-tools"],
		[950, "unrelated"],
	];
	const runs = branches.map(([pr, branch], index) =>
		run(index + 1, branch, `sha-${pr}`, "failure", "pull_request", pr === 941 ? null : pr),
	);
	const e2e = (index: number) =>
		job(index + 11, index + 1, "E2E (no-agent) shard 2/2", "failure", ["Run bun run e2e"]);
	const report = buildReport(
		"2026-10-01",
		runs,
		runs.map((_, index) => e2e(index)),
		runs.map((_, index) => ({ job: e2e(index), tests: [onboarding] })),
		pulls,
	);

	test("count a stack linked by base branches, including a retargeted one, as one change", () => {
		expect(report.flakes).toEqual([]);
		expect([...(report.likelyGenuine[0]?.changes ?? [])].sort()).toEqual(["#804", "#950"]);
	});
});

describe("Playwright run-summary annotations", () => {
	test("read a green job's flaky tests from its run-summary annotation alone", () => {
		const [report] = jobReports(
			[],
			[checkRun(120931188847, 1, "E2E (no-agent) shard 1/2", "success")],
		);
		expect(report?.tests).toEqual([
			{
				file: "e2e/activity-breadcrumbs.spec.ts",
				title: "oldest-first disclosure expansion preserves following and detached reading anchors",
				kind: "flaky",
			},
			{
				file: "e2e/chat-scroll.spec.ts",
				title: "oldest-first keeps touch intent through canceled-pointer momentum",
				kind: "flaky",
			},
		]);
	});

	test("prefer a failed job's log and fall back to its summary when the log is unreadable", () => {
		const failedE2e = job(11, 1, "E2E (no-agent) shard 1/2", "failure", ["Run bun run e2e"]);
		const unreadable = job(12, 1, "E2E (no-agent) shard 2/2", "failure", ["Run bun run e2e"]);
		const reports = jobReports(
			[
				{ job: failedE2e, log: playwrightLog },
				{ job: unreadable, log: "" },
			],
			[
				checkRun(11, 1, failedE2e.name, "failure"),
				checkRun(12, 1, unreadable.name, "failure"),
				checkRun(13, 1, "Unit Tests", "success", [runnerNotice]),
			],
		);
		expect(
			reports.map((report) => [
				report.job.id,
				report.tests.map((test) => `${test.kind} ${test.file}`),
			]),
		).toEqual([
			[11, ["failed e2e/ask-user-question.spec.ts", "flaky e2e/chat-scroll.spec.ts"]],
			[12, ["flaky e2e/activity-breadcrumbs.spec.ts", "flaky e2e/chat-scroll.spec.ts"]],
		]);
	});

	test("count green-job flaky marks as flake evidence without failing an attempt", () => {
		const green = run(1, "feature-a", "sha-a", "success", "pull_request", 101);
		const report = buildReport(
			"2026-10-01",
			[green],
			[],
			jobReports([], [checkRun(120931188847, 1, "E2E (no-agent) shard 1/2", "success")]),
			[],
		);
		expect(report.flakes.map((stats) => [stats.title, stats.flaky, stats.failed])).toEqual([
			["oldest-first disclosure expansion preserves following and detached reading anchors", 1, 0],
			["oldest-first keeps touch intent through canceled-pointer momentum", 1, 0],
		]);
		expect(report.failedAttempts).toBe(0);
	});
});

describe("attempts", () => {
	const rerunPassed = run(1, "feature-a", "sha-a", "success", "pull_request", 101, 2);

	test("fetch every attempt of a failed, re-run, or failure-holding run and skip a clean one", () => {
		const runs = [
			rerunPassed,
			run(2, "feature-b", "sha-b", "failure"),
			run(3, "feature-c", "sha-c", "cancelled"),
			run(4, "feature-d", "sha-d", "success"),
		];
		const selected = attemptsToFetch(runs, [
			checkRun(31, 3, "Unit Tests", "failure", []),
			checkRun(41, 4, "Unit Tests", "success", []),
		]);
		expect(selected.map(({ run, attempt }) => [run.id, attempt])).toEqual([
			[1, 1],
			[1, 2],
			[2, 1],
			[3, 1],
		]);
	});

	test("recognize a job a re-run carried over from the earlier attempt", () => {
		expect(isCarriedOver(job(11, 1, "Unit Tests", "success", [], 2))).toBe(false);
		expect(
			isCarriedOver({
				...job(12, 1, "Unit Tests", "success", [], 2),
				createdAt: "2026-10-30T21:56:43Z",
				startedAt: "2026-10-30T21:36:26Z",
			}),
		).toBe(true);
	});

	test("count an attempt-1 failure whose attempt 2 passed as a rerun-confirmed failure", () => {
		const report = buildReport(
			"2026-10-01",
			[rerunPassed],
			[unitJob(11, 1), job(21, 1, "Unit Tests", "success", [], 2)],
			[{ job: unitJob(11, 1), tests: [genuine] }],
			[],
		);
		expect(report.failedAttempts).toBe(1);
		expect(report.flakes.map((stats) => [stats.title, stats.failed, stats.rerunConfirmed])).toEqual(
			[[genuine.title, 1, 1]],
		);
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
