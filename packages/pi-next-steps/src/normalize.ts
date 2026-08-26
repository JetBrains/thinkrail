import {
	MAX_ITEMS,
	MAX_LABEL_LENGTH,
	MAX_PROMPT_LENGTH,
	type NextStepItem,
	TOOL_NAME,
} from "./schema.ts";

export interface NextStepsDetails {
	items: NextStepItem[];
}

type Outcome = { ok: true; items: NextStepItem[] } | { ok: false; reason: string };

function trimmedField(entry: unknown, key: "label" | "prompt"): string | null {
	if (!entry || typeof entry !== "object") return null;
	const value = (entry as Record<string, unknown>)[key];
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function validate(raw: unknown): Outcome {
	if (!Array.isArray(raw)) return { ok: false, reason: "`items` must be an array." };
	if (raw.length === 0) {
		return {
			ok: false,
			reason: "`items` needs at least one suggestion — omit the call entirely when there is none.",
		};
	}
	if (raw.length > MAX_ITEMS) {
		return {
			ok: false,
			reason: `at most ${MAX_ITEMS} suggestions are allowed, got ${raw.length}.`,
		};
	}
	const items: NextStepItem[] = [];
	const labels = new Set<string>();
	const prompts = new Set<string>();
	for (const [index, entry] of raw.entries()) {
		const label = trimmedField(entry, "label");
		const prompt = trimmedField(entry, "prompt");
		if (label === null) {
			return { ok: false, reason: `items[${index}].label must be a non-blank string.` };
		}
		if (prompt === null) {
			return { ok: false, reason: `items[${index}].prompt must be a non-blank string.` };
		}
		if (label.length > MAX_LABEL_LENGTH) {
			return {
				ok: false,
				reason: `items[${index}].label is ${label.length} characters — the limit is ${MAX_LABEL_LENGTH}.`,
			};
		}
		if (prompt.length > MAX_PROMPT_LENGTH) {
			return {
				ok: false,
				reason: `items[${index}].prompt is ${prompt.length} characters — the limit is ${MAX_PROMPT_LENGTH}.`,
			};
		}
		if (labels.has(label.toLowerCase())) {
			return { ok: false, reason: `items[${index}].label repeats an earlier label.` };
		}
		if (prompts.has(prompt.toLowerCase())) {
			return { ok: false, reason: `items[${index}].prompt repeats an earlier prompt.` };
		}
		labels.add(label.toLowerCase());
		prompts.add(prompt.toLowerCase());
		items.push({ label, prompt });
	}
	return { ok: true, items };
}

export function normalizeItems(raw: unknown): NextStepItem[] {
	const outcome = validate(raw);
	if (!outcome.ok) throw new Error(`${TOOL_NAME}: ${outcome.reason}`);
	return outcome.items;
}

export function readOfferedItems(details: unknown): NextStepItem[] | null {
	if (!details || typeof details !== "object") return null;
	const outcome = validate((details as { items?: unknown }).items);
	return outcome.ok ? outcome.items : null;
}

export function fallbackText(items: readonly NextStepItem[]): string {
	const lines = items.map((item, index) => `${index + 1}. ${item.label} — ${item.prompt}`);
	return [`Offered ${items.length} optional next step(s); the user may pick one:`, ...lines].join(
		"\n",
	);
}
