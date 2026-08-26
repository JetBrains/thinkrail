export interface NextStepItem {
	label: string;
	prompt: string;
}

const MAX_ITEMS = 3;
const MAX_LABEL_LENGTH = 60;
const MAX_PROMPT_LENGTH = 500;

function field(entry: unknown, key: "label" | "prompt"): string | null {
	if (!entry || typeof entry !== "object") return null;
	const value = (entry as Record<string, unknown>)[key];
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function readNextStepItems(result: unknown): NextStepItem[] {
	if (!result || typeof result !== "object") return [];
	const details = (result as { details?: unknown }).details;
	if (!details || typeof details !== "object") return [];
	const raw = (details as { items?: unknown }).items;
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return [];
	const items: NextStepItem[] = [];
	const labels = new Set<string>();
	const prompts = new Set<string>();
	for (const entry of raw) {
		const label = field(entry, "label");
		const prompt = field(entry, "prompt");
		if (
			label === null ||
			prompt === null ||
			label.length > MAX_LABEL_LENGTH ||
			prompt.length > MAX_PROMPT_LENGTH
		)
			return [];
		const normalizedLabel = label.toLowerCase();
		const normalizedPrompt = prompt.toLowerCase();
		if (labels.has(normalizedLabel) || prompts.has(normalizedPrompt)) return [];
		labels.add(normalizedLabel);
		prompts.add(normalizedPrompt);
		items.push({ label, prompt });
	}
	return items;
}
