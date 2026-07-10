// `thinkrail jbcentral` — point pi's model registry at the local JetBrains Central CLI proxy
// (`jbcentral`), so the pi agent behind thinkrail talks to the JetBrains AI Platform using your JetBrains
// auth (the same path Claude Code and Codex use). Ported into the CLI so it ships **inside the compiled
// binary** — the binary already carries a full Bun runtime, so `thinkrail jbcentral` works on
// mac/linux/windows with no preinstalled bun. `scripts/setup-jbcentral-cli.ts` is a thin wrapper over
// `runJbcentral`.
//
// The wiring core (transforms + proxy discovery + models.json IO) lives in `@thinkrail/shared/jbcentral`,
// shared with the host's in-app JetBrains AI flow (`packages/server/src/auth`) — one implementation,
// two front doors. This file owns only the CLI: arg parsing + console output.

import {
	type ParseEnv,
	resolveAgentDir,
	resolveJbcentralBin,
	unwireJbcentralProxy,
	wireJbcentralProxy,
} from "@thinkrail/shared/jbcentral";

export const JBCENTRAL_USAGE = `Usage: thinkrail jbcentral [--remove]

Wire pi's model registry through the local JetBrains Central CLI (jbcentral) proxy, so the
built-in Claude (anthropic) and GPT (openai) model picks route through your JetBrains AI auth.
Re-run any time to refresh a rotated secret/port.

Options:
  --remove       Undo: drop the baseUrl/apiKey overrides we manage.
  -h, --help     Show this help.

Env:
  PI_CODING_AGENT_DIR   pi agent dir holding models.json (default ~/.pi/agent).
  WIRE_PROXY_PORT       Proxy port (default: ~/.wire/config.json proxy_port, else 19516).`;

export interface JbcentralArgs {
	/** `--remove` was passed — undo the overrides instead of wiring them. */
	remove: boolean;
	/** `-h`/`--help` was passed — print usage and exit. */
	help: boolean;
}

/** Parse `jbcentral`'s argv (the slice after `jbcentral`). Throws on an unknown flag. */
export function parseJbcentralArgs(argv: readonly string[]): JbcentralArgs {
	let remove = false;
	let help = false;
	for (const arg of argv) {
		if (arg === "--remove") remove = true;
		else if (arg === "-h" || arg === "--help") help = true;
		else throw new Error(`Unknown option: ${arg}`);
	}
	return { remove, help };
}

/** Run the `jbcentral` subcommand. Returns a process exit code. */
export async function runJbcentral(argv: readonly string[], env: ParseEnv): Promise<number> {
	let parsed: JbcentralArgs;
	try {
		parsed = parseJbcentralArgs(argv);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${JBCENTRAL_USAGE}`);
		return 1;
	}
	if (parsed.help) {
		console.log(JBCENTRAL_USAGE);
		return 0;
	}

	// --- Remove mode -----------------------------------------------------------------------------
	if (parsed.remove) {
		try {
			const { modelsJsonPath } = await unwireJbcentralProxy(env);
			console.log(
				`Removed jbcentral overrides from ${modelsJsonPath} (backup: ${modelsJsonPath}.bak).`,
			);
			console.log("The built-in anthropic/openai providers are back to their defaults.");
			return 0;
		} catch (err) {
			console.error(err instanceof Error ? err.message : String(err));
			return 1;
		}
	}

	// --- Wire mode -------------------------------------------------------------------------------
	const bin = resolveJbcentralBin();
	try {
		const { port, urls, modelsJsonPath } = await wireJbcentralProxy(env, bin ?? undefined);
		console.log(`Wired pi -> JetBrains Central CLI proxy (port ${port}).`);
		console.log(`  config:    ${modelsJsonPath}  (backup: ${modelsJsonPath}.bak)`);
		console.log(`  anthropic: ${urls.anthropicUrl}`);
		console.log(`  openai:    ${urls.openaiUrl}`);
		console.log();
		console.log(
			"The built-in Anthropic (Claude) and OpenAI (GPT) model picks in pi / thinkrail now route",
		);
		console.log(
			"through JetBrains AI. Note: direct provider access is shadowed while these overrides are set,",
		);
		console.log(
			"and the picker may list models JetBrains AI doesn't serve. Undo with: thinkrail jbcentral --remove",
		);
		return 0;
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}
}

// Re-exported so existing imports of the CLI module keep working (the canonical home is shared).
export { resolveAgentDir };
