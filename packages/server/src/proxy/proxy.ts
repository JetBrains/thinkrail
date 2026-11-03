import type { AppConfig, ProxyMode, SystemProxyInfo } from "@thinkrail/contracts";

export interface ResolvedProxy {
	httpProxy: string | null;
	httpsProxy: string | null;
	noProxy: string[];
}

export type SystemProxyResolver = () => SystemProxyInfo | null;

/**
 * Validate `host:port` directly instead of relying on `URL.port`, which is empty for an
 * explicitly supplied default port (`80`/`443`).
 */
export function normalizeManualProxy(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const match = /^([^:/\s]+):(\d{1,5})$/.exec(trimmed.replace(/^https?:\/\//i, ""));
	if (!match) return null;
	const port = Number(match[2]);
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
	return `http://${match[1]}:${port}`;
}

export function resolveProxy(
	mode: ProxyMode,
	manualTarget: unknown,
	resolveSystem: SystemProxyResolver,
): ResolvedProxy {
	if (mode === "none") return { httpProxy: null, httpsProxy: null, noProxy: [] };
	if (mode === "manual") {
		const url = normalizeManualProxy(manualTarget);
		return { httpProxy: url, httpsProxy: url, noProxy: [] };
	}
	return resolveSystem() ?? { httpProxy: null, httpsProxy: null, noProxy: [] };
}

function applyVariable(
	upper: string,
	lower: string,
	value: string | null,
	env: Record<string, string | undefined>,
): void {
	if (value) {
		env[upper] = value;
		env[lower] = value;
	} else {
		delete env[upper];
		delete env[lower];
	}
}

function applyResolved(resolved: ResolvedProxy, env: Record<string, string | undefined>): void {
	applyVariable("HTTPS_PROXY", "https_proxy", resolved.httpsProxy, env);
	applyVariable("HTTP_PROXY", "http_proxy", resolved.httpProxy, env);
	applyVariable("ALL_PROXY", "all_proxy", resolved.httpsProxy ?? resolved.httpProxy, env);
	applyVariable(
		"NO_PROXY",
		"no_proxy",
		resolved.noProxy.length > 0 ? resolved.noProxy.join(",") : null,
		env,
	);
}

/**
 * Apply an explicit proxy config to the process environment. An absent config — or a `system`
 * selection on a platform whose resolver reports none — leaves the environment untouched
 * (preserving launch/Environment variables). Both casing variants are replaced or cleared,
 * matching Bun 1.4.4's lowercase-first lookup.
 */
export function applyProxyConfig(
	config: AppConfig,
	resolveSystem: SystemProxyResolver,
	env: Record<string, string | undefined> = process.env,
): void {
	const proxy = config.proxy;
	if (!proxy) return;
	if (proxy.mode === "system") {
		const system = resolveSystem();
		if (!system) return;
		applyResolved(system, env);
		return;
	}
	applyResolved(resolveProxy(proxy.mode, proxy.manualTarget, resolveSystem), env);
}
