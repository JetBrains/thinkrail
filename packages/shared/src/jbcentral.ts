// Detection side of the JetBrains Central CLI proxy wiring. The write side (`thinkrail jbcentral`,
// apps/cli/src/jbcentral.ts `buildProxyUrls`) points a provider's baseUrl at
// `http://127.0.0.1:<port>/wire/<secret>/…`; this predicate is the single place that shape is pinned for
// readers (the server's provider-status report). apps/cli carries a drift test asserting its built URLs
// satisfy this predicate — change the URL shape and both sides must move together.

/**
 * Whether a provider `baseUrl` is a jbcentral-managed proxy URL: a loopback host with a `/wire/…` path.
 * Tolerant of `undefined`/malformed input (returns `false`) — callers feed it raw registry state.
 */
export function isJbcentralProxyUrl(url: string | undefined): boolean {
	if (!url) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const loopback =
		parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
	return loopback && parsed.pathname.startsWith("/wire/");
}
