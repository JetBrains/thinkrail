import { createHash, type Hash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type CompatibilitySkillProvider = "claude" | "codex" | "github-copilot" | "gemini";

/** One conventional, existing skill root that another Agent Skills-compatible harness owns. */
export interface CompatibilitySkillSource {
	path: string;
	scope: "project" | "user";
	provider: CompatibilitySkillProvider;
	/** For a Claude-plugin source, the plugin's display name — lets the Skills manager group by plugin. */
	plugin?: string;
}

interface DiscoverCompatibilitySkillSourcesOptions {
	homeDir?: string;
	env?: Readonly<Record<string, string | undefined>>;
}

const PROJECT_COMPATIBILITY_SKILL_DIRS = [
	{ ownerDir: ".claude", provider: "claude" },
	{ ownerDir: ".github", provider: "github-copilot" },
	{ ownerDir: ".gemini", provider: "gemini" },
] as const satisfies readonly {
	ownerDir: string;
	provider: CompatibilitySkillProvider;
}[];

/** Pi-native project skill roots that sit ahead of the portable compatibility aliases. */
const PI_PROJECT_SKILL_DIRS = [".pi", ".agents"] as const;

function projectSkillRoots(cwd: string): { path: string; label: string }[] {
	const projectRoot = resolve(cwd);
	return [...PI_PROJECT_SKILL_DIRS, ...PROJECT_COMPATIBILITY_SKILL_DIRS.map((x) => x.ownerDir)].map(
		(ownerDir) => ({ path: join(projectRoot, ownerDir, "skills"), label: `${ownerDir}/skills` }),
	);
}

function resolveConfiguredPath(value: string, homeDir: string): string {
	const trimmed = value.trim();
	if (trimmed === "~") return homeDir;
	if (/^~[\\/]/.test(trimmed)) return resolve(homeDir, trimmed.slice(2));
	return resolve(trimmed);
}

function existingDirectory(path: string): string | null {
	if (!existsSync(path)) return null;
	try {
		return statSync(path).isDirectory() ? resolve(path) : null;
	} catch {
		return null;
	}
}

/**
 * The `skills/` dir of each installed Claude Code **plugin**, read from the plugin manager's authoritative
 * `installed_plugins.json` (`{ plugins: { "<name>@<market>": [{ installPath, … }] } }`). We take each
 * install's resolved `installPath` (version-pinned) + `/skills` — never a blind scan of the plugin cache,
 * which would sweep in stale versions and transitive `node_modules/**​/skills` junk. Missing/garbled
 * manifest → none. These are personal-scope (the user installed them via Claude).
 */
function readClaudePluginSkillDirs(claudeConfigDir: string): { path: string; plugin: string }[] {
	const manifest = join(claudeConfigDir, "plugins", "installed_plugins.json");
	if (!existsSync(manifest)) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(manifest, "utf8"));
	} catch {
		return [];
	}
	const plugins = (parsed as { plugins?: Record<string, unknown> } | null)?.plugins;
	if (!plugins || typeof plugins !== "object") return [];
	const dirs: { path: string; plugin: string }[] = [];
	for (const [key, installs] of Object.entries(plugins)) {
		if (!Array.isArray(installs)) continue;
		const plugin = key.split("@")[0] || key; // "superpowers@claude-plugins-official" → "superpowers"
		for (const install of installs) {
			const installPath = (install as { installPath?: unknown } | null)?.installPath;
			if (typeof installPath === "string") dirs.push({ path: join(installPath, "skills"), plugin });
		}
	}
	return dirs;
}

/**
 * The full compatibility allowlist **before the existence filter**: the fixed project + personal alias
 * dirs at their conventional paths, plus each currently-installed Claude plugin's `skills/` dir. Returned
 * whether or not each dir exists right now — so a caller can register them as skill paths a later reload
 * will pick up the moment a branch switch / pull / clone creates one (a worktree gaining `.claude/skills`
 * mid-session). `discoverCompatibilitySkillSources` is the existence-filtered view for classification.
 * (Plugins installed *after* this call are not covered — their install path isn't yet known.)
 */
export function candidateCompatibilitySkillRoots(
	cwd: string,
	options: DiscoverCompatibilitySkillSourcesOptions = {},
): CompatibilitySkillSource[] {
	const env = options.env ?? process.env;
	const configuredHome = options.homeDir?.trim() || env.HOME?.trim() || homedir();
	const homeDir = resolveConfiguredPath(configuredHome, homedir());
	const projectRoot = resolve(cwd);
	const claudeConfigDir = resolveConfiguredPath(
		env.CLAUDE_CONFIG_DIR?.trim() || join(homeDir, ".claude"),
		homeDir,
	);
	const codexHome = resolveConfiguredPath(
		env.CODEX_HOME?.trim() || join(homeDir, ".codex"),
		homeDir,
	);
	// GEMINI_CLI_HOME is a replacement user-home root; Gemini creates `.gemini` beneath it.
	const geminiHome = resolveConfiguredPath(env.GEMINI_CLI_HOME?.trim() || homeDir, homeDir);

	const candidates: CompatibilitySkillSource[] = PROJECT_COMPATIBILITY_SKILL_DIRS.map(
		({ ownerDir, provider }) => ({
			path: join(projectRoot, ownerDir, "skills"),
			scope: "project" as const,
			provider,
		}),
	);
	candidates.push(
		{ path: join(claudeConfigDir, "skills"), scope: "user", provider: "claude" },
		{ path: join(codexHome, "skills"), scope: "user", provider: "codex" },
		{
			path: join(homeDir, ".copilot", "skills"),
			scope: "user",
			provider: "github-copilot",
		},
		{ path: join(geminiHome, ".gemini", "skills"), scope: "user", provider: "gemini" },
	);

	// Installed Claude plugins (superpowers, etc.) — appended after the hand-written personal aliases so a
	// loose `~/.claude/skills/<name>` wins a name collision over a plugin's.
	for (const { path, plugin } of readClaudePluginSkillDirs(claudeConfigDir)) {
		candidates.push({ path, scope: "user", provider: "claude", plugin });
	}

	return candidates;
}

/** Hash one project-skill tree without following symlinks; any traversal race makes the snapshot unknown. */
function hashSkillTree(hash: Hash, path: string, label: string): void {
	const stat = lstatSync(path, { throwIfNoEntry: false });
	if (!stat) {
		hash.update(`missing\0${label}\0`);
		return;
	}
	if (stat.isSymbolicLink()) {
		const target = readlinkSync(path);
		hash.update(`link\0${label}\0${Buffer.byteLength(target)}\0${target}`);
		return;
	}
	if (stat.isFile()) {
		hash.update(`file\0${label}\0${stat.size}\0`);
		hash.update(readFileSync(path));
		return;
	}
	if (!stat.isDirectory()) throw new Error(`Unsupported skill-tree entry: ${path}`);
	hash.update(`dir\0${label}\0`);
	const entries = readdirSync(path, { withFileTypes: true }).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	for (const entry of entries) {
		hashSkillTree(hash, join(path, entry.name), `${label}/${entry.name}`);
	}
}

/**
 * A deterministic snapshot of the five conventional project skill trees the Skills badge tracks. Used
 * only around a fresh watcher's registration window: equal known fingerprints prove its synthetic startup
 * nudge can stay
 * pathless/non-truncated; a changed or `null` snapshot must conservatively become a wildcard. Relative
 * structure + file bytes are hashed, so a body-only `SKILL.md` edit is visible even when names stay fixed.
 * Missing roots are stable state. Symlinks contribute their target but are not followed; unreadable or
 * racing trees return `null` rather than claiming equality.
 */
export function projectSkillFingerprint(cwd: string): string | null {
	try {
		const hash = createHash("sha256");
		for (const root of projectSkillRoots(cwd)) hashSkillTree(hash, root.path, root.label);
		return hash.digest("hex");
	} catch {
		return null;
	}
}

/**
 * The existence-filtered compatibility allowlist (each dir present + canonicalized, deduped): the fixed
 * project + personal alias dirs, plus each installed Claude plugin's `skills/` dir (from
 * `installed_plugins.json`, personal-scope). Pi-native/configured/shared roots are not returned here —
 * DefaultResourceLoader owns those and places them before this list; ThinkRail's bundled skills are
 * appended after it. `resolveSkillInputs` applies the real precedence (bundled > personal > project);
 * this returns discovery order. Used for **classification** (group + provenance + project-alias trust
 * gating), so it must be re-run whenever the on-disk set can have changed (every reload).
 */
export function discoverCompatibilitySkillSources(
	cwd: string,
	options: DiscoverCompatibilitySkillSourcesOptions = {},
): CompatibilitySkillSource[] {
	const sources: CompatibilitySkillSource[] = [];
	const seen = new Set<string>();
	for (const candidate of candidateCompatibilitySkillRoots(cwd, options)) {
		const path = existingDirectory(candidate.path);
		if (!path) continue;
		let canonical = path;
		try {
			canonical = realpathSync(path);
		} catch {
			// The directory was stat-able above; if canonicalization races with removal, keep the resolved path.
		}
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		sources.push({ ...candidate, path });
	}
	return sources;
}
