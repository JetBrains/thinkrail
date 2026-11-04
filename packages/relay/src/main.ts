import { createBroker } from "./broker";
import { configFromEnv } from "./config";
import { startBroker } from "./server";
import { turnCredentials } from "./turnCredentials";

const config = configFromEnv(process.env);
const { turn } = config;
const broker = createBroker({
	maxSessionsPerHost: config.limits.maxSessionsPerHost,
	...(turn ? { iceFor: () => [turnCredentials(turn)] } : {}),
});
const running = startBroker({
	port: config.port,
	host: config.host,
	broker,
	limits: config.limits,
	trustProxy: config.trustProxy,
});
process.stdout.write(
	`thinkrail relay listening on ${config.host}:${running.port}${turn ? " (TURN credentials on)" : ""}\n`,
);
