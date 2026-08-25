import { findFreePort } from "@thinkrail/shared/freePort";
import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
import { settleSessionsForShutdown } from "../agent";
import { shutdownAnalytics } from "../analytics";
import { initializeJbcentralRuntime } from "../auth";
import { initLogging, logger } from "../log";
import { installCrashLog } from "./crashLog";
import { type CreateServerOptions, createServer, type RunningServer } from "./server";

export interface BootHostOptions {
	port: number;
	host: string;
	portMode: "exact" | "free";
	staticDir?: string;
	projectPath?: string;
	appVersion?: string;
	analytics?: CreateServerOptions["analytics"];
	verbose?: boolean;
}

const log = logger("host");

export interface BootedHost {
	readonly server: RunningServer;
	readonly port: number;
	readonly requested: number;
}

export async function bootHost(options: BootHostOptions): Promise<BootedHost> {
	await initLogging({
		...(options.verbose ? { level: "debug" as const } : {}),
		...(options.appVersion ? { appVersion: options.appVersion } : {}),
	});
	installCrashLog(options.appVersion);
	resolveShellEnv();
	await initializeJbcentralRuntime();

	const requested = options.port;
	const port =
		options.portMode === "free" ? await findFreePort(requested, options.host) : requested;

	const server = await createServer({
		port,
		host: options.host,
		...(options.staticDir ? { staticDir: options.staticDir } : {}),
		...(options.projectPath ? { projectPath: options.projectPath } : {}),
		...(options.appVersion ? { appVersion: options.appVersion } : {}),
		...(options.analytics ? { analytics: options.analytics } : {}),
	});

	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		void (async () => {
			try {
				await Promise.allSettled([settleSessionsForShutdown(), shutdownAnalytics()]);
			} finally {
				server.stop();
				process.exit(0);
			}
		})();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	log.info(`listening on port ${server.port}`);
	return { server, port: server.port, requested };
}
