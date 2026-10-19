// Independently authored fake of the `gh` surface the host invokes; contract in e2e/SPEC.md.
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
	mergedWith?: string;
}

export interface FakeGhScenario {
	repo?: {
		mergeCommitAllowed?: boolean;
		squashMergeAllowed?: boolean;
		rebaseMergeAllowed?: boolean;
		deleteBranchOnMerge?: boolean;
	};
	prs: FakePr[];
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
	const shape = (pr: FakePr): Record<string, unknown> => ({
		url: `https://github.com/acme/sample/pull/${pr.number}`,
		baseRefName: "main",
		isDraft: false,
		reviewDecision: "",
		mergeStateStatus: "CLEAN",
		statusCheckRollup: [],
		latestReviews: [],
		mergedAt: null,
		closedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		...pr,
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
			pr.state = "MERGED";
			pr.mergedAt = new Date().toISOString();
			pr.mergedWith = argv.find((arg) => ["--squash", "--merge", "--rebase"].includes(arg));
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

if (import.meta.main) main();
