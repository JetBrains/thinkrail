const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];
const LOOPBACK_HOST_SET = new Set(LOOPBACK_HOSTS);

function isSameLoopbackOrigin(a: URL, b: URL): boolean {
	if (a.origin === b.origin) return true;
	return (
		a.protocol === b.protocol &&
		a.port === b.port &&
		LOOPBACK_HOST_SET.has(a.hostname) &&
		LOOPBACK_HOST_SET.has(b.hostname)
	);
}

export function loopbackNavigationRules(port: number): string[] {
	return ["^*", ...LOOPBACK_HOSTS.map((host) => `http://${host}:${port}/*`)];
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
