import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
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

	const candidates: CompatibilitySkillSource[] = [
		{ path: join(projectRoot, ".claude", "skills"), scope: "project", provider: "claude" },
		{
			path: join(projectRoot, ".github", "skills"),
			scope: "project",
			provider: "github-copilot",
		},
		{ path: join(projectRoot, ".gemini", "skills"), scope: "project", provider: "gemini" },
		{ path: join(claudeConfigDir, "skills"), scope: "user", provider: "claude" },
		{ path: join(codexHome, "skills"), scope: "user", provider: "codex" },
		{
			path: join(homeDir, ".copilot", "skills"),
			scope: "user",
			provider: "github-copilot",
		},
		{ path: join(geminiHome, ".gemini", "skills"), scope: "user", provider: "gemini" },
	];

	// Installed Claude plugins (superpowers, etc.) — appended after the hand-written personal aliases so a
	// loose `~/.claude/skills/<name>` wins a name collision over a plugin's.
	for (const { path, plugin } of readClaudePluginSkillDirs(claudeConfigDir)) {
		candidates.push({ path, scope: "user", provider: "claude", plugin });
	}

	return candidates;
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
