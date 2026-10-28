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
import { buildGroup, compactWhitespace, type Deadline, lineSnippet, termRanges } from "./hits";

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

export function searchFiles(
	root: SearchRoot,
	lists: FileListCache,
	input: ProviderInput,
): SearchGroup {
	const list = lists.peek(root.root);
	if (!list) {
		void lists.load(root.root);
		return buildGroup("file", [], input.limit, "indexing");
	}
	const hits: SearchHit[] = [];
	const foldedTerms = input.terms.map((term) => foldMatchCase(term.text));
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
		if (!foldedTerms.every((term) => folded.includes(term))) {
			if (foldedTerms.every((term) => isSubsequence(folded, term))) rest.push(index);
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
	return buildGroup(
		"file",
		hits,
		input.limit,
		lists.reloading(root.root) ? "indexing" : truncated || list.truncated ? "truncated" : "ready",
	);
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

export function searchChats(
	sessions: readonly HistorySession[],
	indexing: boolean,
	label: (cwd: string) => ChatLabel | null,
	input: ProviderInput,
): { chats: SearchGroup; transcripts: SearchGroup } {
	const chats: SearchHit[] = [];
	const transcripts: SearchHit[] = [];
	const terms = input.terms.map((term) => term.text);
	const primary = terms[0] ?? "";
	let truncated = false;
	let scanned = 0;
	for (const session of sessions) {
		const where = label(session.cwd);
		if (!where) continue;
		const last = session.entries[session.entries.length - 1];
		const timestamp = last?.timestamp ?? 0;
		if (session.title) {
			const match = matchFields(input.terms, [{ key: "title", text: session.title }]);
			if (match) {
				chats.push({
					id: `chat:${session.sessionId}`,
					kind: "chat",
					title: session.title,
					tier: match.tier,
					score: match.score,
					ranges: rangesOf(match),
					projectId: where.projectId,
					workspaceId: where.workspaceId,
					sessionId: session.sessionId,
					timestamp,
				});
			}
		}
		for (const entry of session.entries) {
			scanned += 1;
			if (scanned % SCAN_CHECK_EVERY === 0 && input.deadline.expired()) {
				truncated = true;
				break;
			}
			if (!matchesTerms(entry.text, terms)) continue;
			const snippet = compactWhitespace(makeSnippet(entry.text, primary));
			transcripts.push({
				id: `transcript:${session.sessionId}:${entry.messageIndex}`,
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
		if (truncated) break;
	}
	const state = truncated ? "truncated" : indexing ? "indexing" : "ready";
	return {
		chats: buildGroup("chat", chats, input.limit, state),
		transcripts: buildGroup("transcript", transcripts, input.limit, state),
	};
}

export function searchPlans(
	workspaces: readonly Pick<Workspace, "id" | "projectId" | "worktreePath">[],
	plans: (root: string) => StoredPlanFile[],
	knownSessions: ReadonlySet<string> | null,
	input: ProviderInput,
): SearchGroup {
	const hits: SearchHit[] = [];
	for (const workspace of workspaces) {
		for (const file of plans(workspace.worktreePath)) {
			if (input.deadline.expired()) return buildGroup("plan", hits, input.limit, "truncated");
			if (knownSessions && !knownSessions.has(file.sessionId)) continue;
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
	return buildGroup("plan", hits, input.limit);
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
