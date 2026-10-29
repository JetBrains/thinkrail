import { join } from "node:path";
import type { PiPackageScope, PiPackageSourceKind } from "@thinkrail/contracts";

export const BUILTIN_PREFIX = "builtin:";

/** pi's own rule: a `git:` prefix or a `scheme://` URL is git; `npm:` is npm; anything else is a local path. */
export function piPackageSourceKind(source: string): PiPackageSourceKind {
	const trimmed = source.trim();
	if (trimmed.startsWith("npm:")) return "npm";
	if (trimmed.startsWith("git:") || /^(https?|ssh|git):\/\//i.test(trimmed)) return "git";
	return "local";
}

export function npmPackageName(spec: string): string {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
	return match?.[1] ?? spec;
}

export function expandHome(path: string): string {
	return path.replace(/^~(?=\/|$)/, process.env.HOME ?? "~");
}

/** pi's offline switch (`PI_OFFLINE` ∈ 1 | true | yes), which pi does not export. */
export function isOfflineMode(): boolean {
	const value = process.env.PI_OFFLINE?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

/** The directory a scope's declared local sources are relative to: the folder of its settings file. */
export function settingsBaseDir(
	cwd: string | undefined,
	agentDir: string,
	scope: PiPackageScope,
): string {
	return scope === "project" && cwd ? join(cwd, ".pi") : agentDir;
}

/** `host/owner/repo` without ref, `.git` or credentials; the ref is the first `@` (or `#`) inside the path. */
function gitHostAndPath(source: string): string {
	const url = source.startsWith("git:") ? source.slice(4).trim() : source.trim();
	let host = "";
	let path = "";
	const scp = url.match(/^git@([^:]+):(.+)$/);
	if (scp) {
		host = scp[1] ?? "";
		path = scp[2] ?? "";
	} else if (url.includes("://")) {
		try {
			const parsed = new URL(url);
			host = parsed.hostname;
			path = parsed.pathname.replace(/^\/+/, "");
		} catch {
			return url;
		}
	} else {
		const slash = url.indexOf("/");
		if (slash < 0) return url;
		host = url.slice(0, slash);
		path = url.slice(slash + 1);
	}
	const ref = path.search(/[@#]/);
	if (ref >= 0) path = path.slice(0, ref);
	return `${host.toLowerCase()}/${path.replace(/\/+$/, "").replace(/\.git$/, "")}`;
}

/** pi's private `getPackageIdentity` rule: npm by name, git by host/path without ref, local by absolute path. */
export function piPackageIdentity(source: string, resolveLocal: (path: string) => string): string {
	const kind = piPackageSourceKind(source);
	if (kind === "npm") return `npm:${npmPackageName(source.trim().slice(4).trim())}`;
	if (kind === "git") return `git:${gitHostAndPath(source)}`;
	return `local:${resolveLocal(source.trim())}`;
}
