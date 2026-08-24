export function errorText(err: unknown, fallback = "The request failed."): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string" && err) return err;
	return fallback;
}
