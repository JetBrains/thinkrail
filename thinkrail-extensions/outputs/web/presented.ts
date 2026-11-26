function stringList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	return [
		...new Set(
			value.filter((item): item is string => typeof item === "string" && item.trim() !== ""),
		),
	];
}

export function readPresentedFiles(args: Record<string, unknown>, result: unknown): string[] {
	const details =
		result && typeof result === "object" ? (result as { details?: unknown }).details : undefined;
	const published =
		details && typeof details === "object"
			? stringList((details as { files?: unknown }).files)
			: null;
	return published ?? stringList(args.filepaths) ?? [];
}
