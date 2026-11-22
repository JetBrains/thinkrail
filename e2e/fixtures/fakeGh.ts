// Independently authored fake of the `gh` surface the host invokes; contract in e2e/SPEC.md.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export type FakePrState = "OPEN" | "CLOSED" | "MERGED";

export interface FakePr {
	number: number;
	headRefName: string;
	baseRefName?: string;
	state: FakePrState;
	isDraft?: boolean;
	reviewDecision?: string;
	mergeStateStatus?: string;
	statusCheckRollup?: Record<string, unknown>[];
	latestReviews?: { author: { login: string }; state: string }[];
	mergedAt?: string | null;
	closedAt?: string | null;
	createdAt?: string;
	mergeError?: string;
	queued?: boolean;
	mergedWith?: string | undefined;
	headOwner?: string;
	title?: string;
	author?: string;
	additions?: number;
	deletions?: number;
	changedFiles?: number;
	updatedAt?: string;
	reviewRequested?: boolean;
}

export interface FakeGhScenario {
	repo?: {
		mergeCommitAllowed?: boolean;
		squashMergeAllowed?: boolean;
		rebaseMergeAllowed?: boolean;
		deleteBranchOnMerge?: boolean;
	};
	prs: FakePr[];
	viewer?: string;
}

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

function main(): void {
	const [scenarioPath, logPath, ...argv] = process.argv.slice(2);
	if (!scenarioPath || !logPath) fail("fake gh: missing scenario or log path");
	appendFileSync(logPath, `${JSON.stringify(argv)}\n`);
	if (!existsSync(scenarioPath))
		fail("gh: To get started with GitHub CLI, please run: gh auth login");
	const scenario = JSON.parse(readFileSync(scenarioPath, "utf8")) as FakeGhScenario;
	const flag = (name: string) => {
		const index = argv.indexOf(name);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const project = (row: Record<string, unknown>) => {
		const fields = (flag("--json") ?? "").split(",").filter(Boolean);
		return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
	};
	let origin = "";
	try {
		origin = execFileSync("git", ["remote", "get-url", "--push", "origin"], {
			encoding: "utf8",
		}).trim();
	} catch {}
	const slug = /github\.com[:/](.+?)(?:\.git)?$/.exec(origin)?.[1] ?? "acme/sample";
	const [owner = "", name = ""] = slug.split("/");
	const shape = (pr: FakePr): Record<string, unknown> => ({
		headRepositoryOwner: { login: pr.headOwner ?? owner },
		headRepository: { name },
		url: `https://github.com/${slug}/pull/${pr.number}`,
		baseRefName: "main",
		isDraft: false,
		reviewDecision: "",
		mergeStateStatus: "CLEAN",
		statusCheckRollup: [],
		latestReviews: [],
		mergedAt: null,
		closedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		title: `Pull request ${pr.number}`,
		additions: 0,
		deletions: 0,
		changedFiles: 0,
		updatedAt: "2026-01-01T00:00:00Z",
		...pr,
		author: { login: pr.author ?? "octo" },
	});
	const find = (selector: string | undefined) =>
		scenario.prs.find((pr) => String(pr.number) === selector) ??
		fail(`no pull requests found for ${selector}`);
	const save = () => writeFileSync(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);
	const [group, command, selector] = argv;

	if (group === "repo" && command === "view") {
		const repo = {
			mergeCommitAllowed: true,
			squashMergeAllowed: true,
			rebaseMergeAllowed: true,
			deleteBranchOnMerge: false,
			...scenario.repo,
		};
		process.stdout.write(`${JSON.stringify(project(repo))}\n`);
		return;
	}
	if (group === "api" && command === "graphql") {
		process.stdout.write(`${JSON.stringify(graphql(scenario, argv.slice(2), shape))}\n`);
		return;
	}
	if (group !== "pr") fail(`fake gh: unsupported command ${argv.join(" ")}`);
	switch (command) {
		case "list": {
			const head = flag("--head");
			const base = flag("--base");
			const state = (flag("--state") ?? "open").toUpperCase();
			const limit = Number(flag("--limit") ?? "30");
			const rows = scenario.prs
				.filter((pr) => pr.headRefName === head)
				.filter((pr) => base === undefined || (pr.baseRefName ?? "main") === base)
				.filter((pr) => state === "ALL" || pr.state === state)
				.sort((left, right) => right.number - left.number)
				.slice(0, limit)
				.map((pr) => project(shape(pr)));
			process.stdout.write(`${JSON.stringify(rows)}\n`);
			return;
		}
		case "view":
			process.stdout.write(`${JSON.stringify(project(shape(find(selector))))}\n`);
			return;
		case "ready": {
			const pr = find(selector);
			pr.isDraft = false;
			if (pr.mergeStateStatus === "DRAFT") pr.mergeStateStatus = "CLEAN";
			save();
			return;
		}
		case "merge": {
			const pr = find(selector);
			if (pr.mergeError) fail(pr.mergeError);
			pr.mergedWith = argv.find((arg) => ["--squash", "--merge", "--rebase"].includes(arg));
			if (!pr.queued) {
				pr.state = "MERGED";
				pr.mergedAt = new Date().toISOString();
			}
			save();
			return;
		}
		case "reopen": {
			const pr = find(selector);
			pr.state = "OPEN";
			pr.closedAt = null;
			save();
			return;
		}
		default:
			fail(`fake gh: unsupported command ${argv.join(" ")}`);
	}
}

function graphql(
	scenario: FakeGhScenario,
	args: string[],
	shape: (pr: FakePr) => Record<string, unknown>,
): unknown {
	const fields = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		if (args[index] !== "-f" && args[index] !== "-F")
			fail(`fake gh: unsupported api arg ${args[index]}`);
		const pair = args[index + 1] ?? "";
		const at = pair.indexOf("=");
		fields.set(pair.slice(0, at), pair.slice(at + 1));
	}
	const query = fields.get("query") ?? "";
	const viewer = scenario.viewer ?? "me";
	if (query.includes("search(")) {
		const terms = (fields.get("q") ?? "").split(/\s+/).filter(Boolean);
		const words = terms.filter((term) => !term.includes(":"));
		const has = (term: string) => terms.includes(term);
		const authors = terms.filter((term) => term.startsWith("author:")).map((term) => term.slice(7));
		const rows = scenario.prs
			.filter((pr) => pr.state === "OPEN")
			.filter((pr) => !has("review-requested:@me") || pr.reviewRequested === true)
			.filter((pr) => !has("draft:false") || pr.isDraft !== true)
			.filter((pr) =>
				authors.every((author) => (pr.author ?? "octo") === (author === "@me" ? viewer : author)),
			)
			.filter((pr) => {
				const title = String(shape(pr).title).toLowerCase();
				return words.every((word) => title.includes(word.toLowerCase()));
			})
			.sort(
				(left, right) =>
					String(shape(right).updatedAt).localeCompare(String(shape(left).updatedAt)) ||
					right.number - left.number,
			);
		const size = Number(/first: (\d+)/.exec(query)?.[1] ?? "20");
		const from = Number(fields.get("after") ?? "0");
		const page = rows.slice(from, from + size);
		return {
			data: {
				viewer: { login: viewer },
				search: {
					pageInfo: {
						hasNextPage: from + size < rows.length,
						endCursor: from + size < rows.length ? String(from + size) : null,
					},
					nodes: page.map((pr) => {
						const row = shape(pr);
						return {
							number: pr.number,
							title: row.title,
							url: row.url,
							state: pr.state,
							isDraft: row.isDraft,
							headRefName: pr.headRefName,
							baseRefName: row.baseRefName,
							updatedAt: row.updatedAt,
							author: row.author,
							reviewRequests: {
								nodes: pr.reviewRequested ? [{ requestedReviewer: { login: viewer } }] : [],
							},
						};
					}),
				},
			},
		};
	}
	if (query.includes("repository(")) {
		const repository: Record<string, unknown> = {};
		for (const [, number] of query.matchAll(/p(\d+): pullRequest/g)) {
			const pr = scenario.prs.find((candidate) => String(candidate.number) === number);
			if (!pr) continue;
			const row = shape(pr);
			repository[`p${number}`] = {
				additions: row.additions,
				deletions: row.deletions,
				changedFiles: row.changedFiles,
			};
		}
		return { data: { repository } };
	}
	return fail("fake gh: unsupported graphql query");
}

if (import.meta.main) main();
