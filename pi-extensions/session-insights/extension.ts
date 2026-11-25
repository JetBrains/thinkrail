import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
	INSIGHTS_FLAGS,
	InsightsEngine,
	type InsightsLocations,
	parseInsightsArgs,
	runInsights,
	vanillaInsightsLocations,
} from "./src/insightsCommand.ts";

export type { InsightsLocations, InsightsRequest } from "./src/insightsCommand.ts";
export {
	InsightsEngine,
	parseInsightsArgs,
	runInsights,
	vanillaInsightsLocations,
} from "./src/insightsCommand.ts";

export interface SessionInsightsExtensionOptions {
	/** pi's agent dir; defaults to pi's own (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`), read at the first run. */
	agentDir?: string;
	/** Replaces single locations of the vanilla layout (an embedder that keeps sessions elsewhere). */
	locations?: Partial<InsightsLocations>;
	/** The command's name; `insights` by default. */
	command?: string;
}

const STATUS_KEY = "session-insights";

type Level = "info" | "warning" | "error";

/** Interactive and RPC modes show the text as a notification; print and JSON modes write it to stderr. */
function show(ctx: ExtensionCommandContext, text: string, level: Level): void {
	if (ctx.hasUI) ctx.ui.notify(text, level);
	else process.stderr.write(`${text}\n`);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * The `/insights` command: findings and usage from the local pi sessions, computed without a model or
 * the network. The index, traces and digests stay warm between runs of one pi process and are dropped
 * when its session shuts down.
 */
export function createSessionInsightsExtension(
	options: SessionInsightsExtensionOptions = {},
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		let engine: InsightsEngine | undefined;
		const engineFor = (): InsightsEngine => {
			engine ??= new InsightsEngine({
				...vanillaInsightsLocations(options.agentDir),
				...options.locations,
			});
			return engine;
		};
		pi.on("session_shutdown", () => {
			engine = undefined;
		});
		pi.registerCommand(options.command ?? "insights", {
			description:
				"Findings, usage and cost from your local pi sessions (no model, nothing sent): --all, --session <id>, --html, --trace",
			getArgumentCompletions: (prefix) => {
				// pi replaces the whole argument text with the item's value, so a value keeps the words
				// before. Only a started flag is completed: an open list takes Enter, which should run the
				// command once a flag is complete.
				const word = prefix.split(/\s+/).pop() ?? "";
				if (!word.startsWith("-")) return null;
				const head = prefix.slice(0, prefix.length - word.length);
				const given = head.split(/\s+/);
				const items = INSIGHTS_FLAGS.filter(
					({ flag }) => flag.startsWith(word) && flag !== word && !given.includes(flag),
				).map(({ flag, description }) => ({ value: `${head}${flag}`, label: flag, description }));
				return items.length > 0 ? items : null;
			},
			handler: async (args, ctx) => {
				const parsed = parseInsightsArgs(args);
				if (!parsed.ok) {
					show(ctx, parsed.message, "warning");
					return;
				}
				const status = (text: string | undefined) => {
					if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, text);
				};
				try {
					const report = await runInsights(engineFor(), parsed.request, {
						cwd: ctx.cwd,
						contextWindow: async (provider, model) =>
							ctx.modelRegistry?.find(provider, model)?.contextWindow ?? null,
						progress: (message) => status(`insights: ${message}`),
					});
					show(ctx, report, "info");
				} catch (error) {
					show(ctx, `Session insights failed: ${messageOf(error)}`, "error");
				} finally {
					status(undefined);
				}
			},
		});
	};
}

export default createSessionInsightsExtension();
