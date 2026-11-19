import type {
	ExtensionChatFacts,
	ExtensionTaskSpec,
	ExtensionWorkspaceFacts,
} from "@thinkrail/extension-api/server";
import { TEXT_MAX, TITLE_MAX } from "./model";

/** A workspace's task-spec on a card: a live overlay from the host's spec graph, never stored. */
export interface TaskSpecRef {
	kind: "task-spec";
	workspaceId: string;
	id: string;
	title: string;
	status: string | null;
	path: string;
}

export const DEFERRALS_HEADING = "Deferrals";

const TASK_SPEC_CARD = /^spec:([^:]+):(.+)$/;

/** A task-spec still open: neither done nor deprecated. */
export function isActiveTaskSpec(spec: Pick<ExtensionTaskSpec, "status">): boolean {
	return spec.status !== "done" && spec.status !== "deprecated";
}

export function taskSpecRef(workspaceId: string, spec: ExtensionTaskSpec): TaskSpecRef {
	return {
		kind: "task-spec",
		workspaceId,
		id: spec.id,
		title: spec.title,
		status: spec.status,
		path: spec.path,
	};
}

/** The id of an unbound workspace's task-spec shown as a card; it names no stored card. */
export function taskSpecCardId(workspaceId: string, specId: string): string {
	return `spec:${workspaceId}:${specId}`;
}

export function parseTaskSpecCardId(id: string): { workspaceId: string; specId: string } | null {
	const match = TASK_SPEC_CARD.exec(id);
	return match?.[1] && match[2] ? { workspaceId: match[1], specId: match[2] } : null;
}

const planDone = (chat: ExtensionChatFacts) =>
	!!chat.plan && chat.plan.total > 0 && chat.plan.open === 0;

/**
 * Where an unbound workspace's task-spec card stands, by the board's own rules over its live facts: a
 * merged PR → completed; no chat working, with a plan done or a non-empty diff → review; else started.
 */
export function liveCategory(
	facts: ExtensionWorkspaceFacts | null,
): "started" | "review" | "completed" {
	if (!facts) return "started";
	if (facts.review?.state === "merged") return "completed";
	const working = facts.chats.some((chat) => chat.state === "working");
	const diff = !!facts.diff && facts.diff.added + facts.diff.removed > 0;
	return !working && (diff || facts.chats.some(planDone)) ? "review" : "started";
}

/** The workspace's most recently active chat, the one an adopted attempt follows. */
export function latestChat(facts: ExtensionWorkspaceFacts | null): ExtensionChatFacts | undefined {
	return [...(facts?.chats ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** An attempt's chat: its own session's, or for an attempt adopted without one the workspace's latest. */
export function attemptChat(
	attempt: { sessionId: string },
	facts: ExtensionWorkspaceFacts | null,
): ExtensionChatFacts | undefined {
	return attempt.sessionId === ""
		? latestChat(facts)
		: facts?.chats.find((candidate) => candidate.sessionId === attempt.sessionId);
}

export interface Deferral {
	title: string;
	description: string;
}

const BULLET = /^ ?(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const CHECKBOX = /^\[( |x|X)\]\s*/;
const EMPTY_ITEM = /^(?:none|nothing|n\/a|-+|—)\.?$/i;

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function plain(text: string): string {
	return text
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The top-level bullets of a `Deferrals` section, one card each: the bullet's text is the title (its
 * whole text in the description when it is too long), its indented lines the description. A checked
 * item, an empty one or "none" is no deferral; a repeated title counts once.
 */
export function parseDeferrals(section: string): Deferral[] {
	const items: { head: string; rest: string[]; checked: boolean }[] = [];
	let current: (typeof items)[number] | null = null;
	let blank = false;
	for (const line of section.split("\n")) {
		const bullet = BULLET.exec(line);
		if (bullet) {
			const text = bullet[1] ?? "";
			const box = CHECKBOX.exec(text);
			current = {
				head: box ? text.slice(box[0].length) : text,
				rest: [],
				checked: box?.[1] === "x" || box?.[1] === "X",
			};
			items.push(current);
			blank = false;
			continue;
		}
		if (!line.trim()) {
			blank = true;
			continue;
		}
		const indented = /^\s{2,}/.test(line);
		if (current && (indented || !blank) && !/^\s{0,3}#/.test(line)) current.rest.push(line.trim());
		else current = null;
		blank = false;
	}
	const seen = new Set<string>();
	const deferrals: Deferral[] = [];
	for (const item of items) {
		const head = plain(item.head);
		if (item.checked || !head || EMPTY_ITEM.test(head)) continue;
		const key = head.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const rest = item.rest.join("\n");
		const long = head.length > TITLE_MAX;
		deferrals.push({
			title: clip(head, TITLE_MAX),
			description: clip(long ? [head, rest].filter(Boolean).join("\n") : rest, TEXT_MAX),
		});
	}
	return deferrals;
}
