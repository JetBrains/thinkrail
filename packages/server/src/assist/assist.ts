import type {
	AssistantMessage,
	TextContent,
	TranscriptMessage,
	UserMessage,
} from "@thinkrail/contracts";
import { completeOnce, type OneShotRequest, type OneShotResult } from "../agent";

export interface WorkspaceNameTurn {
	prompt: string;
	answer: string;
}

export type OneShotRunner = (req: OneShotRequest) => Promise<OneShotResult>;

let runOneShot: OneShotRunner = completeOnce;

export function setOneShotRunner(fn: OneShotRunner | null): void {
	runOneShot = fn ?? completeOnce;
}

const NAME_SYSTEM =
	"You name coding workspaces. Given the first turn of a session, reply with a short, human-readable " +
	'name (2-4 words, Title Case) that captures the task — e.g. "Fix Auth Redirect". Reply with the ' +
	"name only — no quotes, no prose, no kebab-case, no slashes.";

const NAME_TIMEOUT_MS = 12_000;

const MAX_NAME_LENGTH = 60;

const MAX_NAME_WORDS = 5;

const NAIVE_MIN_WORDS = 2;
const NAIVE_MAX_WORDS = 5;
const NAIVE_MIN_CHARS = 10;
const NAIVE_MAX_CHARS = 40;

export function naiveWorkspaceName(prompt: string): string | null {
	const words = prompt
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return null;

	const picked: string[] = [];
	let length = 0;
	for (const word of words) {
		const next = length === 0 ? word.length : length + 1 + word.length;
		const haveMinimum = picked.length >= NAIVE_MIN_WORDS && length >= NAIVE_MIN_CHARS;
		if (picked.length >= NAIVE_MAX_WORDS) break;
		if (next > NAIVE_MAX_CHARS && haveMinimum) break;
		picked.push(word);
		length = next;
	}

	const name = picked.map(titleCaseWord).join(" ").slice(0, NAIVE_MAX_CHARS).trimEnd();
	return name.length > 0 ? name : null;
}

function titleCaseWord(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

export async function suggestWorkspaceName(turn: WorkspaceNameTurn): Promise<string | null> {
	const prompt = buildNamePrompt(turn);
	if (!prompt) return null;
	try {
		const { text } = await runOneShot({
			system: NAME_SYSTEM,
			prompt,
			tier: "cheap",
			maxTokens: 32,
			signal: AbortSignal.timeout(NAME_TIMEOUT_MS),
		});
		return toWorkspaceName(text);
	} catch {
		return null;
	}
}

function buildNamePrompt(turn: WorkspaceNameTurn): string | null {
	const prompt = turn.prompt.trim();
	if (!prompt) return null;
	const answer = turn.answer.trim();
	const answerPart = answer ? `\n\nAgent answer:\n${clip(answer, 1500)}` : "";
	return `User request:\n${clip(prompt, 1500)}${answerPart}`;
}

export function toWorkspaceName(raw: string): string | null {
	const name = raw
		.trim()
		.replace(/^[`'"]+|[`'"]+$/g, "")
		.replace(/[^A-Za-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, MAX_NAME_WORDS)
		.join(" ")
		.slice(0, MAX_NAME_LENGTH)
		.trimEnd();
	return name.length > 0 ? name : null;
}

export function extractFirstTurn(messages: TranscriptMessage[]): WorkspaceNameTurn | null {
	for (let i = 0; i < messages.length; i += 1) {
		const message = messages[i];
		if (message?.role !== "user") continue;
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
