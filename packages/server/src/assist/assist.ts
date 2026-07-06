/**
 * Ad-hoc one-shot "assist" tasks: small, best-effort agentic helpers that run a single cheap-model
 * completion and never block or crash their caller. Each task builds a prompt, runs it through the
 * one-shot runner, parses/guards the output, and **degrades gracefully** (returns `null`) on any failure
 * — nothing authenticated, a timeout, or unusable output. The first task is workspace naming; PR-draft
 * and friends land here later.
 *
 * The runner is injectable ({@link setOneShotRunner}) so tasks unit-test against a fake — no pi, auth, or
 * network — and default to the real {@link completeOnce} primitive in the `agent` module.
 */

import type { AssistantMessage, Message, TextContent, UserMessage } from "@thinkrail-pi/contracts";
import { completeOnce, type OneShotRequest, type OneShotResult } from "../agent";

/** The first turn of a session — the raw material for a workspace name. */
export interface WorkspaceNameTurn {
	/** The user's opening prompt. */
	prompt: string;
	/** The agent's answer to it (may be empty — the prompt alone can be enough). */
	answer: string;
}

export type OneShotRunner = (req: OneShotRequest) => Promise<OneShotResult>;

let runOneShot: OneShotRunner = completeOnce;

/** Swap the one-shot runner (tests inject a fake; `null` restores the real primitive). */
export function setOneShotRunner(fn: OneShotRunner | null): void {
	runOneShot = fn ?? completeOnce;
}

const NAME_SYSTEM =
	"You name coding workspaces. Given the first turn of a session, reply with a 2-4 word kebab-case " +
	"branch name that captures the task. Reply with the name only — no quotes, no prose, no path.";

/** Max ms a name suggestion may take before we give up and let the caller keep its default. */
const NAME_TIMEOUT_MS = 12_000;

/** Longest slug we keep — long branch names are unwieldy; the model is asked for 2-4 words anyway. */
const MAX_SLUG_LENGTH = 60;

/**
 * Suggest a short kebab-case workspace/branch name from a session's first turn. **Best-effort**: returns
 * `null` on any failure (nothing authenticated, timeout, empty/garbage output) so the caller keeps its
 * `workspace-N` default. Never throws.
 */
export async function suggestWorkspaceName(turn: WorkspaceNameTurn): Promise<string | null> {
	const prompt = buildNamePrompt(turn);
	if (!prompt) return null;
	try {
		const { text } = await runOneShot({
			system: NAME_SYSTEM,
			prompt,
			tier: "cheap",
			maxTokens: 24,
			signal: AbortSignal.timeout(NAME_TIMEOUT_MS),
		});
		return toWorkspaceSlug(text);
	} catch {
		return null;
	}
}

/** Compose the naming prompt, or `null` when there's no user prompt to name from. Clips long text. */
function buildNamePrompt(turn: WorkspaceNameTurn): string | null {
	const prompt = turn.prompt.trim();
	if (!prompt) return null;
	const answer = turn.answer.trim();
	const answerPart = answer ? `\n\nAgent answer:\n${clip(answer, 1500)}` : "";
	return `User request:\n${clip(prompt, 1500)}${answerPart}`;
}

/**
 * Normalize raw model output into a safe, bounded kebab-case slug; `null` if nothing usable remains.
 * Strips wrapping quotes/backticks the model may add, collapses non-alphanumerics to `-`, clamps to a few
 * words and a max length. Pure — shared with `toBranch` in spirit, but this owns the model-output cleanup.
 */
export function toWorkspaceSlug(raw: string): string | null {
	const slug = raw
		.trim()
		.toLowerCase()
		.replace(/^[`'"]+|[`'"]+$/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.split("-")
		.filter(Boolean)
		.slice(0, 5)
		.join("-")
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/-+$/g, "");
	return slug.length > 0 ? slug : null;
}

/**
 * Extract the first **clean** `{ prompt, answer }` turn from a pi-canonical transcript, or `null` if
 * there is none. A turn is its user message plus everything up to the next user message; a turn whose
 * run was killed — its terminal assistant message stopped `"error"` or `"aborted"` — is skipped, so a
 * prompt the user retracted (or that never produced work) can't become naming material. Blank prompts
 * are skipped the same way. `answer` is the concatenated text of the clean turn's first assistant
 * message (empty if it hasn't produced text). Pure — the host composes this with `session.getMessages`.
 */
export function extractFirstTurn(messages: Message[]): WorkspaceNameTurn | null {
	for (let i = 0; i < messages.length; i += 1) {
		const message = messages[i];
		if (message?.role !== "user") continue;
		// The turn's span: everything until the next user message.
		let firstAssistant: AssistantMessage | undefined;
		let lastAssistant: AssistantMessage | undefined;
		let j = i + 1;
		for (; j < messages.length && messages[j]?.role !== "user"; j += 1) {
			const m = messages[j];
			if (m?.role === "assistant") {
				firstAssistant ??= m as AssistantMessage;
				lastAssistant = m as AssistantMessage;
			}
		}
		const killed = lastAssistant?.stopReason === "error" || lastAssistant?.stopReason === "aborted";
		const prompt = userText(message as UserMessage);
		if (killed || !prompt.trim()) {
			i = j - 1;
			continue;
		}
		return { prompt, answer: firstAssistant ? assistantText(firstAssistant) : "" };
	}
	return null;
}

function userText(message: UserMessage): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("");
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}
