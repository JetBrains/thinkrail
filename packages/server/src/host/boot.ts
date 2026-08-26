import { findFreePort } from "@thinkrail/shared/freePort";
import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
import { initializeJbcentralRuntime } from "../auth";
import { initLogging, logger } from "../log";
import { dataDir } from "../persistence";
import { installCrashLog } from "./crashLog";
import {
	acquireHostOwnership,
	HostAlreadyRunningError,
	type HostOwnershipLease,
	HostOwnershipUnavailableError,
} from "./ownership";
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

function ownServer(server: RunningServer, ownership: HostOwnershipLease): RunningServer {
	let shutdownPromise: Promise<void> | undefined;
	let stopped = false;
	let signalExit = false;
	const detachSignals = () => {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	};
	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		detachSignals();
		try {
			server.stop();
		} finally {
			void ownership.release();
		}
	};
	const shutdown = (): Promise<void> => {
		shutdownPromise ??= (async () => {
			detachSignals();
			try {
				await server.shutdown();
			} finally {
				stopped = true;
				await ownership.release();
			}
		})();
		return shutdownPromise;
	};
	const onSignal = (): void => {
		if (signalExit) return;
		signalExit = true;
		void shutdown().finally(() => process.exit(0));
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	return {
		get port() {
			return server.port;
		},
		stop,
		shutdown,
	};
}

export async function bootHost(options: BootHostOptions): Promise<BootedHost> {
	const ownership = await acquireHostOwnership(dataDir());
	try {
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
		const running = await createServer({
			port,
			host: options.host,
			...(options.staticDir ? { staticDir: options.staticDir } : {}),
			...(options.projectPath ? { projectPath: options.projectPath } : {}),
			...(options.appVersion ? { appVersion: options.appVersion } : {}),
			...(options.analytics ? { analytics: options.analytics } : {}),
		});
		const server = ownServer(running, ownership);
		log.info(`listening on port ${server.port}`);
		return { server, port: server.port, requested };
	} catch (error) {
		await ownership.release();
		throw error;
	}
}

export { HostAlreadyRunningError, HostOwnershipUnavailableError };
