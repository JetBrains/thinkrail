const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isSameLoopbackOrigin(a: URL, b: URL): boolean {
	if (a.origin === b.origin) return true;
	return (
		a.protocol === b.protocol &&
		a.port === b.port &&
		LOOPBACK_HOSTS.has(a.hostname) &&
		LOOPBACK_HOSTS.has(b.hostname)
	);
}

export function externalNavigationUrl(value: unknown, origin: string): string | null {
	const raw =
		typeof value === "string"
			? value
			: typeof value === "object" && value !== null && typeof Reflect.get(value, "url") === "string"
				? (Reflect.get(value, "url") as string)
				: null;
	if (!raw) return null;
	try {
		const url = new URL(raw, origin);
		const base = new URL(origin);
		if (isSameLoopbackOrigin(url, base)) return null;
		return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}
