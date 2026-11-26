import {
	HOTSPOT_FILES,
	HOTSPOT_RULES,
	type HotspotAction,
	type HotspotDir,
	type HotspotFile,
	type HotspotSort,
	type IndexState,
	type ListProject,
	METRIC_SOURCES,
	REWORK_CHANGES,
	SESSION_INSIGHTS_API_VERSION,
	type StatsHotspots,
	type StatsHotspotsParams,
	type StatsHotspotsResult,
} from "./core.ts";
import {
	parseStatsParams,
	type ScopedSession,
	type StatsInput,
	statsScope,
} from "./crossSession.ts";
import { byText } from "./stats.ts";
import { isRecord } from "./totals.ts";

const SORTS: readonly HotspotSort[] = ["touches", "changes", "sessions"];
const ACTIONS: readonly HotspotAction[] = [
	"spec",
	"test",
	"plan",
	"template",
	"split",
	"hub",
	"upfront",
	"review",
	"none",
];

export function parseHotspotsParams(value: unknown): StatsHotspotsParams {
	const { scope } = parseStatsParams(value, "stats.hotspots");
	const sort = isRecord(value) ? value.sort : undefined;
	if (sort === undefined) return { scope };
	if (typeof sort !== "string" || !(SORTS as readonly string[]).includes(sort))
		throw new Error("Invalid stats.hotspots params");
	return { scope, sort: sort as HotspotSort };
}

const TEST_FILE =
	/(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rs)$|(^|\/)test_[^/]*\.py$/;
const SPEC_FILE = /(^|\/)SPEC\.md$|\.spec\.md$/i;

export function isTestFile(path: string): boolean {
	return TEST_FILE.test(path);
}

export function isSpecFile(path: string): boolean {
	return SPEC_FILE.test(path);
}

/** Markdown inside a hidden folder: plans, task notes, PR bodies an agent writes for itself. */
export function isNotesFile(path: string): boolean {
	const parts = path.split("/");
	return (
		path.toLowerCase().endsWith(".md") &&
		parts.slice(0, -1).some((part) => part.startsWith(".") && part.length > 1)
	);
}

interface Facts {
	path: string;
	reads: number;
	touches: number;
	sessions: number;
	changedSessions: number;
	rework: number;
}

/** The first rule that matches names the file's action (`HOTSPOT_RULES`, in order). */
export function hotspotAction(file: Facts): HotspotAction {
	const reworked = file.rework >= REWORK_CHANGES;
	const notes = isNotesFile(file.path);
	if (isSpecFile(file.path) && file.changedSessions >= HOTSPOT_RULES.specSessions) return "spec";
	if (reworked && isTestFile(file.path)) return "test";
	if (reworked && notes) return "plan";
	if (notes && file.changedSessions >= HOTSPOT_RULES.templateSessions) return "template";
	if (file.rework >= HOTSPOT_RULES.splitChanges) return "split";
	if (file.changedSessions >= HOTSPOT_RULES.hubSessions) return "hub";
	if (
		file.touches > 0 &&
		file.reads / file.touches >= HOTSPOT_RULES.readShare &&
		file.sessions >= HOTSPOT_RULES.readSessions
	)
		return "upfront";
	if (reworked) return "review";
	return "none";
}

interface Draft extends Omit<HotspotFile, "touches" | "sessions" | "action"> {
	sessions: number[];
	newestOpen: number | null;
}

function touchesOf(file: { reads: number; edits: number; writes: number }): number {
	return file.reads + file.edits + file.writes;
}

function compare(sort: HotspotSort): (a: HotspotFile, b: HotspotFile) => number {
	const changes = (file: HotspotFile) => file.edits + file.writes;
	const touches = (file: HotspotFile) => file.touches.value ?? 0;
	const keys: ((file: HotspotFile) => number)[] =
		sort === "changes"
			? [changes, touches, (file) => file.sessions.length]
			: sort === "sessions"
				? [(file) => file.sessions.length, touches, changes]
				: [touches, changes, (file) => file.sessions.length];
	return (a, b) => {
		for (const key of keys) {
			const delta = key(b) - key(a);
			if (delta !== 0) return delta;
		}
		return byText(a.projectId ?? "", b.projectId ?? "") || byText(a.path, b.path);
	};
}

function dirsOf(files: readonly HotspotFile[]): HotspotDir[] {
	const dirs = new Map<string, HotspotDir>();
	for (const file of files) {
		const parts = file.path.split("/");
		for (let depth = 0; depth < parts.length; depth++) {
			const path = parts.slice(0, depth).join("/");
			const key = `${file.projectId ?? ""}\u0000${path}`;
			let dir = dirs.get(key);
			if (!dir) {
				dir = {
					projectId: file.projectId,
					path,
					touches: 0,
					reads: 0,
					edits: 0,
					writes: 0,
					failed: 0,
					added: 0,
					removed: 0,
					files: 0,
					rework: 0,
				};
				dirs.set(key, dir);
			}
			dir.touches += file.touches.value ?? 0;
			dir.reads += file.reads;
			dir.edits += file.edits;
			dir.writes += file.writes;
			dir.failed += file.failed;
			dir.added += file.added;
			dir.removed += file.removed;
			dir.files += 1;
			if (file.rework >= REWORK_CHANGES) dir.rework += 1;
		}
	}
	return [...dirs.values()].sort(
		(a, b) => byText(a.projectId ?? "", b.projectId ?? "") || byText(a.path, b.path),
	);
}

/** Files by touches across the scope's sessions, each with one rule-based action, and their folders. */
export function buildHotspots(
	sessions: readonly ScopedSession[],
	sort: HotspotSort,
	projects: readonly ListProject[] = [],
): StatsHotspots {
	const drafts = new Map<string, Draft>();
	let outside = 0;
	let nodeModules = 0;
	for (const { index, row, digest } of sessions) {
		outside += digest.outsideTouches;
		nodeModules += digest.nodeModulesTouches;
		for (const [path, file] of digest.files) {
			const key = `${row.projectId ?? ""}\u0000${path}`;
			let draft = drafts.get(key);
			if (!draft) {
				draft = {
					projectId: row.projectId,
					path,
					reads: 0,
					edits: 0,
					writes: 0,
					failed: 0,
					added: 0,
					removed: 0,
					sessions: [],
					changedSessions: 0,
					rework: 0,
					reworkSession: null,
					reworkSessions: 0,
					workspaceId: null,
					newestOpen: null,
				};
				drafts.set(key, draft);
			}
			draft.reads += file.reads;
			draft.edits += file.edits;
			draft.writes += file.writes;
			draft.failed += file.failed;
			draft.added += file.added;
			draft.removed += file.removed;
			draft.sessions.push(index);
			const changes = file.edits + file.writes;
			if (changes > 0) draft.changedSessions += 1;
			if (changes >= REWORK_CHANGES) draft.reworkSessions += 1;
			if (
				changes > draft.rework ||
				(changes === draft.rework && changes > 0 && index < (draft.reworkSession ?? index + 1))
			) {
				draft.rework = changes;
				draft.reworkSession = index;
			}
			if (
				row.workspaceState === "open" &&
				row.workspaceId !== null &&
				(draft.newestOpen === null || index < draft.newestOpen)
			) {
				draft.newestOpen = index;
				draft.workspaceId = row.workspaceId;
			}
		}
	}
	let touches = 0;
	const all: HotspotFile[] = [...drafts.values()].map((draft) => {
		const total = touchesOf(draft);
		touches += total;
		const sessionList = [...new Set(draft.sessions)].sort((a, b) => a - b);
		return {
			projectId: draft.projectId,
			path: draft.path,
			touches: { value: total, origin: "counted" },
			reads: draft.reads,
			edits: draft.edits,
			writes: draft.writes,
			failed: draft.failed,
			added: draft.added,
			removed: draft.removed,
			sessions: sessionList,
			changedSessions: draft.changedSessions,
			rework: draft.rework,
			reworkSession: draft.reworkSession,
			reworkSessions: draft.reworkSessions,
			workspaceId: draft.workspaceId,
			action: hotspotAction({
				path: draft.path,
				reads: draft.reads,
				touches: total,
				sessions: sessionList.length,
				changedSessions: draft.changedSessions,
				rework: draft.rework,
			}),
		};
	});
	const files = all
		.filter((file) => (file.touches.value ?? 0) > 0 || file.failed > 0)
		.sort(compare(sort))
		.slice(0, HOTSPOT_FILES);
	const actions = Object.fromEntries(ACTIONS.map((action) => [action, 0])) as Record<
		HotspotAction,
		number
	>;
	for (const file of files) actions[file.action] += 1;
	const present = new Set(files.map((file) => file.projectId));
	return {
		sort,
		projects: projects.filter((project) => present.has(project.id)),
		files,
		dirs: dirsOf(files),
		totalFiles: all.length,
		touches,
		outside,
		nodeModules,
		actions,
		rules: HOTSPOT_RULES,
		reworkChanges: REWORK_CHANGES,
	};
}

/** `stats.hotspots`: the scope's hotspot files and their folders. */
export async function buildStatsHotspots(
	input: StatsInput,
	state: IndexState,
	params: StatsHotspotsParams,
): Promise<StatsHotspotsResult> {
	const scope = await statsScope(input, state);
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		digests: scope.progress,
		sessions: scope.sessions,
		hotspots: buildHotspots(scope.ready, params.sort ?? "touches", input.projects),
		sources: METRIC_SOURCES,
	};
}
