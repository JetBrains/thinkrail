import { isYamlMap, parseYaml, type YamlValue } from "./yaml";

/** A text file of a workspace's `openspec/` tree, its path worktree-relative. */
export interface TreeFile {
	path: string;
	text: string;
}

/** A workspace's `openspec/` tree as the host reads it: its markdown and YAML files. */
export interface OpenspecTree {
	files: readonly TreeFile[];
}

export type ArtifactStatus = "done" | "ready" | "blocked" | "skipped";

export interface ArtifactState {
	id: string;
	outputPath: string;
	status: ArtifactStatus;
	requires: string[];
	missingDeps?: string[];
	/** Its existing outputs, worktree-relative. */
	files: string[];
}

export const DELTA_OPERATIONS = ["ADDED", "MODIFIED", "REMOVED", "RENAMED"] as const;
export type DeltaOperation = (typeof DELTA_OPERATIONS)[number];

/** A capability's delta counts in one change: `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`. */
export interface DeltaCount {
	capability: string;
	/** The delta file, worktree-relative. */
	path: string;
	added: number;
	modified: number;
	removed: number;
	renamed: number;
}

export interface DeltaRequirement {
	capability: string;
	operation: DeltaOperation;
	name: string;
}

export interface TaskLine {
	done: boolean;
	text: string;
	path: string;
	line: number;
}

/** openspec-ui's derived stages, the spec-driven preset's columns. */
export const STAGES = ["planning", "ready", "in-progress", "complete", "archived"] as const;
export type Stage = (typeof STAGES)[number];

export interface OpenspecChange {
	/** Its folder's name: an archived change's carries the archive date. */
	name: string;
	/** The name without an archived folder's `YYYY-MM-DD-` prefix. */
	baseName: string;
	archived: boolean;
	/** Its folder, worktree-relative. */
	dir: string;
	schema: string;
	/** Why the artifact chain is unknown (a schema OpenSpec could not resolve, unreadable metadata). */
	error?: string;
	/** In the schema's build order; empty with an `error`. */
	artifacts: ArtifactState[];
	isComplete: boolean;
	/** The artifact OpenSpec says to write next. */
	nextArtifact: string | null;
	tasks: { completed: number; total: number };
	taskLines: TaskLine[];
	deltas: DeltaCount[];
	requirements: DeltaRequirement[];
	/** The proposal's `# ` heading, else the name. */
	title: string;
	/** The metadata's goal, else the proposal's Why. */
	summary: string;
	/** The `x-thinkrail` extension key's string fields. */
	thinkrail: Record<string, string> | null;
}

const OPENSPEC = "openspec";
const CHANGES = `${OPENSPEC}/changes`;
const ARCHIVE = `${CHANGES}/archive`;
const METADATA = ".openspec.yaml";
const ARCHIVED_NAME = /^\d{4}-\d{2}-\d{2}-(.+)$/;
const SUMMARY_MAX = 600;

/** OpenSpec's own task line (`src/utils/task-progress.ts`), verbatim: only `x` / `X` is done. */
export const TASK_LINE_PATTERN =
	/^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/;

/** Every task line of a tasks file, fenced and commented ones included, exactly as OpenSpec counts them. */
export function taskLines(text: string, path = ""): TaskLine[] {
	const lines: TaskLine[] = [];
	text.split("\n").forEach((line, index) => {
		const match = TASK_LINE_PATTERN.exec(line);
		if (match)
			lines.push({
				done: (match[1] ?? "").toLowerCase() === "x",
				text: (match[2] ?? "").trim(),
				path,
				line: index + 1,
			});
	});
	return lines;
}

interface SchemaArtifact {
	id: string;
	generates: string;
	requires: string[];
}

interface Schema {
	name: string;
	artifacts: SchemaArtifact[];
	apply?: { requires?: string[]; tracks?: string | null };
}

/** The one schema OpenSpec ships (`schemas/spec-driven/schema.yaml`), recorded from 2.1.0. */
export const SPEC_DRIVEN: Schema = {
	name: "spec-driven",
	artifacts: [
		{ id: "proposal", generates: "proposal.md", requires: [] },
		{ id: "specs", generates: "specs/**/*.md", requires: ["proposal"] },
		{ id: "design", generates: "design.md", requires: ["proposal"] },
		{ id: "tasks", generates: "tasks.md", requires: ["specs", "design"] },
	],
	apply: { requires: ["tasks"], tracks: "tasks.md" },
};

const strings = (value: YamlValue | undefined): string[] | null =>
	value === undefined || value === null
		? []
		: Array.isArray(value) && value.every((item) => typeof item === "string")
			? (value as string[])
			: null;

function readSchema(text: string): Schema | string {
	let raw: YamlValue;
	try {
		raw = parseYaml(text);
	} catch (error) {
		return `its schema.yaml does not parse: ${error instanceof Error ? error.message : error}`;
	}
	if (!isYamlMap(raw) || typeof raw.name !== "string" || !Array.isArray(raw.artifacts))
		return "its schema.yaml has no name or artifacts";
	const artifacts: SchemaArtifact[] = [];
	for (const entry of raw.artifacts) {
		const requires = isYamlMap(entry) ? strings(entry.requires) : null;
		if (
			!isYamlMap(entry) ||
			typeof entry.id !== "string" ||
			typeof entry.generates !== "string" ||
			!requires
		)
			return "an artifact of its schema.yaml lacks an id or generates";
		artifacts.push({ id: entry.id, generates: entry.generates, requires });
	}
	const ids = new Set(artifacts.map((artifact) => artifact.id));
	if (artifacts.some((artifact) => artifact.requires.some((id) => !ids.has(id))))
		return "an artifact of its schema.yaml requires an unknown artifact";
	const apply = isYamlMap(raw.apply) ? raw.apply : null;
	const tracks = apply?.tracks;
	return {
		name: raw.name,
		artifacts,
		...(apply
			? {
					apply: {
						...(strings(apply.requires) ? { requires: strings(apply.requires) ?? [] } : {}),
						...(typeof tracks === "string" || tracks === null ? { tracks } : {}),
					},
				}
			: {}),
	};
}

/** Brace alternatives expanded (`{a,b}`), one level at a time. */
function expandBraces(pattern: string): string[] {
	const match = /\{([^{}]*,[^{}]*)\}/.exec(pattern);
	if (!match) return [pattern];
	const [whole, body = ""] = match;
	return body.split(",").flatMap((option) => expandBraces(pattern.replace(whole, option)));
}

function segmentRegex(segment: string): RegExp {
	let source = "";
	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index] ?? "";
		if (char === "*") source += "[^/]*";
		else if (char === "?") source += "[^/]";
		else if (char === "[") {
			const end = segment.indexOf("]", index + 1);
			if (end < 0) source += "\\[";
			else {
				source += `[${segment
					.slice(index + 1, end)
					.replace(/^!/, "^")
					.replace(/\\/g, "\\\\")}]`;
				index = end;
			}
		} else source += char.replace(/[.+^${}()|\\]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

function matchSegments(pattern: readonly string[], path: readonly string[]): boolean {
	const [head, ...rest] = pattern;
	if (head === undefined) return path.length === 0;
	if (head === "**") {
		for (let skip = 0; skip <= path.length; skip += 1) {
			if (path.slice(0, skip).some((segment) => segment.startsWith("."))) break;
			if (matchSegments(rest, path.slice(skip))) return true;
		}
		return false;
	}
	const [first, ...others] = path;
	if (first === undefined) return false;
	if (first.startsWith(".") && !head.startsWith(".")) return false;
	return segmentRegex(head).test(first) && matchSegments(rest, others);
}

const isGlob = (pattern: string) => /[*?[]|\{[^}]*,/.test(pattern);

/** Whether a change-relative path matches an artifact's `generates` glob (picomatch-like, no dotfiles). */
export function matchesGlob(pattern: string, path: string): boolean {
	const parts = path.split("/");
	return expandBraces(pattern.replace(/\/{2,}/g, "/")).some((expanded) =>
		matchSegments(expanded.split("/"), parts),
	);
}

interface Context {
	text: ReadonlyMap<string, string>;
	config: string | null;
}

function resolveSchema(name: string, context: Context): Schema | string {
	const custom = context.text.get(`${OPENSPEC}/schemas/${name}/schema.yaml`);
	if (custom !== undefined) {
		const schema = readSchema(custom);
		return typeof schema === "string" ? `Schema '${name}' is invalid: ${schema}.` : schema;
	}
	if (name === SPEC_DRIVEN.name) return SPEC_DRIVEN;
	return `Schema '${name}' not found in openspec/schemas/ (a schema installed for the user only is not read).`;
}

interface Metadata {
	schema?: string;
	goal?: string;
	skipSpecs: boolean;
	thinkrail: Record<string, string> | null;
	error?: string;
}

function readMetadata(text: string | undefined): Metadata {
	if (text === undefined) return { skipSpecs: false, thinkrail: null };
	let raw: YamlValue;
	try {
		raw = parseYaml(text);
	} catch (error) {
		return {
			skipSpecs: false,
			thinkrail: null,
			error: `Invalid YAML in ${METADATA}: ${error instanceof Error ? error.message : error}`,
		};
	}
	if (!isYamlMap(raw) || typeof raw.schema !== "string" || !raw.schema)
		return { skipSpecs: false, thinkrail: null, error: `${METADATA} has no schema.` };
	const extension = raw["x-thinkrail"];
	const thinkrail = isYamlMap(extension)
		? Object.fromEntries(
				Object.entries(extension).flatMap(([key, value]) =>
					typeof value === "string" ? [[key, value]] : [],
				),
			)
		: null;
	return {
		schema: raw.schema,
		...(typeof raw.goal === "string" ? { goal: raw.goal } : {}),
		skipSpecs: raw.skip_specs === true,
		thinkrail,
	};
}

/** Kahn's order, ties broken by where the schema declares each artifact (OpenSpec's `getBuildOrder`). */
function buildOrder(artifacts: readonly SchemaArtifact[]): string[] {
	const position = new Map(artifacts.map((artifact, index) => [artifact.id, index]));
	const degree = new Map(artifacts.map((artifact) => [artifact.id, artifact.requires.length]));
	const byPosition = (a: string, b: string) => (position.get(a) ?? 0) - (position.get(b) ?? 0);
	const queue = artifacts
		.filter((artifact) => artifact.requires.length === 0)
		.map((artifact) => artifact.id);
	const order: string[] = [];
	while (queue.length > 0) {
		queue.sort(byPosition);
		const current = queue.shift() ?? "";
		order.push(current);
		for (const artifact of artifacts)
			if (artifact.requires.includes(current)) {
				const left = (degree.get(artifact.id) ?? 0) - 1;
				degree.set(artifact.id, left);
				if (left === 0) queue.push(artifact.id);
			}
	}
	return order;
}

function outputsOf(dir: string, generates: string, files: readonly string[]): string[] {
	const relative = files.map((path) => path.slice(dir.length + 1));
	const pattern = generates.replace(/\\/g, "/").replace(/^\.\//, "");
	return isGlob(pattern)
		? relative.filter((path) => matchesGlob(pattern, path)).sort()
		: relative.filter((path) => path === pattern);
}

function artifactStates(
	schema: Schema,
	dir: string,
	files: readonly string[],
	skipSpecs: boolean,
): ArtifactState[] {
	const outputs = new Map(
		schema.artifacts.map((artifact) => [artifact.id, outputsOf(dir, artifact.generates, files)]),
	);
	const completed = new Set(
		schema.artifacts
			.filter((artifact) => (outputs.get(artifact.id) ?? []).length > 0)
			.map((artifact) => artifact.id),
	);
	const skipped = new Set(
		skipSpecs
			? schema.artifacts
					.filter(
						(artifact) =>
							!completed.has(artifact.id) &&
							artifact.generates.replace(/^\.\//, "").startsWith("specs/"),
					)
					.map((artifact) => artifact.id)
			: [],
	);
	for (const id of skipped) completed.add(id);
	const position = new Map(schema.artifacts.map((artifact, index) => [artifact.id, index]));
	const order = buildOrder(schema.artifacts);
	const rank = new Map(order.map((id, index) => [id, index]));
	return [...schema.artifacts]
		.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
		.map((artifact): ArtifactState => {
			const base = {
				id: artifact.id,
				outputPath: artifact.generates,
				requires: artifact.requires,
				files: (outputs.get(artifact.id) ?? []).map((path) => `${dir}/${path}`),
			};
			if (skipped.has(artifact.id)) return { ...base, status: "skipped" };
			if (completed.has(artifact.id)) return { ...base, status: "done" };
			const missing = artifact.requires
				.filter((id) => !completed.has(id))
				.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
			return missing.length === 0
				? { ...base, status: "ready" }
				: { ...base, status: "blocked", missingDeps: missing };
		});
}

/** The tracked task files: the artifact `apply.tracks` names (else `tasks`), else a top-level tasks.md. */
function taskFiles(
	schema: Schema | null,
	dir: string,
	files: readonly string[],
	text: ReadonlyMap<string, string>,
): string[] {
	const tracks = schema?.apply?.tracks;
	const artifact = schema
		? tracks !== undefined && tracks !== null
			? schema.artifacts.find((candidate) => candidate.generates === tracks)
			: schema.artifacts.find((candidate) => candidate.id === "tasks")
		: undefined;
	const tracked = artifact
		? outputsOf(dir, artifact.generates, files).map((path) => `${dir}/${path}`)
		: [];
	if (tracked.length > 0) return tracked;
	const fallback = `${dir}/tasks.md`;
	return text.has(fallback) ? [fallback] : [];
}

/** OpenSpec's fence mask (`code-fence.ts`): a ``` or ~~~ run opens, the same marker at least as long closes. */
function fenceMask(lines: readonly string[]): boolean[] {
	const mask = lines.map(() => false);
	let fence: { marker: string; length: number } | null = null;
	lines.forEach((line, index) => {
		if (!fence) {
			const open = /^\s*(`{3,}|~{3,})(.*)/.exec(line);
			if (open?.[1] && !(open[1][0] === "`" && (open[2] ?? "").includes("`"))) {
				fence = { marker: open[1][0] ?? "`", length: open[1].length };
				mask[index] = true;
			}
			return;
		}
		mask[index] = true;
		const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
		if (close?.[1] && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null;
	});
	return mask;
}

const REQUIREMENT = /^###\s*Requirement:\s*(.+)\s*$/i;
const closing = (title: string) => title.replace(/[ \t]+#+[ \t]*$/, "").trim();

/** A delta spec's requirements by operation, read the way OpenSpec's `parseDeltaSpec` reads them. */
export function deltaRequirements(
	text: string,
): { operation: DeltaOperation; name: string }[] | null {
	const lines = text
		.replace(/^\uFEFF/, "")
		.replace(/\r\n?/g, "\n")
		.split("\n");
	const mask = fenceMask(lines);
	const found: { operation: DeltaOperation; name: string }[] = [];
	let section: DeltaOperation | null = null;
	let any = false;
	let pending: string | null = null;
	lines.forEach((line, index) => {
		if (mask[index]) return;
		const heading = /^(##)\s+(.+)$/.exec(line);
		if (heading) {
			const title = closing(heading[2] ?? "").toLowerCase();
			section =
				DELTA_OPERATIONS.find((operation) => `${operation.toLowerCase()} requirements` === title) ??
				null;
			if (section) any = true;
			pending = null;
			return;
		}
		if (!section) return;
		const header = REQUIREMENT.exec(line);
		if (section === "RENAMED") {
			const from = /^\s*[-*+]?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(line);
			const to = /^\s*[-*+]?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(line);
			if (from) pending = closing(from[1] ?? "");
			else if (to && pending !== null) {
				found.push({ operation: "RENAMED", name: `${pending} → ${closing(to[1] ?? "")}` });
				pending = null;
			}
			return;
		}
		if (header) {
			found.push({ operation: section, name: closing(header[1] ?? "") });
			return;
		}
		const bullet =
			section === "REMOVED" ? /^\s*[-*+]\s*`?###\s*Requirement:\s*(.+?)`?\s*$/.exec(line) : null;
		if (bullet) found.push({ operation: "REMOVED", name: closing(bullet[1] ?? "") });
	});
	return any ? found : null;
}

function firstHeading(text: string | undefined): string | null {
	if (!text) return null;
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const mask = fenceMask(lines);
	const index = lines.findIndex((line, at) => !mask[at] && /^#\s+\S/.test(line));
	return index < 0 ? null : closing((lines[index] ?? "").replace(/^#\s+/, "")) || null;
}

function whySection(text: string | undefined): string {
	if (!text) return "";
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const start = lines.findIndex((line) => /^##\s+why\s*$/i.test(line.trim()));
	if (start < 0) return "";
	const body: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^#{1,2}\s/.test(line)) break;
		body.push(line);
	}
	const paragraph =
		body
			.join("\n")
			.trim()
			.split(/\n\s*\n/)[0] ?? "";
	return paragraph.replace(/\s+/g, " ").trim();
}

const clip = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** The stage openspec-ui derives: archived by location, else by the tracked tasks' checkboxes. */
export function stageOf(change: {
	archived: boolean;
	tasks: { completed: number; total: number };
}): Stage {
	if (change.archived) return "archived";
	const { completed, total } = change.tasks;
	if (total === 0) return "planning";
	if (completed === 0) return "ready";
	return completed < total ? "in-progress" : "complete";
}

function readChange(name: string, archived: boolean, context: Context): OpenspecChange {
	const dir = `${archived ? ARCHIVE : CHANGES}/${name}`;
	const files = [...context.text.keys()].filter((path) => path.startsWith(`${dir}/`)).sort();
	const metadata = readMetadata(context.text.get(`${dir}/${METADATA}`));
	let configSchema: string | undefined;
	if (!context.text.has(`${dir}/${METADATA}`) && context.config !== null) {
		try {
			const config = parseYaml(context.config);
			if (isYamlMap(config) && typeof config.schema === "string" && config.schema)
				configSchema = config.schema;
		} catch {}
	}
	const schemaName = metadata.schema ?? configSchema ?? SPEC_DRIVEN.name;
	const schema = metadata.error ? metadata.error : resolveSchema(schemaName, context);
	const error = typeof schema === "string" ? schema : undefined;
	const artifacts =
		typeof schema === "string" ? [] : artifactStates(schema, dir, files, metadata.skipSpecs);
	const lines = taskFiles(
		typeof schema === "string" ? null : schema,
		dir,
		files,
		context.text,
	).flatMap((path) => taskLines(context.text.get(path) ?? "", path));
	const deltas: DeltaCount[] = [];
	const requirements: DeltaRequirement[] = [];
	for (const path of files) {
		const spec = new RegExp(
			`^${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/specs/(.+)/spec\\.md$`,
		).exec(path);
		const capability = spec?.[1];
		if (!capability || capability.split("/").some((segment) => segment.startsWith("."))) continue;
		const found = deltaRequirements(context.text.get(path) ?? "");
		if (!found) continue;
		const count = (operation: DeltaOperation) =>
			found.filter((entry) => entry.operation === operation).length;
		deltas.push({
			capability,
			path,
			added: count("ADDED"),
			modified: count("MODIFIED"),
			removed: count("REMOVED"),
			renamed: count("RENAMED"),
		});
		requirements.push(...found.map((entry) => ({ capability, ...entry })));
	}
	deltas.sort((a, b) => (a.capability < b.capability ? -1 : a.capability > b.capability ? 1 : 0));
	const proposal = context.text.get(`${dir}/proposal.md`);
	const completed = artifacts.every(
		(artifact) => artifact.status === "done" || artifact.status === "skipped",
	);
	return {
		name,
		baseName: archived ? (ARCHIVED_NAME.exec(name)?.[1] ?? name) : name,
		archived,
		dir,
		schema: schemaName,
		...(error ? { error } : {}),
		artifacts,
		isComplete: !error && completed,
		nextArtifact: artifacts.find((artifact) => artifact.status === "ready")?.id ?? null,
		tasks: {
			completed: lines.filter((line) => line.done).length,
			total: lines.length,
		},
		taskLines: lines,
		deltas,
		requirements,
		title: firstHeading(proposal) ?? name,
		summary: clip(metadata.goal ?? whySection(proposal), SUMMARY_MAX),
		thinkrail: metadata.thinkrail,
	};
}

/**
 * The change folders under `changes/` (archive aside) and under `changes/archive/` that hold a text file,
 * hidden ones skipped.
 */
function changeNames(tree: OpenspecTree): { name: string; archived: boolean }[] {
	const found = new Map<string, { name: string; archived: boolean }>();
	for (const { path } of tree.files) {
		const archived = path.startsWith(`${ARCHIVE}/`);
		const rest = path.slice((archived ? ARCHIVE : CHANGES).length + 1);
		if (!path.startsWith(`${CHANGES}/`)) continue;
		const [name, ...below] = rest.split("/");
		if (!name || below.length === 0 || name.startsWith(".")) continue;
		if (!archived && name === "archive") continue;
		found.set(`${archived}:${name}`, { name, archived });
	}
	return [...found.values()].sort((a, b) =>
		a.archived === b.archived
			? a.name < b.name
				? -1
				: a.name > b.name
					? 1
					: 0
			: a.archived
				? 1
				: -1,
	);
}

/** Every change of a workspace's `openspec/` tree, active ones first, each by name. */
export function parseOpenspec(tree: OpenspecTree): OpenspecChange[] {
	const text = new Map(tree.files.map((file) => [file.path, file.text]));
	const context: Context = { text, config: text.get(`${OPENSPEC}/config.yaml`) ?? null };
	return changeNames(tree).map(({ name, archived }) => readChange(name, archived, context));
}
