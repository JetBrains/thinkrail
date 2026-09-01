import { findFreePort } from "@thinkrail/shared/freePort";
import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
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

function attachProcessSignals(server: RunningServer): RunningServer {
	let signalExit = false;
	const detachSignals = () => {
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	};
	const stop = (): void => {
		detachSignals();
		server.stop();
	};
	const shutdown = (): Promise<void> => {
		detachSignals();
		return server.shutdown();
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
	const server = attachProcessSignals(running);
	log.info(`listening on port ${server.port}`);
	return { server, port: server.port, requested };
}
