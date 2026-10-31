import { parseArgs } from "node:util";
import {
	attemptsToFetch,
	buildReport,
	type CheckAnnotation,
	type CiCheckRun,
	type CiJob,
	type CiPull,
	type CiRun,
	isCarriedOver,
	isTestJob,
	jobReports,
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
const [owner, name] = repo.split("/");
if (!owner || !name) throw new Error("--repo must be owner/name");
const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const PULLS_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
	repository(owner: $owner, name: $name) {
		pullRequests(first: 100, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
			pageInfo { hasNextPage endCursor }
			nodes {
				number headRefName baseRefName createdAt updatedAt
				headRepository { nameWithOwner }
				baseRepository { nameWithOwner }
				timelineItems(itemTypes: [BASE_REF_CHANGED_EVENT], first: 20) {
					nodes { ... on BaseRefChangedEvent { createdAt previousRefName currentRefName } }
				}
			}
		}
	}
}`;
const CHECK_RUNS_QUERY = `query($ids: [ID!]!) {
	nodes(ids: $ids) {
		... on CheckSuite {
			workflowRun { databaseId }
			checkRuns(first: 100, filterBy: {checkType: ALL}) { nodes { id databaseId name conclusion } }
		}
	}
}`;
const ANNOTATIONS_QUERY = `query($ids: [ID!]!) {
	nodes(ids: $ids) { ... on CheckRun { databaseId annotations(first: 50) { nodes { title message } } } }
}`;
const GRAPHQL_BATCH = 100;

const TRANSIENT_GH_FAILURE = /HTTP 5\d\d|Server Error|timed out|connection reset/i;
const GH_ATTEMPTS = 3;

async function gh(args: string[]): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code === 0) return stdout;
		if (attempt >= GH_ATTEMPTS || !TRANSIENT_GH_FAILURE.test(stderr)) {
			throw new Error(`gh ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
		}
		await Bun.sleep(attempt * 2_000);
	}
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

async function graphqlNodes<T>(query: string, ids: string[], jq: string): Promise<T[]> {
	const batches = Array.from({ length: Math.ceil(ids.length / GRAPHQL_BATCH) }, (_, index) =>
		ids.slice(index * GRAPHQL_BATCH, (index + 1) * GRAPHQL_BATCH),
	);
	const pages = await pool(batches, async (batch) =>
		jsonLines<T>(
			await gh([
				"api",
				"graphql",
				"-f",
				`query=${query}`,
				...batch.flatMap((id) => ["-f", `ids[]=${id}`]),
				"--jq",
				jq,
			]),
		),
	);
	return pages.flat();
}

async function pullsSince(): Promise<CiPull[]> {
	const pulls: CiPull[] = [];
	let cursor: string | null = null;
	do {
		const page = JSON.parse(
			await gh([
				"api",
				"graphql",
				"-f",
				`query=${PULLS_QUERY}`,
				"-f",
				`owner=${owner}`,
				"-f",
				`name=${name}`,
				...(cursor ? ["-f", `cursor=${cursor}`] : []),
				"--jq",
				".data.repository.pullRequests | {next: (if .pageInfo.hasNextPage then .pageInfo.endCursor else null end), pulls: [.nodes[] | {number, head: .headRefName, headRepo: .headRepository.nameWithOwner, baseRepo: .baseRepository.nameWithOwner, bases: (.createdAt as $opened | (.timelineItems.nodes | sort_by(.createdAt)) as $moves | [{ref: ($moves[0].previousRefName // .baseRefName), since: $opened}] + [$moves[] | {ref: .currentRefName, since: .createdAt}]), createdAt, updatedAt}]}",
			]),
		) as { next: string | null; pulls: (CiPull & { updatedAt: string })[] };
		pulls.push(...page.pulls);
		cursor = page.pulls.some((pull) => pull.updatedAt < since) ? null : page.next;
	} while (cursor);
	return pulls;
}

const runs = jsonLines<CiRun & { checkSuite: string }>(
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
		".workflow_runs[] | {id, event, branch: .head_branch, headRepo: .head_repository.full_name, pr: (.pull_requests[0].number // null), sha: .head_sha, attempt: .run_attempt, conclusion, createdAt: .created_at, checkSuite: .check_suite_node_id}",
	]),
);
const pulls = await pullsSince();

const checkRunRefs = await graphqlNodes<Omit<CiCheckRun, "annotations"> & { node: string }>(
	CHECK_RUNS_QUERY,
	runs.map((run) => run.checkSuite),
	".data.nodes[] | select(.workflowRun) | .workflowRun.databaseId as $run | .checkRuns.nodes[] | {node: .id, id: .databaseId, runId: $run, name, conclusion: (.conclusion | if . then ascii_downcase else null end)}",
);
const annotations = new Map(
	(
		await graphqlNodes<{ id: number; annotations: CheckAnnotation[] }>(
			ANNOTATIONS_QUERY,
			checkRunRefs.filter((ref) => ref.conclusion !== "skipped").map((ref) => ref.node),
			".data.nodes[] | select(.) | {id: .databaseId, annotations: .annotations.nodes}",
		)
	).map((checkRun) => [checkRun.id, checkRun.annotations]),
);
const checkRuns: CiCheckRun[] = checkRunRefs.map((ref) => ({
	...ref,
	annotations: annotations.get(ref.id) ?? [],
}));

const jobs = (
	await pool(attemptsToFetch(runs, checkRuns), async ({ run, attempt }) =>
		jsonLines<CiJob>(
			await gh([
				"api",
				`repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`,
				"--jq",
				`.jobs[] | {id, runId: ${run.id}, attempt: ${attempt}, name, conclusion, failedSteps: [.steps[]? | select(.conclusion == "failure") | .name], createdAt: .created_at, startedAt: .started_at}`,
			]),
		),
	)
)
	.flat()
	.filter((job) => !isCarriedOver(job));

const logs = await pool(
	jobs.filter((job) => job.conclusion === "failure" && isTestJob(job)),
	async (job) => ({
		job,
		log: await gh([
			"api",
			"--allow-escape-sequences",
			`repos/${repo}/actions/jobs/${job.id}/logs`,
		]).catch((error: unknown) => {
			console.error(`skipping unreadable log for job ${job.id}: ${String(error)}`);
			return "";
		}),
	}),
);

process.stdout.write(
	renderReport(buildReport(since, runs, jobs, jobReports(logs, checkRuns), pulls)),
);
