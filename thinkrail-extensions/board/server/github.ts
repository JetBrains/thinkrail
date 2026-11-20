import type { ExtensionRunResult } from "@thinkrail/extension-api/server";
import type { CardType, GithubFilter } from "./model";

/** An open issue as `gh issue list --json` reports it; labels and assignees by name. */
export interface GithubIssue {
	number: number;
	title: string;
	body: string;
	labels: string[];
	url: string;
	assignees: string[];
	updatedAt: string;
}

/** The GitHub source's state on a board: whether it is on, and its last fetch. */
export interface GithubStatus {
	enabled: boolean;
	filter: GithubFilter;
	/** A fetch is running. */
	loading: boolean;
	fetchedAt: number | null;
	/** The last fetch failed: what gh said. The last good issues stay shown. */
	error: string | null;
}

export const ISSUE_FIELDS = "number,title,body,labels,url,assignees,updatedAt";
export const ISSUE_TTL_MS = 5 * 60_000;
export const GH_TIMEOUT_MS = 30_000;
const ERROR_MAX = 300;
const ISSUE_CARD = /^#([1-9]\d{0,8})$/;

/** The issue list's argv: the user's own `gh`, never a shell string. */
export function issueListArgv(filter: GithubFilter): string[] {
	return [
		"gh",
		"issue",
		"list",
		"--state",
		"open",
		"--limit",
		"100",
		"--json",
		ISSUE_FIELDS,
		...(filter === "mine" ? ["--assignee", "@me"] : []),
	];
}

/** A card id for an issue not stored on the board (`#12`); it never parses as a card id. */
export function issueCardId(number: number): string {
	return `#${number}`;
}

export function parseIssueCardId(id: string): number | null {
	const match = ISSUE_CARD.exec(id.trim());
	return match ? Number(match[1]) : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const names = (value: unknown, key: string): string[] =>
	Array.isArray(value)
		? value.flatMap((entry) =>
				isRecord(entry) && typeof entry[key] === "string" ? [entry[key] as string] : [],
			)
		: [];

/** `gh issue list --json`'s answer; `null` when it is not a list. Entries lacking a number or title drop. */
export function parseIssues(out: string): GithubIssue[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(out);
	} catch {
		return null;
	}
	if (!Array.isArray(parsed)) return null;
	return parsed.flatMap((raw) => {
		if (!isRecord(raw)) return [];
		const { number, title } = raw;
		if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return [];
		if (typeof title !== "string" || !title.trim()) return [];
		return [
			{
				number,
				title: title.trim(),
				body: typeof raw.body === "string" ? raw.body : "",
				labels: names(raw.labels, "name"),
				url: typeof raw.url === "string" ? raw.url : "",
				assignees: names(raw.assignees, "login"),
				updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
			},
		];
	});
}

/** A bug label makes the card a bug, which Start implements directly. */
export function issueType(issue: Pick<GithubIssue, "labels">): CardType {
	return issue.labels.some((label) => /^(bug|type:\s*bug)$/i.test(label.trim()))
		? "bug"
		: "feature";
}

/** What a failed gh run said, in one short line. */
export function runError(run: ExtensionRunResult, what: string): string {
	if (run.timedOut) return `${what} timed out.`;
	const line = `${run.err}\n${run.out}`
		.split("\n")
		.map((entry) => entry.trim())
		.find(Boolean);
	const text = line ?? `${what} failed.`;
	return text.length <= ERROR_MAX ? text : `${text.slice(0, ERROR_MAX - 1)}…`;
}

/** Whether a PR description closes the issue: GitHub's closing keywords, `owner/repo#N` included. */
export function closesIssue(body: string, number: number): boolean {
	const pattern = new RegExp(
		`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b:?\\s+(?:[\\w.-]+/[\\w.-]+)?#${number}(?!\\d)`,
		"i",
	);
	return pattern.test(body);
}

/** The description with a `Closes #N` line appended. */
export function withCloses(body: string, number: number): string {
	const kept = body.trimEnd();
	return `${kept}${kept ? "\n\n" : ""}Closes #${number}\n`;
}

/** `gh pr view --json body`'s body; `null` for anything else. */
export function parsePrBody(out: string): string | null {
	try {
		const parsed: unknown = JSON.parse(out);
		return isRecord(parsed) && typeof parsed.body === "string" ? parsed.body : null;
	} catch {
		return null;
	}
}

interface Entry {
	key: string;
	issues: GithubIssue[];
	fetchedAt: number | null;
	/** The last fetch's start, failed or not: the TTL runs from it. */
	attemptedAt: number;
	error: string | null;
}

export type IssueRunner = (workspaceId: string, argv: string[]) => Promise<ExtensionRunResult>;

/**
 * Each project's open issues from the user's `gh`, run in its Default workspace: cached for a TTL from the
 * last attempt, read without waiting (a stale or missing list refreshes behind the read, `onChange` saying
 * when it landed), one fetch in flight per project. A failure keeps the last good issues beside its error.
 */
export class IssueCache {
	private readonly entries = new Map<string, Entry>();
	private readonly pending = new Map<string, Promise<void>>();
	private readonly run: IssueRunner;
	private readonly now: () => number;
	private readonly onChange: (projectId: string) => void;
	private readonly ttlMs: number;

	constructor(options: {
		run: IssueRunner;
		now: () => number;
		onChange: (projectId: string) => void;
		ttlMs?: number;
	}) {
		this.run = options.run;
		this.now = options.now;
		this.onChange = options.onChange;
		this.ttlMs = options.ttlMs ?? ISSUE_TTL_MS;
	}

	private entry(projectId: string, key: string): Entry | undefined {
		const entry = this.entries.get(projectId);
		return entry?.key === key ? entry : undefined;
	}

	private fetch(
		projectId: string,
		workspaceId: string | null,
		filter: GithubFilter,
	): Promise<void> {
		const running = this.pending.get(projectId);
		if (running) return running;
		const key = filter;
		const previous = this.entry(projectId, key);
		const attemptedAt = this.now();
		const settle = (patch: Partial<Entry>) => {
			this.entries.set(projectId, {
				key,
				issues: previous?.issues ?? [],
				fetchedAt: previous?.fetchedAt ?? null,
				attemptedAt,
				error: null,
				...patch,
			});
		};
		const task = (async () => {
			if (!workspaceId) {
				settle({ error: "The project has no Default workspace to run gh in." });
				return;
			}
			try {
				const run = await this.run(workspaceId, issueListArgv(filter));
				if (!run.ok) return settle({ error: runError(run, "gh issue list") });
				const issues = parseIssues(run.out);
				if (!issues)
					return settle({ error: "gh issue list answered something other than issues." });
				settle({ issues, fetchedAt: this.now(), error: null });
			} catch (error) {
				settle({ error: error instanceof Error ? error.message : String(error) });
			}
		})().finally(() => {
			this.pending.delete(projectId);
			this.onChange(projectId);
		});
		this.pending.set(projectId, task);
		return task;
	}

	/** The cached issues now; a missing or stale list starts a fetch behind the read. */
	read(projectId: string, workspaceId: string | null, filter: GithubFilter): GithubIssue[] {
		const entry = this.entry(projectId, filter);
		const stale = !entry || this.now() - entry.attemptedAt >= this.ttlMs;
		if (stale && !this.pending.has(projectId)) void this.fetch(projectId, workspaceId, filter);
		return entry?.issues ?? [];
	}

	/** Fetches now (joining one in flight) and answers once it landed. */
	async refresh(
		projectId: string,
		workspaceId: string | null,
		filter: GithubFilter,
	): Promise<void> {
		await this.pending.get(projectId);
		await this.fetch(projectId, workspaceId, filter);
	}

	status(projectId: string, enabled: boolean, filter: GithubFilter): GithubStatus {
		const entry = this.entry(projectId, filter);
		return {
			enabled,
			filter,
			loading: this.pending.has(projectId),
			fetchedAt: entry?.fetchedAt ?? null,
			error: entry?.error ?? null,
		};
	}

	issue(projectId: string, number: number): GithubIssue | undefined {
		return this.entries.get(projectId)?.issues.find((issue) => issue.number === number);
	}

	forget(projectId: string): void {
		this.entries.delete(projectId);
	}

	async idle(): Promise<void> {
		while (this.pending.size > 0) await Promise.all(this.pending.values());
	}
}
