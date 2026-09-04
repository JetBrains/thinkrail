import { homedir } from "node:os";
import type { UpdateProvider } from "@thinkrail/server";
import {
	compareReleaseVersions,
	type ResolveLatestReleaseOptions,
	resolveLatestRelease,
} from "@thinkrail/shared/release";
import { channel as bakedChannel, commit, version } from "@thinkrail/shared/version";
import { readInstallMeta } from "./paths";
import {
	executeUpdatePlan,
	parseUpdateArgs,
	resolveUpdateChannel,
	resolveUpdatePlan,
	resolveWindowsUpdatePlan,
} from "./update";

const SOURCE_VERSION = "0.0.0-dev";

type LatestResolver = (
	channel: "stable" | "nightly",
	options: ResolveLatestReleaseOptions,
) => Promise<{ version: string; channel: "stable" | "nightly"; notesUrl: string } | null>;

export interface CliUpdateProviderOptions {
	env: Record<string, string | undefined>;
	home?: string;
	latest?: LatestResolver;
}

export function createCliUpdateProvider(options: CliUpdateProviderOptions): UpdateProvider {
	const home = options.home ?? homedir();
	const latest = options.latest ?? resolveLatestRelease;
	const installed = version !== SOURCE_VERSION;
	const channel = resolveUpdateChannel(
		{ version: "latest" },
		readInstallMeta(home).channel,
		bakedChannel,
	);

	async function newestFor(target: "stable" | "nightly", signal?: AbortSignal) {
		return await latest(target, { env: options.env, ...(signal ? { signal } : {}) });
	}

	return {
		capabilities: {
			install: installed,
			channelSwitch: installed ? "in-app" : "unsupported",
			channels: ["stable", "nightly"],
		},
		current: {
			version,
			channel: installed ? channel : "dev",
			...(commit ? { commit } : {}),
		},
		async check(signal) {
			const found = await newestFor(channel, signal);
			if (!found) return null;
			return compareReleaseVersions(version, found.version) < 0 ? found : null;
		},
		async install(target) {
			const pinned = target.version ?? (await newestFor(target.channel))?.version;
			if (!pinned) {
				return {
					kind: "failed",
					message: `no ${target.channel} release has been published yet`,
					retryable: true,
				};
			}

			let plan: ReturnType<typeof resolveUpdatePlan> | ReturnType<typeof resolveWindowsUpdatePlan>;
			try {
				const input = {
					args: parseUpdateArgs(["--channel", target.channel, "--version", pinned]),
					installMeta: readInstallMeta(home),
					baked: bakedChannel,
					home,
				};
				plan =
					process.platform === "win32" ? resolveWindowsUpdatePlan(input) : resolveUpdatePlan(input);
			} catch (err) {
				return {
					kind: "failed",
					message: err instanceof Error ? err.message : String(err),
					retryable: false,
				};
			}

			const execution = await executeUpdatePlan(plan, { env: options.env, capture: true });
			if (execution.kind === "ok") {
				return { kind: "staged", version: pinned, channel: target.channel };
			}
			if (execution.kind === "manual") {
				return { kind: "manual", message: execution.reason, command: execution.command };
			}
			return { kind: "failed", message: execution.reason, retryable: true };
		},
	};
}
