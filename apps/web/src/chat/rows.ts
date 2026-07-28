import type { UserMessage } from "@thinkrail/contracts";
import { resolveProminence } from "./toolRegistry";
import { strArg } from "./tools/toolHelpers";
import type { ChatTurn, ToolResultState } from "./types";

// The pure row-derivation layer behind the transcript (see SPEC.md "Rendering model"): folding spans
// assistant-message boundaries (pi emits one assistant message per tool round), so Virtuoso renders
// derived rows, not raw turns. No React, no store — unit-testable and reusable by any pi UI.

/** One tool call's render inputs — shared by primary `tool` rows and routine activity steps. */
export interface ToolCallData {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	/** The call's live result state (undefined until `tool_execution_start`). */
	tool: ToolResultState | undefined;
	/** Owning message aborted/errored — pi never executes this call (it must not spin forever). */
	dead: boolean;
	/** Owning message still streaming — `args` may be incomplete. */
	streaming: boolean;
}

/**
 * One step inside an activity run. Ids are stable across streaming snapshots: a tool step's id is its
 * `toolCallId`; a thinking step is anchored to its owning message + block index (pi appends, never
 * reorders) — that's what lets fold state survive re-derivation and virtualization.
 */
export type ActivityStep =
	| ({ kind: "tool"; id: string } & ToolCallData)
	| { kind: "thinking"; id: string; text: string; streaming: boolean };

/**
 * A render row. `user`/`system`/`error`/`retry` map 1:1 to the turn renderers; assistant turns dissolve
 * into `markdown` (non-empty text), `tool` (a primary call), and `activity` (a contiguous routine run)
 * rows; `divider` closes a round. Row ids are stable across streaming snapshots (see {@link ActivityStep}),
 * so they double as Virtuoso item keys and fold-state cache keys.
 */
export type ChatRow =
	| { kind: "user"; id: string; message: UserMessage }
	| { kind: "system"; id: string; text: string }
	| { kind: "error"; id: string; text: string }
	| {
			kind: "retry";
			id: string;
			source: "turn" | "summarization";
			attempt: number;
			maxAttempts: number;
			delayMs: number;
	  }
	| { kind: "markdown"; id: string; text: string }
	| ({ kind: "tool"; id: string } & ToolCallData)
	| {
			kind: "activity";
			id: string;
			steps: ActivityStep[];
			/** True while this is the trailing, still-streaming run — its header renders as the live ticker. */
			live: boolean;
	  }
	| { kind: "divider"; id: string; data: TurnDividerData };

/**
 * Flatten pi-canonical turns into render rows. Contiguous routine steps (non-empty thinking blocks +
 * routine tool calls) merge into one `activity` run **across consecutive assistant turns in a round**;
 * a run is broken by non-empty answer text, a primary tool call, or any non-assistant turn. The trailing
 * run of a streaming transcript is marked `live` (the fold header becomes the ticker) — it stops being
 * trailing (and live) the moment answer text starts, which is what auto-collapses it. Round-end dividers
 * (the {@link turnDivider} deriver, which `isSpec` lets split specs from code changes) are folded in as
 * `divider` rows. Pure.
 */
export function deriveRows(
	turns: ChatTurn[],
	toolResults: Record<string, ToolResultState>,
	isStreaming: boolean,
	isSpec?: (path: string) => boolean,
): ChatRow[] {
	const rows: ChatRow[] = [];
	let run: ActivityStep[] = [];

	const flushRun = (live = false) => {
		const first = run[0];
		if (!first) return;
		// A run's id is its first step's id — stable while the trailing run accumulates steps.
		rows.push({ kind: "activity", id: `activity:${first.id}`, steps: run, live });
		run = [];
	};

	for (let i = 0; i < turns.length; i++) {
		const turn = turns[i];
		if (!turn) continue;
		if (turn.kind === "assistant") {
			const { message } = turn;
			const dead = message.stopReason === "aborted" || message.stopReason === "error";
			for (let b = 0; b < message.content.length; b++) {
				const block = message.content[b];
				if (!block) continue;
				if (block.type === "thinking") {
					// Empty thinking renders nothing today — it neither joins nor breaks a run.
					if (block.thinking.trim().length === 0) continue;
					run.push({
						kind: "thinking",
						id: `${turn.id}:thinking:${b}`,
						text: block.thinking,
						streaming: turn.streaming,
					});
				} else if (block.type === "text") {
					if (block.text.trim().length === 0) continue; // empty text splits nothing
					flushRun();
					rows.push({ kind: "markdown", id: `${turn.id}:text:${b}`, text: block.text });
				} else if (block.type === "toolCall") {
					const data: ToolCallData = {
						toolCallId: block.id,
						toolName: block.name,
						args: block.arguments,
						tool: toolResults[block.id],
						dead,
						streaming: turn.streaming,
					};
					if (resolveProminence(block.name).prominence === "primary") {
						flushRun();
						rows.push({ kind: "tool", id: block.id, ...data });
					} else {
						run.push({ kind: "tool", id: block.id, ...data });
					}
				}
			}
			// No flush here: the run merges across the boundary into the round's next assistant turn.
		} else {
			flushRun();
			switch (turn.kind) {
				case "user":
					rows.push({ kind: "user", id: turn.id, message: turn.message });
					break;
				case "system":
					rows.push({ kind: "system", id: turn.id, text: turn.text });
					break;
				case "error":
					rows.push({ kind: "error", id: turn.id, text: turn.text });
					break;
				case "retry":
					rows.push({
						kind: "retry",
						id: turn.id,
						source: turn.source,
						attempt: turn.attempt,
						maxAttempts: turn.maxAttempts,
						delayMs: turn.delayMs,
					});
					break;
			}
		}
		// A divider closes each round the instant it ends — below the round's last turn (its "✓ Done"
		// marker, or its final assistant turn when hydrated), i.e. when the next turn is a new user turn
		// or this is the last turn of a finished (non-streaming) transcript.
		const roundEnded =
			turn.kind !== "user" &&
			(turns[i + 1]?.kind === "user" || (i === turns.length - 1 && !isStreaming));
		if (roundEnded) {
			flushRun(); // a round boundary always closes the run
			const data = turnDivider(turns, i, isSpec);
			if (data) rows.push({ kind: "divider", id: `${turn.id}:divider`, data });
		}
	}
	// A run still open at the tail: the live ticker while streaming; a plain fold otherwise (e.g. an
	// aborted transcript whose round never closed).
	flushRun(isStreaming);
	return rows;
}

/** Orientation metadata for the round-end divider (derived here, not in the reducer). */
export interface TurnDividerData {
	/** Wall-clock from the round's user turn to its end (agent_end, or the last assistant reply), or null. */
	elapsedMs: number | null;
	/** Tool calls made by the assistant turn(s) in this round. */
	toolCount: number;
	/**
	 * Distinct **spec** docs written by those tool calls — the round's Specs-side artifacts, deep-linked to
	 * the Specs panel. A spec belongs here and NOT in `changedFiles`: the two are a partition, so one file is
	 * never counted twice, and "files changed" reads as exactly "code changed".
	 */
	specs: string[];
	/**
	 * Distinct non-spec files written/edited by those tool calls (worktree-relative or absolute, as pi
	 * reported) — the round's Changes-side artifacts.
	 */
	changedFiles: string[];
}

/**
 * The tool whose `path` argument is a spec **by construction**: `spec_create`. Its target counts as a spec
 * whatever the graph snapshot currently holds — which is what makes a spec *created this round* land on the
 * Specs side even before the snapshot catches up with the filesystem. (`spec_update`/`spec_delete` are keyed
 * by spec `id`, not path, so they carry no path to classify; a spec's prose is edited with `edit`, which the
 * graph-backed classifier already routes here.)
 */
const SPEC_WRITER_TOOL = "spec_create";

/** Tools whose `path` argument is a file the agent wrote (as opposed to merely read). */
const FILE_WRITER_TOOLS = new Set(["write", "edit"]);

/**
 * Derive the divider that closes the round *ending* at `endIndex` (its "✓ Done" marker, or its last
 * assistant turn when hydrated): the round's tool calls + the files it wrote, **split into specs and code**,
 * plus the elapsed wall-clock from the round's user turn to its end. Anchored at the round end (not the next
 * user turn) so the summary appears the instant the turn finishes. The end time comes from the "✓ Done"
 * marker's `endedAt` when present (live), else the last assistant message's timestamp (hydrated) — stable
 * either way, so the number never jumps when a follow-up arrives. Returns null when there is no user turn
 * starting the round.
 *
 * `isSpec` classifies an agent-reported path as a spec doc (the store's `specPathMatcher` over the
 * workspace's spec graph); without it every written file counts as a code change. The split is a partition:
 * each path lands in exactly one list, so the two chips deep-link to the panel that can actually show the
 * file — the whole point being that a spec is often **gitignored** scratch (`.thinkrail/context/`) and would
 * otherwise send the user to an empty Changes view. Pure.
 */
export function turnDivider(
	turns: ChatTurn[],
	endIndex: number,
	isSpec: (path: string) => boolean = () => false,
): TurnDividerData | null {
	let userIdx = -1;
	for (let i = endIndex; i >= 0; i--) {
		if (turns[i]?.kind === "user") {
			userIdx = i;
			break;
		}
	}
	if (userIdx < 0) return null;

	let toolCount = 0;
	// path → is it a spec. One entry per path makes the partition structural: a path cannot land on both
	// sides, and first-write order is preserved (Map iterates in insertion order).
	const written = new Map<string, boolean>();
	let endMs: number | null = null;
	for (let i = userIdx + 1; i <= endIndex; i++) {
		const turn = turns[i];
		if (turn?.kind === "assistant") {
			if (turn.message.timestamp) endMs = turn.message.timestamp;
			for (const block of turn.message.content) {
				if (block.type !== "toolCall") continue;
				toolCount++;
				const specWrite = block.name === SPEC_WRITER_TOOL;
				if (!specWrite && !FILE_WRITER_TOOLS.has(block.name)) continue;
				const path = strArg(block.arguments, "path");
				if (!path) continue;
				// A spec created this round stays a spec even if a later `edit` of it arrives before the graph
				// snapshot refreshes (and vice versa) — the spec side wins the tie, so it only ever upgrades.
				if (specWrite || isSpec(path)) written.set(path, true);
				else if (!written.has(path)) written.set(path, false);
			}
		} else if (turn?.kind === "system" && turn.endedAt != null) {
			endMs = turn.endedAt; // the live "✓ Done" marker carries the precise turn-end time
		}
	}

	const user = turns[userIdx];
	const startMs = user?.kind === "user" ? user.message.timestamp : null;
	const elapsedMs = startMs != null && endMs != null ? endMs - startMs : null;

	const specs: string[] = [];
	const changedFiles: string[] = [];
	for (const [path, isSpecPath] of written) (isSpecPath ? specs : changedFiles).push(path);
	return { elapsedMs, toolCount, specs, changedFiles };
}

/** The first row rendering the turn a jump targets: the turn's own row (user/system/…) or its first
 * text row (assistant messages dissolve; a matched assistant message always has a text block). */
export function rowIndexForTurn(rows: ChatRow[], turnId: string): number {
	return rows.findIndex((r) => r.id === turnId || r.id.startsWith(`${turnId}:text:`));
}
