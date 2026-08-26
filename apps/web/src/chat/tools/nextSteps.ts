export interface NextStepItem {
	label: string;
	prompt: string;
}

const MAX_ITEMS = 3;

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
	if (!Array.isArray(raw)) return [];
	const items: NextStepItem[] = [];
	for (const entry of raw.slice(0, MAX_ITEMS)) {
		const label = field(entry, "label");
		const prompt = field(entry, "prompt");
		if (label === null || prompt === null) return [];
		items.push({ label, prompt });
	}
	return items;
}
