export function isLoopbackHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "[::1]" ||
		host === "::1" ||
		/^127(?:\.\d{1,3}){3}$/.test(host)
	);
}

export function uiServedFromLoopback(): boolean {
	const hostname = globalThis.location?.hostname;
	return hostname === undefined || isLoopbackHost(hostname);
}

const CALLBACK_PARAMS = ["redirect_uri", "callback_url"] as const;

export function redirectsToLoopback(authUrl: string): boolean {
	if (!URL.canParse(authUrl)) return false;
	const params = new URL(authUrl).searchParams;
	return CALLBACK_PARAMS.some((name) => {
		const target = params.get(name);
		if (!target || !URL.canParse(target)) return false;
		const url = new URL(target);
		return url.protocol === "http:" && isLoopbackHost(url.hostname);
	});
}
