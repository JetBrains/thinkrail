import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import type { UpdateProvider } from "@thinkrail/server";
import {
	compareReleaseVersions,
	type ResolveLatestReleaseOptions,
	resolveLatestRelease,
} from "@thinkrail/shared/release";
import { channel as bakedChannel, commit, version } from "@thinkrail/shared/version";
import { installedBinaryPath, readInstallMeta } from "./paths";
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
	execPath?: string;
	platform?: string;
	latest?: LatestResolver;
}

function samePath(a: string, b: string): boolean {
	const resolve = (path: string): string => {
		try {
			return realpathSync(path);
		} catch {
			return path;
		}
	};
	const left = resolve(a);
	const right = resolve(b);
	return process.platform === "win32"
		? left.replace(/\//g, "\\").toLowerCase() === right.replace(/\//g, "\\").toLowerCase()
		: left === right;
}

export function createCliUpdateProvider(options: CliUpdateProviderOptions): UpdateProvider {
	const home = options.home ?? homedir();
	const latest = options.latest ?? resolveLatestRelease;
	const execPath = options.execPath ?? process.execPath;
	const windows = (options.platform ?? process.platform) === "win32";
	const meta = readInstallMeta(home);
	const ownedBinary = installedBinaryPath(meta, home, windows);
	const installed = version !== SOURCE_VERSION && samePath(execPath, ownedBinary);
	const channel = resolveUpdateChannel({ version: "latest" }, meta.channel, bakedChannel);

	async function newestFor(channel: "stable" | "nightly", signal?: AbortSignal) {
		return await latest(channel, { env: options.env, ...(signal ? { signal } : {}) });
	}

	return {
		capabilities: {
			install: installed,
			channelSwitch: installed ? "in-app" : "unsupported",
			channels: ["stable", "nightly"],
		},
		installationId: `cli:${ownedBinary}`,
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

			if (!samePath(ownedBinary, installedBinaryPath(readInstallMeta(home), home, windows))) {
				return {
					kind: "failed",
					message:
						"the recorded ThinkRail install moved since this host started — install it again from a terminal",
					retryable: false,
				};
			}

			let plan: ReturnType<typeof resolveUpdatePlan> | ReturnType<typeof resolveWindowsUpdatePlan>;
			try {
				const input = {
					args: parseUpdateArgs(["--channel", target.channel, "--version", pinned]),
					installMeta: meta,
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
