import { parseArgs } from "node:util";
import {
	buildReport,
	type CiJob,
	type CiRun,
	isTestJob,
	type JobReport,
	parseTestFailures,
	renderReport,
} from "./ciFlakes";

const { values } = parseArgs({
	options: {
		days: { type: "string", default: "14" },
		repo: { type: "string", default: "JetBrains/thinkrail" },
		workflow: { type: "string", default: "ci.yml" },
		concurrency: { type: "string", default: "8" },
	},
});

const days = Number(values.days);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive integer");
if (!Number.isInteger(concurrency) || concurrency < 1) {
	throw new Error("--concurrency must be a positive integer");
}
const repo = values.repo;
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function gh(args: string[]): Promise<string> {
	const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`gh ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
	return stdout;
}

function jsonLines<T>(text: string): T[] {
	return text
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as T);
}

async function pool<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await work(items[index] as T);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results;
}

const runs = jsonLines<CiRun>(
	await gh([
		"api",
		"-X",
		"GET",
		`repos/${repo}/actions/workflows/${values.workflow}/runs`,
		"-f",
		"per_page=100",
		"-f",
		`created=>=${since}`,
		"--paginate",
		"--jq",
		".workflow_runs[] | {id, event, branch: .head_branch, pr: (.pull_requests[0].number // null), sha: .head_sha, attempt: .run_attempt, conclusion, createdAt: .created_at}",
	]),
);

const attempts = runs
	.filter((run) => run.conclusion === "failure" || run.attempt > 1)
	.flatMap((run) =>
		Array.from({ length: run.attempt }, (_, index) => ({ run, attempt: index + 1 })),
	);
const jobs = (
	await pool(attempts, async ({ run, attempt }) =>
		jsonLines<CiJob>(
			await gh([
				"api",
				`repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`,
				"--jq",
				`.jobs[] | {id, runId: ${run.id}, attempt: ${attempt}, name, conclusion, failedSteps: [.steps[]? | select(.conclusion == "failure") | .name]}`,
			]),
		),
	)
).flat();

const testJobs = jobs.filter((job) => job.conclusion === "failure" && isTestJob(job));
const reports = await pool(
	testJobs,
	async (job): Promise<JobReport> => ({
		job,
		tests: parseTestFailures(
			await gh([
				"api",
				"--allow-escape-sequences",
				`repos/${repo}/actions/jobs/${job.id}/logs`,
			]).catch((error: unknown) => {
				console.error(`skipping unreadable log for job ${job.id}: ${String(error)}`);
				return "";
			}),
		),
	}),
);

process.stdout.write(renderReport(buildReport(since, runs, jobs, reports)));
