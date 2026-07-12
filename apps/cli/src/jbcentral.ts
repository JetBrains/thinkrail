// `thinkrail jbcentral` — point pi's model registry at the local JetBrains Central CLI proxy (`jbcentral`),
// so the pi agent behind thinkrail talks to the JetBrains AI Platform using your JetBrains auth (the same
// path Claude Code and Codex use). The jbcentral **protocol** (discover the secret/port, override
// anthropic/openai `baseUrl` in models.json, undo it) lives in `@thinkrail/shared/jbcentral` — shared with
// the server's in-app "Connect JetBrains AI" flow. This command is the thin CLI caller: arg parse + logging.
// Ported into the CLI so it ships **inside the compiled binary** (no preinstalled bun); re-run any time to
// refresh a rotated secret/port. `scripts/setup-jbcentral-cli.ts` is a thin wrapper over `runJbcentral`.

import { type ParseEnv, unwireJbcentral, wireJbcentral } from "@thinkrail/shared/jbcentral";

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

	if (parsed.remove) {
		await unwireJbcentral(env);
		console.log("Removed jbcentral overrides from models.json (backup: models.json.bak).");
		console.log("The built-in anthropic/openai providers are back to their defaults.");
		return 0;
	}

	const result = await wireJbcentral(env);
	// Redact the proxy secret from any printed URL — it's a persistent JetBrains token that must not leak
	// into terminal history / CI logs / screenshots.
	const redact = (url: string) => url.replace(/\/wire\/[^/]+\//, "/wire/****/");
	switch (result.outcome) {
		case "needs-install":
			console.error(result.hint);
			return 1;
		case "needs-login":
			console.error("central returned an empty secret. Are you logged in? Try: central login");
			return 1;
		case "error":
			console.error(`jbcentral wiring failed:\n${result.message}`);
			return 1;
		case "connected":
			console.log(`Wired pi -> JetBrains Central CLI proxy (port ${result.port}).`);
			console.log(`  anthropic: ${redact(result.urls.anthropicUrl)}`);
			console.log(`  openai:    ${redact(result.urls.openaiUrl)}`);
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
	}
}
