import { randomUUID } from "node:crypto";
import { encodeBrokerFrame } from "@thinkrail/contracts";
import { type Broker, type BrokerSocket, createBroker } from "./broker";
import { DEFAULT_LIMITS, type RelayLimits } from "./config";
import { createConnectionLimiter, createRateLimiter, type RateLimiter } from "./limits";

export interface RunningBroker {
	readonly port: number;
	stop(): void;
}

export interface StartBrokerOptions {
	port?: number;
	host?: string;
	broker?: Broker;
	limits?: RelayLimits;
	/** Read the client address from `X-Forwarded-For`; only behind a reverse proxy that sets it. */
	trustProxy?: boolean;
}

interface SocketData {
	id: string;
	address: string;
	rate: RateLimiter;
	pending?: ReturnType<typeof setTimeout>;
}

const POLICY_VIOLATION = 1008;

function clientAddress(req: Request, direct: string | undefined, trustProxy: boolean): string {
	const forwarded = trustProxy
		? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
		: undefined;
	return forwarded || direct || "unknown";
}

export function startBroker(options: StartBrokerOptions = {}): RunningBroker {
	const limits = options.limits ?? DEFAULT_LIMITS;
	const broker = options.broker ?? createBroker({ maxSessionsPerHost: limits.maxSessionsPerHost });
	const connections = createConnectionLimiter(limits.maxConnectionsPerAddress);
	const requestedPort = options.port ?? 24243;
	const server = Bun.serve<SocketData, never>({
		port: requestedPort,
		hostname: options.host ?? "0.0.0.0",
		fetch(req, srv) {
			if (new URL(req.url).pathname === "/health") return new Response("ok");
			const address = clientAddress(req, srv.requestIP(req)?.address, options.trustProxy ?? false);
			if (!connections.acquire(address))
				return new Response("too many connections", { status: 429 });
			const data: SocketData = {
				id: randomUUID(),
				address,
				rate: createRateLimiter(limits.messagesPerSecond, limits.messageBurst),
			};
			if (srv.upgrade(req, { data })) return undefined;
			connections.release(address);
			return new Response("websocket only", { status: 400 });
		},
		websocket: {
			maxPayloadLength: limits.maxPayloadBytes,
			open(ws) {
				const socket: BrokerSocket = {
					send: (message) => void ws.send(encodeBrokerFrame(message)),
					close: () => ws.close(),
				};
				broker.connect(ws.data.id, socket);
				ws.data.pending = setTimeout(() => {
					if (broker.isPending(ws.data.id)) ws.close(POLICY_VIOLATION, "register timeout");
				}, limits.pendingTimeoutMs);
			},
			message(ws, message) {
				if (!ws.data.rate.take()) {
					ws.close(POLICY_VIOLATION, "rate limit");
					return;
				}
				broker.receive(ws.data.id, typeof message === "string" ? message : message.toString());
			},
			close(ws) {
				clearTimeout(ws.data.pending);
				broker.disconnect(ws.data.id);
				connections.release(ws.data.address);
			},
		},
	});
	return {
		port: server.port ?? requestedPort,
		stop: () => void server.stop(true),
	};
}
