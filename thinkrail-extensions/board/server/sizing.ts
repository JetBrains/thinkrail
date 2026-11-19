import { CARD_SIZES, type Card, type CardSize } from "./model";

export const SIZE_MAX_TOKENS = 16;
export const SIZE_DEBOUNCE_MS = 1_500;
const PROMPT_TEXT_MAX = 4_000;

const clip = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** The ask for a card's size: the scale, then the card's own words. */
export function sizePrompt(
	card: Pick<Card, "title" | "description" | "acceptance" | "type">,
): string {
	const lines = [
		"Estimate the size of this software task for a coding agent paired with a human.",
		"Answer with exactly one letter and nothing else:",
		"S = one focused sitting, a small and clear change;",
		"M = several steps that need a short design first;",
		"L = large or unclear, needs design and several sessions.",
		"",
		`Type: ${card.type}`,
		`Title: ${card.title}`,
	];
	const description = card.description.trim();
	if (description) lines.push(`Description: ${clip(description, PROMPT_TEXT_MAX)}`);
	const acceptance = card.acceptance.map((item) => item.trim()).filter(Boolean);
	if (acceptance.length > 0)
		lines.push("Acceptance criteria:", ...acceptance.slice(0, 30).map((item) => `- ${item}`));
	return lines.join("\n");
}

/** A size only when the whole answer is one letter S, M or L (case, quotes, emphasis and a period aside). */
export function parseSize(answer: string): CardSize | null {
	const bare = answer
		.trim()
		.replace(/^[`*"'_]+|[`*"'_.]+$/g, "")
		.trim()
		.toUpperCase();
	return CARD_SIZES.find((size) => size === bare) ?? null;
}

/** A human's card whose size is unset or the board's own suggestion; an agent's or a human's size stays. */
export function wantsSize(
	card: Pick<Card, "createdBy" | "size" | "sizeSuggested" | "category">,
): boolean {
	if (card.createdBy !== "human") return false;
	if (card.category === "completed" || card.category === "canceled") return false;
	return !card.size || card.sizeSuggested === true;
}

/**
 * Size suggestions, rate-limited per card: a request waits `delayMs` (later requests restart the wait),
 * one runs at a time per card, and a request during a run runs once more after it. Nothing starts once
 * `signal` aborted.
 */
export class SizeQueue {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly running = new Map<string, Promise<void>>();
	private readonly again = new Set<string>();
	private readonly run: (cardId: string) => Promise<void>;
	private readonly delayMs: number;
	private readonly signal: AbortSignal;

	constructor(run: (cardId: string) => Promise<void>, delayMs: number, signal: AbortSignal) {
		this.run = run;
		this.delayMs = delayMs;
		this.signal = signal;
		signal.addEventListener("abort", () => {
			for (const timer of this.timers.values()) clearTimeout(timer);
			this.timers.clear();
			this.again.clear();
		});
	}

	request(cardId: string): void {
		if (this.signal.aborted) return;
		const waiting = this.timers.get(cardId);
		if (waiting) clearTimeout(waiting);
		this.timers.set(
			cardId,
			setTimeout(() => {
				this.timers.delete(cardId);
				this.start(cardId);
			}, this.delayMs),
		);
	}

	private start(cardId: string): void {
		if (this.signal.aborted) return;
		if (this.running.has(cardId)) {
			this.again.add(cardId);
			return;
		}
		const task = this.run(cardId)
			.catch(() => undefined)
			.finally(() => {
				this.running.delete(cardId);
				if (this.again.delete(cardId)) this.start(cardId);
			});
		this.running.set(cardId, task);
	}

	/** Resolves once no request waits or runs. */
	async idle(): Promise<void> {
		while (this.timers.size > 0 || this.running.size > 0) {
			await Promise.race([
				...this.running.values(),
				new Promise((resolve) => setTimeout(resolve, Math.max(1, this.delayMs))),
			]);
		}
	}
}
