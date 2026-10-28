import { statSync } from "node:fs";
import { join } from "node:path";
import type { SearchGroup, SearchHit, Workspace } from "@thinkrail/contracts";
import {
	foldMatchCase,
	MATCH_TIER,
	type MatchField,
	type MatchTerm,
	matchFields,
} from "@thinkrail/contracts";
import type { HistorySession } from "../history";
import { makeSnippet, matchesTerms } from "../history";
import type { SpecSnapshot } from "../spec";
import type { StoredPlanFile } from "../todos";
import type { FileListCache } from "./files";
import {
	buildGroup,
	compactWhitespace,
	compareHits,
	type Deadline,
	lineSnippet,
	termRanges,
} from "./hits";

export interface SearchRoot {
	readonly root: string;
	readonly projectId: string;
	readonly workspaceId: string;
}

export interface ProviderInput {
	readonly terms: readonly MatchTerm[];
	readonly limit: number;
	readonly deadline: Deadline;
}

const SCAN_CHECK_EVERY = 1_000;
const MIN_BODY_TERM_LENGTH = 3;
const TRANSCRIPT_TEXT_PREVIEW = 160;

function isSubsequence(text: string, term: string): boolean {
	let at = 0;
	for (const char of term) {
		at = text.indexOf(char, at);
		if (at === -1) return false;
		at += 1;
	}
	return true;
}

function rangesOf(match: {
	fields: readonly { key: string; ranges: readonly (readonly [number, number])[] }[];
}) {
	const ranges: Record<string, [number, number][]> = {};
	for (const field of match.fields) ranges[field.key] = field.ranges.map(([a, b]) => [a, b]);
	return ranges;
}

export type FileStat = (path: string) => number | "missing" | null;

export const statFile: FileStat = (path) => {
	try {
		const stats = statSync(path);
		return stats.isFile() ? stats.size : "missing";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? "missing" : null;
	}
};

export function searchFiles(
	root: SearchRoot,
	lists: FileListCache,
	input: ProviderInput,
	stat: FileStat = statFile,
): SearchGroup {
	const list = lists.peek(root.root);
	if (!list) {
		void lists.load(root.root);
		return buildGroup("file", [], input.limit, "indexing");
	}
	const hits: SearchHit[] = [];
	const foldedTerms = input.terms.map((term) => ({
		text: foldMatchCase(term.text),
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
		const match = matchFields(input.terms, [{ key: "path", text: path, path: true }]);
		if (match) pushHit(path, match);
	}
	for (const index of rest) {
		if (truncated || expired()) break;
		const path = list.paths[index] ?? "";
		const match = matchFields(input.terms, [{ key: "path", text: path, path: true }]);
		if (match) pushHit(path, match);
	}
	hits.sort(compareHits);
	const page: SearchHit[] = [];
	let missing = 0;
	for (const hit of hits) {
		if (page.length >= input.limit) break;
		const size = hit.path ? stat(join(root.root, hit.path)) : null;
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
	return {
		kind: "file",
		hits: page,
		total: hits.length - missing,
		state: list.failed
			? "failed"
			: lists.reloading(root.root)
				? "indexing"
				: truncated || list.truncated
					? "truncated"
					: "ready",
	};
}

export function searchSpecs(
	root: SearchRoot,
	snapshot: (root: string) => SpecSnapshot,
	input: ProviderInput,
): SearchGroup {
	const hits: SearchHit[] = [];
	const texts = input.terms.map((term) => term.text);
	const bodyTerms = texts.some((text) => text.length >= MIN_BODY_TERM_LENGTH);
	const { entries, rebuilding } = snapshot(root.root);
	for (const entry of entries) {
		if (input.deadline.expired()) {
			return buildGroup("spec", hits, input.limit, "truncated");
		}
		const fields: MatchField[] = [
			{ key: "title", text: entry.title },
			{ key: "id", text: entry.id, secondary: true },
			{ key: "path", text: entry.path, path: true, secondary: true },
		];
		const match = matchFields(input.terms, fields);
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
		if (!bodyTerms || !matchesTerms(entry.content, texts)) continue;
		const snippet = lineSnippet(entry.content, texts);
		if (snippet === null) continue;
		hits.push({
			...base,
			snippet,
			tier: MATCH_TIER.content,
			score: 0,
			ranges: { snippet: termRanges(snippet, texts) },
		});
	}
	return buildGroup("spec", hits, input.limit, rebuilding ? "indexing" : "ready");
}

export interface ChatLabel {
	readonly projectId: string;
	readonly workspaceId: string;
}

function lastActivity(session: HistorySession): number {
	return session.entries[session.entries.length - 1]?.timestamp ?? 0;
}

function groupState(truncated: boolean, indexing: boolean): SearchGroup["state"] {
	return truncated ? "truncated" : indexing ? "indexing" : "ready";
}

export function searchChatTitles(
	sessions: readonly HistorySession[],
	indexing: boolean,
	label: (cwd: string) => ChatLabel | null,
	input: ProviderInput,
): SearchGroup {
	const hits: SearchHit[] = [];
	let truncated = false;
	for (let index = 0; index < sessions.length; index += 1) {
		if (index % SCAN_CHECK_EVERY === SCAN_CHECK_EVERY - 1 && input.deadline.expired()) {
			truncated = true;
			break;
		}
		const session = sessions[index];
		if (!session?.title) continue;
		const where = label(session.cwd);
		if (!where) continue;
		const match = matchFields(input.terms, [{ key: "title", text: session.title }]);
		if (!match) continue;
		hits.push({
			id: `chat:${session.sessionId}`,
			kind: "chat",
			title: session.title,
			tier: match.tier,
			score: match.score,
			ranges: rangesOf(match),
			projectId: where.projectId,
			workspaceId: where.workspaceId,
			sessionId: session.sessionId,
			timestamp: lastActivity(session),
		});
	}
	return buildGroup("chat", hits, input.limit, groupState(truncated, indexing));
}

export function searchTranscripts(
	sessions: readonly HistorySession[],
	indexing: boolean,
	label: (cwd: string) => ChatLabel | null,
	input: ProviderInput,
): SearchGroup {
	const terms = input.terms.map((term) => term.text);
	const primary = terms[0] ?? "";
	const ordered = sessions
		.map((session) => ({ session, where: label(session.cwd), last: lastActivity(session) }))
		.filter((entry): entry is typeof entry & { where: ChatLabel } => entry.where !== null)
		.sort((a, b) => b.last - a.last);
	const hits: SearchHit[] = [];
	let truncated = false;
	scan: for (const { session, where } of ordered) {
		for (let index = session.entries.length - 1; index >= 0; index -= 1) {
			if (input.deadline.expired()) {
				truncated = true;
				break scan;
			}
			const entry = session.entries[index];
			if (!entry || !matchesTerms(entry.text, terms)) continue;
			const snippet = compactWhitespace(makeSnippet(entry.text, primary));
			hits.push({
				id: `transcript:${session.sessionId}:${entry.entryId}`,
				kind: "transcript",
				title: snippet.slice(0, TRANSCRIPT_TEXT_PREVIEW),
				...(session.title ? { subtitle: session.title } : {}),
				snippet,
				tier: MATCH_TIER.content,
				score: 0,
				ranges: { title: termRanges(snippet.slice(0, TRANSCRIPT_TEXT_PREVIEW), terms) },
				projectId: where.projectId,
				workspaceId: where.workspaceId,
				sessionId: session.sessionId,
				messageIndex: entry.messageIndex,
				anchorText: entry.text.slice(0, 120),
				timestamp: entry.timestamp,
			});
		}
	}
	return buildGroup("transcript", hits, input.limit, groupState(truncated, indexing));
}

export function searchPlans(
	workspaces: readonly Pick<Workspace, "id" | "projectId" | "worktreePath">[],
	plans: (root: string) => StoredPlanFile[],
	knownSessions: ReadonlySet<string> | null,
	input: ProviderInput,
	historyIndexing = false,
): SearchGroup {
	const hits: SearchHit[] = [];
	let unindexed = false;
	for (const workspace of workspaces) {
		for (const file of plans(workspace.worktreePath)) {
			if (input.deadline.expired()) return buildGroup("plan", hits, input.limit, "truncated");
			if (knownSessions && !knownSessions.has(file.sessionId)) {
				unindexed = true;
				continue;
			}
			const plan = file.read();
			const push = (itemId: string, title: string, subtitle: string | undefined) => {
				const match = matchFields(input.terms, [{ key: "title", text: title }]);
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
	return buildGroup("plan", hits, input.limit, historyIndexing && unindexed ? "indexing" : "ready");
}

export function searchWorkspaces(
	workspaces: readonly Workspace[],
	input: ProviderInput,
): SearchGroup {
	const hits: SearchHit[] = [];
	for (const workspace of workspaces) {
		const fields: MatchField[] = [
			{ key: "title", text: workspace.name },
			{ key: "subtitle", text: workspace.branch, secondary: true },
		];
		if (workspace.review) {
			fields.push({ key: "keywords", text: `#${workspace.review.number}`, secondary: true });
		}
		const match = matchFields(input.terms, fields);
		if (!match) continue;
		hits.push({
			id: `workspace:${workspace.id}`,
			kind: "workspace",
			title: workspace.name,
			subtitle: workspace.branch,
			tier: match.tier,
			score: match.score,
			ranges: rangesOf(match),
			projectId: workspace.projectId,
			workspaceId: workspace.id,
			...(workspace.lastActiveAt ? { timestamp: workspace.lastActiveAt } : {}),
		});
	}
	return buildGroup("workspace", hits, input.limit);
}
