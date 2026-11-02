export type ProxyMode = "system" | "manual" | "none";

const PROXY_VARIABLE_NAMES = ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"] as const;

export interface ApplyProxyDependencies {
	readSystemProxy(): string | null;
	env: Record<string, string | undefined>;
}

/** A missing or unknown preference value falls back to the system proxy, matching JetBrains IDEs. */
export function resolveProxyMode(raw: unknown): ProxyMode {
	return raw === "manual" || raw === "none" ? raw : "system";
}

/** Normalize a user-supplied `host:port` or `http(s)://host:port` into an `http://` proxy URL. */
export function normalizeManualProxy(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
	try {
		const url = new URL(candidate);
		if (!url.hostname || !url.port) return null;
		return url.origin;
	} catch {
		return null;
	}
}

export function effectiveProxyUrl(
	mode: ProxyMode,
	manual: unknown,
	readSystemProxy: () => string | null,
): string | null {
	if (mode === "none") return null;
	if (mode === "manual") return normalizeManualProxy(manual);
	return readSystemProxy();
}

/**
 * Apply the proxy preference to the process HTTP(S) proxy variables. Both the Electrobun
 * updater's Bun `fetch` and the in-process server read these variables, so the effect is
 * process-wide by design.
 */
export function applyProxySettings(
	mode: unknown,
	manual: unknown,
	dependencies: ApplyProxyDependencies,
): string | null {
	const effective = effectiveProxyUrl(resolveProxyMode(mode), manual, dependencies.readSystemProxy);
	for (const name of PROXY_VARIABLE_NAMES) {
		if (effective) dependencies.env[name] = effective;
		else delete dependencies.env[name];
	}
	return effective;
}
