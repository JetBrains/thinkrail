import type { PreparedContent, SearchGroup, SearchHit, Workspace } from "@thinkrail/contracts";
import {
	contentRanges,
	foldMatchText,
	MATCH_TIER,
	type MatchRange,
	type MatchTerm,
	matchContent,
	matchFields,
	prepareContent,
	searchHitFields,
} from "@thinkrail/contracts";
import type { HistorySession, HistoryState } from "../history";
import type { SpecSnapshot } from "../spec";
import type { StoredPlanFile } from "../todos";
import type { FileListCache } from "./files";
import {
	buildGroup,
	compactWhitespace,
	compareHits,
	type Deadline,
	emptyGroup,
	groupOf,
	lineAround,
	snippetAround,
} from "./hits";

export interface SearchRoot {
	readonly root: string;
	readonly projectId: string;
	readonly workspaceId: string;
	/** A chat without a project is never a repository: its files are walked, never asked of git. */
	readonly git: boolean;
}

export interface ProviderInput {
	readonly terms: readonly MatchTerm[];
	readonly limit: number;
	readonly deadline: Deadline;
}

const SCAN_CHECK_EVERY = 1_000;
const MIN_BODY_TERM_LENGTH = 3;
const TRANSCRIPT_TEXT_PREVIEW = 160;

const preparedContent = new WeakMap<object, PreparedContent>();

function preparedOf(owner: object, text: string): PreparedContent {
	let prepared = preparedContent.get(owner);
	if (!prepared) {
		prepared = prepareContent(text);
		preparedContent.set(owner, prepared);
	}
	return prepared;
}

function foldedTermsOf(input: ProviderInput): string[] {
	return input.terms.map((term) => foldMatchText(term.text)).filter(Boolean);
}

function isSubsequence(text: string, term: string): boolean {
	let at = 0;
	for (const char of term) {
		at = text.indexOf(char, at);
		if (at === -1) return false;
		at += 1;
	}
	return true;
}

function wireRanges(ranges: readonly MatchRange[]): [number, number][] {
	return ranges.map(([start, end]) => [start, end]);
}

function rangesOf(match: { fields: readonly { key: string; ranges: readonly MatchRange[] }[] }) {
	const ranges: Record<string, [number, number][]> = {};
	for (const field of match.fields) ranges[field.key] = wireRanges(field.ranges);
	return ranges;
}

export type FileStat = (root: string, path: string) => number | "missing" | null;

type FileHit = Extract<SearchHit, { kind: "file" }>;
type SpecHit = Extract<SearchHit, { kind: "spec" }>;
type TranscriptHit = Extract<SearchHit, { kind: "transcript" }>;

export function searchFiles(
	root: SearchRoot,
	lists: FileListCache,
	input: ProviderInput,
	stat: FileStat,
): SearchGroup {
	const view = lists.peek(root.root, root.git);
	if (!view) return emptyGroup("file", "indexing");
	const { list, state } = view;
	const hits: FileHit[] = [];
	const foldedTerms = input.terms.map((term) => ({
		text: foldMatchText(term.text),
		literal: term.literal,
	}));
	let truncated = false;
	let scanned = 0;
	const pushHit = (path: string, match: NonNullable<ReturnType<typeof matchFields>>) => {
		const slash = path.lastIndexOf("/");
		hits.push({
			id: `file:${root.workspaceId}:${path}`,
			kind: "file",
			title: slash === -1 ? path : path.slice(slash + 1),
			...(slash === -1 ? {} : { subtitle: path.slice(0, slash) }),
			tier: match.tier,
			score: match.score,
			ranges: rangesOf(match),
			projectId: root.projectId,
			workspaceId: root.workspaceId,
			path,
		});
	};
	const expired = () => {
		scanned += 1;
		if (scanned % SCAN_CHECK_EVERY !== 0 || !input.deadline.expired()) return false;
		truncated = true;
		return true;
	};
	const rest: number[] = [];
	for (let index = 0; index < list.paths.length && !truncated; index += 1) {
		if (expired()) break;
		const folded = list.folded[index] ?? "";
		if (!foldedTerms.every((term) => folded.includes(term.text))) {
			const candidate = foldedTerms.every((term) =>
				term.literal ? folded.includes(term.text) : isSubsequence(folded, term.text),
			);
			if (candidate) rest.push(index);
			continue;
		}
		const path = list.paths[index] ?? "";
		const match = matchFields(input.terms, searchHitFields({ kind: "file", path }));
		if (match) pushHit(path, match);
	}
	for (const index of rest) {
		if (truncated || expired()) break;
		const path = list.paths[index] ?? "";
		const match = matchFields(input.terms, searchHitFields({ kind: "file", path }));
		if (match) pushHit(path, match);
	}
	hits.sort(compareHits);
	const page: FileHit[] = [];
	let missing = 0;
	for (const hit of hits) {
		if (page.length >= input.limit) break;
		const size = stat(root.root, hit.path);
		if (size !== "missing") {
			page.push(size === null ? hit : { ...hit, size });
			continue;
		}
		missing += 1;
		if (input.deadline.expired()) {
			truncated = true;
			break;
		}
	}
	return groupOf("file", page, hits.length - missing, {
		state,
		timeCut: truncated,
		...(list.truncated ? { fileList: list.paths.length } : {}),
	});
}

export function searchSpecs(
	root: SearchRoot,
	snapshot: (root: string) => SpecSnapshot,
	input: ProviderInput,
): SearchGroup {
	const hits: SpecHit[] = [];
	const folded = foldedTermsOf(input);
	const bodyTerms = folded.some((text) => text.length >= MIN_BODY_TERM_LENGTH);
	const { entries, built, rebuilding } = snapshot(root.root);
	const state = !built ? "indexing" : rebuilding ? "refreshing" : "ready";
	for (const entry of entries) {
		if (input.deadline.expired()) {
			return buildGroup("spec", hits, input.limit, { state, timeCut: true });
		}
		const match = matchFields(
			input.terms,
			searchHitFields({ kind: "spec", title: entry.title, specId: entry.id, path: entry.path }),
		);
		const base = {
			id: `spec:${root.workspaceId}:${entry.path}`,
			kind: "spec" as const,
			title: entry.title,
			subtitle: entry.path,
			size: Buffer.byteLength(entry.content),
			projectId: root.projectId,
			workspaceId: root.workspaceId,
			path: entry.path,
			specId: entry.id,
		};
		if (match) {
			hits.push({ ...base, tier: match.tier, score: match.score, ranges: rangesOf(match) });
			continue;
		}
		if (!bodyTerms) continue;
		const body = matchContent(folded, preparedOf(entry, entry.content));
		const first = body?.ranges[0];
		if (!first) continue;
		const snippet = lineAround(entry.content, first);
		hits.push({
			...base,
			snippet,
			tier: MATCH_TIER.content,
			score: 0,
			ranges: { snippet: wireRanges(contentRanges(folded, prepareContent(snippet))) },
		});
	}
	return buildGroup("spec", hits, input.limit, { state });
}

export interface ChatLabel {
	readonly projectId: string;
	readonly workspaceId: string;
}

function lastActivity(session: HistorySession): number {
	return session.entries[session.entries.length - 1]?.timestamp ?? 0;
}

function pendingState(history: HistoryState): "indexing" | "refreshing" | null {
	return history === "cold" ? "indexing" : history === "refreshing" ? "refreshing" : null;
}

export function searchTranscripts(
	sessions: readonly HistorySession[],
	history: HistoryState,
	label: (cwd: string) => ChatLabel | null,
	input: ProviderInput,
): SearchGroup {
	const folded = foldedTermsOf(input);
	const ordered = sessions
		.map((session) => ({ session, where: label(session.cwd), last: lastActivity(session) }))
		.filter((entry): entry is typeof entry & { where: ChatLabel } => entry.where !== null)
		.sort((a, b) => b.last - a.last);
	const found: { hit: TranscriptHit; at: number }[] = [];
	let truncated = false;
	scan: for (const { session, where } of ordered) {
		for (let index = session.entries.length - 1; index >= 0; index -= 1) {
			if (input.deadline.expired()) {
				truncated = true;
				break scan;
			}
			const entry = session.entries[index];
			const first = entry ? matchContent(folded, preparedOf(entry, entry.text))?.ranges[0] : null;
			if (!entry || !first) continue;
			const title = compactWhitespace(snippetAround(entry.text, first)).slice(
				0,
				TRANSCRIPT_TEXT_PREVIEW,
			);
			found.push({
				hit: {
					id: `transcript:${session.sessionId}:${entry.entryId}`,
					kind: "transcript",
					title,
					...(session.title ? { subtitle: session.title } : {}),
					tier: MATCH_TIER.content,
					score: 0,
					ranges: { title: wireRanges(contentRanges(folded, prepareContent(title))) },
					projectId: where.projectId,
					workspaceId: where.workspaceId,
					sessionId: session.sessionId,
					messageIndex: entry.messageIndex,
					anchorText: entry.text.slice(0, 120),
				},
				at: entry.timestamp,
			});
		}
	}
	found.sort((a, b) => b.at - a.at);
	return buildGroup(
		"transcript",
		found.map((entry) => entry.hit),
		input.limit,
		{ state: pendingState(history) ?? "ready", timeCut: truncated },
	);
}

export function searchPlans(
	workspaces: readonly Pick<Workspace, "id" | "projectId" | "worktreePath">[],
	plans: (root: string) => StoredPlanFile[],
	knownSessions: ReadonlySet<string>,
	input: ProviderInput,
	history: HistoryState,
): SearchGroup {
	const hits: SearchHit[] = [];
	const pending = pendingState(history);
	let unindexed = false;
	const state = () => (unindexed && pending ? pending : "ready");
	for (const workspace of workspaces) {
		for (const file of plans(workspace.worktreePath)) {
			if (input.deadline.expired()) {
				return buildGroup("plan", hits, input.limit, { state: state(), timeCut: true });
			}
			if (!knownSessions.has(file.sessionId)) {
				if (pending) unindexed = true;
				continue;
			}
			const plan = file.read();
			const push = (itemId: string, title: string, subtitle: string | undefined) => {
				const match = matchFields(input.terms, searchHitFields({ kind: "plan", title }));
				if (!match) return;
				hits.push({
					id: `plan:${workspace.id}:${file.sessionId}:${itemId}`,
					kind: "plan",
					title,
					...(subtitle ? { subtitle } : {}),
					tier: match.tier,
					score: match.score,
					ranges: rangesOf(match),
					projectId: workspace.projectId,
					workspaceId: workspace.id,
					sessionId: file.sessionId,
				});
			};
			for (const todo of plan.todos) push(todo.id, todo.title, undefined);
			for (const group of plan.groups) {
				push(group.id, group.title, undefined);
				for (const todo of group.todos) push(todo.id, todo.title, group.title);
			}
		}
	}
	return buildGroup("plan", hits, input.limit, { state: state() });
}
