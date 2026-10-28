import type { PiPackageSourceKind } from "@thinkrail/contracts";

const NON_LOCAL_PREFIXES = ["npm:", "git:", "github:", "http:", "https:", "ssh:", "git@"];

export function piPackageSourceKind(source: string): PiPackageSourceKind {
	const trimmed = source.trim();
	if (trimmed.startsWith("npm:")) return "npm";
	if (NON_LOCAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return "git";
	return "local";
}

export function npmPackageName(spec: string): string {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
	return match?.[1] ?? spec;
}

function splitRef(url: string): string {
	const scp = url.match(/^git@([^:]+):(.+)$/);
	if (scp) {
		const path = scp[2] ?? "";
		const at = path.indexOf("@");
		return at > 0 && at < path.length - 1 ? `git@${scp[1]}:${path.slice(0, at)}` : url;
	}
	const hash = url.indexOf("#");
	const withoutHash = hash >= 0 ? url.slice(0, hash) : url;
	const lastSlash = withoutHash.lastIndexOf("/");
	const at = withoutHash.indexOf("@", lastSlash + 1);
	return at > lastSlash + 1 && at < withoutHash.length - 1 ? withoutHash.slice(0, at) : withoutHash;
}

function gitHostAndPath(source: string): string {
	const url = splitRef(source.startsWith("git:") ? source.slice(4).trim() : source.trim());
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
	return `${host.toLowerCase()}/${path.replace(/\/+$/, "").replace(/\.git$/, "")}`;
}

export function piPackageIdentity(source: string, resolveLocal: (path: string) => string): string {
	const kind = piPackageSourceKind(source);
	if (kind === "npm") return `npm:${npmPackageName(source.trim().slice(4).trim())}`;
	if (kind === "git") return `git:${gitHostAndPath(source)}`;
	return `local:${resolveLocal(source.trim())}`;
}
