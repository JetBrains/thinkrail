import type { ArtifactState, ArtifactStatus, OpenspecChange } from "./parse";

/** How long one `openspec` run may take. */
export const OPENSPEC_TIMEOUT_MS = 30_000;

/** The CLI's argv, always the user's own `openspec` by name and never a shell string. */
export const OPENSPEC_ARGV = {
	version: ["openspec", "--version"],
	list: ["openspec", "list", "--all", "--json", "--sort", "name"],
	status: ["openspec", "status", "--all", "--json"],
	validateAll: ["openspec", "validate", "--all", "--strict", "--json"],
} as const;

export function validateArgv(change: string): string[] {
	return ["openspec", "validate", change, "--strict", "--json"];
}

export interface ListEntry {
	name: string;
	completedTasks: number;
	totalTasks: number;
	status: "no-tasks" | "in-progress" | "complete";
	archived: boolean;
}

export interface StatusEntry {
	changeName: string;
	schemaName?: string;
	isComplete?: boolean;
	artifacts?: Pick<ArtifactState, "id" | "outputPath" | "status" | "requires" | "missingDeps">[];
	nextArtifact?: string | null;
	/** The change could not be read (`change_error`): the reason. */
	error?: string;
}

export interface ValidationIssue {
	level: "ERROR" | "WARNING" | "INFO";
	message: string;
	path?: string;
	line?: number;
}

/** `openspec validate --strict`'s verdict on one change. */
export interface Validation {
	valid: boolean;
	errors: number;
	warnings: number;
	issues: ValidationIssue[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function json(out: string): unknown {
	try {
		return JSON.parse(out);
	} catch {
		return undefined;
	}
}

const LIST_STATUSES = new Set(["no-tasks", "in-progress", "complete"]);
const ARTIFACT_STATUSES = new Set<ArtifactStatus>(["done", "ready", "blocked", "skipped"]);
const LEVELS = new Set(["ERROR", "WARNING", "INFO"]);
const ISSUES_MAX = 50;
const MESSAGE_MAX = 500;

/** `openspec --version`'s answer: a version, else `null`. */
export function readVersion(out: string): string | null {
	const line = out.trim().split("\n")[0]?.trim() ?? "";
	return /^\d+\.\d+/.test(line) ? line.slice(0, 40) : null;
}

/** `openspec list --all --json`'s changes; `null` for any other answer. */
export function readList(out: string): ListEntry[] | null {
	const value = json(out);
	if (!isRecord(value) || !Array.isArray(value.changes)) return null;
	return value.changes.flatMap((raw): ListEntry[] => {
		if (!isRecord(raw) || typeof raw.name !== "string") return [];
		const { completedTasks, totalTasks, status } = raw;
		if (typeof completedTasks !== "number" || typeof totalTasks !== "number") return [];
		if (typeof status !== "string" || !LIST_STATUSES.has(status)) return [];
		return [
			{
				name: raw.name,
				completedTasks,
				totalTasks,
				status: status as ListEntry["status"],
				archived: raw.archived === true,
			},
		];
	});
}

const NEXT_STEP = /^Run openspec instructions (\S+) --change /;

/** `openspec status --all --json`'s changes (a change it could not read carries its reason); `null` otherwise. */
export function readStatus(out: string): StatusEntry[] | null {
	const value = json(out);
	if (!isRecord(value) || !Array.isArray(value.changes)) return null;
	return value.changes.flatMap((raw): StatusEntry[] => {
		if (!isRecord(raw) || typeof raw.changeName !== "string") return [];
		if (!Array.isArray(raw.artifacts)) {
			const [first] = Array.isArray(raw.status) ? raw.status : [];
			const message = isRecord(first) && typeof first.message === "string" ? first.message : "";
			return [{ changeName: raw.changeName, error: message || "OpenSpec could not read it." }];
		}
		const artifacts = raw.artifacts.flatMap((artifact): NonNullable<StatusEntry["artifacts"]> => {
			if (!isRecord(artifact) || typeof artifact.id !== "string") return [];
			const status = artifact.status as ArtifactStatus;
			if (!ARTIFACT_STATUSES.has(status)) return [];
			const strings = (list: unknown) =>
				Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
			return [
				{
					id: artifact.id,
					outputPath: typeof artifact.outputPath === "string" ? artifact.outputPath : "",
					status,
					requires: strings(artifact.requires),
					...(Array.isArray(artifact.missingDeps)
						? { missingDeps: strings(artifact.missingDeps) }
						: {}),
				},
			];
		});
		const [step] = Array.isArray(raw.nextSteps) ? raw.nextSteps : [];
		const next = typeof step === "string" ? NEXT_STEP.exec(step)?.[1] : undefined;
		return [
			{
				changeName: raw.changeName,
				...(typeof raw.schemaName === "string" ? { schemaName: raw.schemaName } : {}),
				isComplete: raw.isComplete === true,
				artifacts,
				nextArtifact: next && next !== "apply" ? next : null,
			},
		];
	});
}

const clip = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** `openspec validate --json`'s verdicts on changes, by change id; `null` for any other answer. */
export function readValidation(out: string): Map<string, Validation> | null {
	const value = json(out);
	if (!isRecord(value) || !Array.isArray(value.items)) return null;
	const verdicts = new Map<string, Validation>();
	for (const item of value.items) {
		if (!isRecord(item) || typeof item.id !== "string" || item.type !== "change") continue;
		const issues = (Array.isArray(item.issues) ? item.issues : []).flatMap(
			(issue): ValidationIssue[] =>
				isRecord(issue) &&
				typeof issue.level === "string" &&
				LEVELS.has(issue.level) &&
				typeof issue.message === "string"
					? [
							{
								level: issue.level as ValidationIssue["level"],
								message: clip(issue.message, MESSAGE_MAX),
								...(typeof issue.path === "string" ? { path: issue.path } : {}),
								...(typeof issue.line === "number" ? { line: issue.line } : {}),
							},
						]
					: [],
		);
		verdicts.set(item.id, {
			valid: item.valid === true,
			errors: issues.filter((issue) => issue.level === "ERROR").length,
			warnings: issues.filter((issue) => issue.level === "WARNING").length,
			issues: issues.slice(0, ISSUES_MAX),
		});
	}
	return verdicts;
}

export interface CliReading {
	list: ListEntry[];
	status: StatusEntry[];
	validation: Map<string, Validation>;
}

/**
 * The parsed changes with the CLI's answers laid over them, the CLI being authoritative: `list`'s task
 * counts, `status`'s schema and artifact chain (a change it could not read keeps its reason, no chain).
 * The parser still supplies what the CLI does not say in one call: paths, deltas, titles.
 */
export function withCli(
	changes: readonly OpenspecChange[],
	cli: Pick<CliReading, "list" | "status">,
): OpenspecChange[] {
	const listed = new Map(cli.list.map((entry) => [`${entry.archived}:${entry.name}`, entry]));
	const status = new Map(cli.status.map((entry) => [entry.changeName, entry]));
	return changes.map((change) => {
		const entry = listed.get(`${change.archived}:${change.name}`);
		const state = change.archived ? undefined : status.get(change.name);
		const next: OpenspecChange = {
			...change,
			...(entry ? { tasks: { completed: entry.completedTasks, total: entry.totalTasks } } : {}),
		};
		if (!state) return next;
		if (state.error !== undefined) {
			const { error: _parsed, ...rest } = next;
			return { ...rest, error: state.error, artifacts: [], isComplete: false, nextArtifact: null };
		}
		const files = new Map(change.artifacts.map((artifact) => [artifact.id, artifact.files]));
		const { error: _none, ...rest } = next;
		return {
			...rest,
			schema: state.schemaName ?? change.schema,
			artifacts: (state.artifacts ?? []).map((artifact) => ({
				...artifact,
				files: files.get(artifact.id) ?? [],
			})),
			isComplete: state.isComplete === true,
			nextArtifact: state.nextArtifact ?? null,
		};
	});
}
