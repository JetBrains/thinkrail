import type { NextStepsDetails } from "@thinkrail/pi-next-steps/core";

function stringList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

export function readSuggestions(args: Record<string, unknown>, result: unknown): readonly string[] {
	const details =
		result && typeof result === "object" ? (result as { details?: unknown }).details : undefined;
	const fromResult =
		details && typeof details === "object"
			? stringList((details as Partial<NextStepsDetails>).suggestions)
			: null;
	return fromResult ?? stringList(args.suggestions) ?? [];
}
