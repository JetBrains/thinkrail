import type { NextStepsDetails } from "@thinkrail/pi-next-steps/core";

function stringList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const strings = value.filter(
		(item): item is string => typeof item === "string" && item.trim() !== "",
	);
	return [...new Set(strings)];
}

function resultDetails(result: unknown): unknown {
	return result && typeof result === "object"
		? (result as { details?: unknown }).details
		: undefined;
}

export function isRefused(result: unknown): boolean {
	const details = resultDetails(result);
	return (
		!!details &&
		typeof details === "object" &&
		(details as Partial<NextStepsDetails>).refused === true
	);
}

export function readSuggestions(args: Record<string, unknown>, result: unknown): readonly string[] {
	const details = resultDetails(result);
	const fromResult =
		details && typeof details === "object"
			? stringList((details as Partial<NextStepsDetails>).suggestions)
			: null;
	return fromResult ?? stringList(args.suggestions) ?? [];
}
