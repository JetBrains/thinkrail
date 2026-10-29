import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageSource } from "@earendil-works/pi-coding-agent";
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

/** pi's `resolvePath` rule for a local source: trim, expand `~`, decode a `file://` URL, resolve against the base. */
export function resolveLocalSource(input: string, baseDir: string): string {
	const trimmed = input.trim();
	if (/^file:\/\//i.test(trimmed)) return resolve(fileURLToPath(trimmed));
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
	return resolve(baseDir, trimmed);
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

/** pi's own equivalence of two declarations: the key `dedupePackages` and the delta lookup use. */
export function piDeclarationIdentity(
	source: string,
	scope: PiPackageScope,
	cwd: string | undefined,
	agentDir: string,
): string {
	const baseDir = settingsBaseDir(cwd, agentDir, scope);
	return piPackageIdentity(source, (path) => resolveLocalSource(path, baseDir));
}

// The switch key: pi's identity, except that a repository's local package is keyed by its path inside
// the worktree, so every worktree of the project shares its switch like its npm and git declarations.
export function packageSourceIdentity(
	source: string,
	scope: PiPackageScope,
	cwd: string | undefined,
	agentDir: string,
): string {
	const baseDir = settingsBaseDir(cwd, agentDir, scope);
	return piPackageIdentity(source, (path) => {
		const absolute = resolveLocalSource(path, baseDir);
		if (scope !== "project" || cwd === undefined) return absolute;
		const inside = relative(resolve(cwd), absolute);
		return inside && !inside.startsWith("..") && !isAbsolute(inside)
			? `project:${inside.split(sep).join("/")}`
			: absolute;
	});
}

export interface PackageDeclaration {
	source: string;
	scope: PiPackageScope;
}

/**
 * The declarations the switch set turns off, closed over pi's equivalence: when any declaration of a
 * pi identity is switched off, every declaration of that identity is — hiding one alias must never let
 * pi load the package through another.
 */
export function disabledDeclarationIdentities(
	declarations: readonly PackageDeclaration[],
	disabled: ReadonlySet<string>,
	cwd: string | undefined,
	agentDir: string,
): ReadonlySet<string> {
	const off = new Set<string>();
	for (const { source, scope } of declarations) {
		if (disabled.has(packageSourceIdentity(source, scope, cwd, agentDir))) {
			off.add(piDeclarationIdentity(source, scope, cwd, agentDir));
		}
	}
	return off;
}

export function declarationsOf(
	packages: readonly PackageSource[] | undefined,
	scope: PiPackageScope,
): PackageDeclaration[] {
	return (packages ?? []).map((pkg) => ({
		source: typeof pkg === "string" ? pkg : pkg.source,
		scope,
	}));
}
