import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface SandboxPolicy {
	allowWrite: string[];
	denyRead: string[];
	allowRead: string[];
	denyWrite: string[];
	allowedDomains: string[];
	allowLocalBinding: boolean;
	systemTrust: boolean;
}

const DEFAULT_DOMAINS = [
	"registry.npmjs.org",
	"*.npmjs.org",
	"registry.yarnpkg.com",
	"pypi.org",
	"*.pypi.org",
	"files.pythonhosted.org",
	"crates.io",
	"*.crates.io",
	"proxy.golang.org",
	"github.com",
	"*.github.com",
	"*.githubusercontent.com",
];

const SECRET_PATHS = [
	".ssh",
	".aws",
	".gnupg",
	".netrc",
	".docker/config.json",
	".config/gh",
	".kube",
	".pi/agent/auth.json",
	".thinkrail",
];

const SECRET_FILE_PATTERNS = [".env", ".env.*", "*.pem", "*.key"];

const GIT_EXECUTABLE_STATE = ["hooks", "config"];

const CACHE_PATHS = [".npm", ".bun/install/cache", ".cache", "Library/Caches"];

export function defaultSandboxPolicy(cwd: string, home = homedir()): SandboxPolicy {
	const gitDir = gitCommonDir(cwd);
	const workspace = [resolve(cwd), ...(gitDir ? [gitDir] : [])];
	return {
		allowWrite: [...workspace, tmpdir(), ...CACHE_PATHS.map((path) => join(home, path))],
		denyRead: SECRET_PATHS.map((path) => join(home, path)),
		allowRead: workspace,
		denyWrite: [
			...SECRET_FILE_PATTERNS,
			...(gitDir ? GIT_EXECUTABLE_STATE.map((path) => join(gitDir, path)) : []),
		],
		allowedDomains: DEFAULT_DOMAINS,
		allowLocalBinding: true,
		systemTrust: true,
	};
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		const parent = dirname(path);
		return parent === path ? path : join(canonical(parent), basename(path));
	}
}

export function isInside(root: string, path: string): boolean {
	const rel = relative(canonical(root), canonical(path));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function matchesName(pattern: string, path: string): boolean {
	const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
	return new RegExp(`^${source}$`).test(basename(path));
}

function isDeniedWrite(pattern: string, path: string): boolean {
	return isAbsolute(pattern) ? isInside(pattern, path) : matchesName(pattern, path);
}

export function canWrite(policy: SandboxPolicy, path: string): boolean {
	return (
		policy.allowWrite.some((root) => isInside(root, path)) &&
		!policy.denyWrite.some((pattern) => isDeniedWrite(pattern, path)) &&
		canRead(policy, path)
	);
}

export function canRead(policy: SandboxPolicy, path: string): boolean {
	return (
		policy.allowRead.some((root) => isInside(root, path)) ||
		!policy.denyRead.some((root) => isInside(root, path))
	);
}

const gitDirs = new Map<string, string | undefined>();

function gitCommonDir(cwd: string): string | undefined {
	if (gitDirs.has(cwd)) return gitDirs.get(cwd);
	let gitDir: string | undefined;
	try {
		const out = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		gitDir = out || undefined;
	} catch {}
	gitDirs.set(cwd, gitDir);
	return gitDir;
}
