import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type CompatibilitySkillProvider = "claude" | "codex" | "github-copilot" | "gemini";

/** One conventional, existing skill root that another Agent Skills-compatible harness owns. */
export interface CompatibilitySkillSource {
	path: string;
	scope: "project" | "user";
	provider: CompatibilitySkillProvider;
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
 * Discover the explicit compatibility allowlist in precedence order: project aliases before personal
 * aliases. Pi-native/configured/shared roots are not returned here — DefaultResourceLoader owns those and
 * places them before this list; ThinkRail's bundled skills are appended after it.
 */
export function discoverCompatibilitySkillSources(
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

	const sources: CompatibilitySkillSource[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
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
