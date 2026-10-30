import { randomUUID } from "node:crypto";
import { type Broker, type BrokerSocket, createBroker } from "./broker";
import { encode } from "./brokerProtocol";

export interface RunningBroker {
	readonly port: number;
	stop(): void;
}

/** Wires the broker core to a Bun WebSocket server. Each socket is one host or device connection. */
export function startBroker(
	options: { port?: number; host?: string; broker?: Broker } = {},
): RunningBroker {
	const broker = options.broker ?? createBroker();
	const requestedPort = options.port ?? 24243;
	const server = Bun.serve<{ id: string }, never>({
		port: requestedPort,
		hostname: options.host ?? "0.0.0.0",
		fetch(req, srv) {
			if (new URL(req.url).pathname === "/health") return new Response("ok");
			const id = randomUUID();
			return srv.upgrade(req, { data: { id } })
				? undefined
				: new Response("websocket only", { status: 400 });
		},
		websocket: {
			open(ws) {
				const socket: BrokerSocket = {
					send: (message) => void ws.send(encode(message)),
					close: () => ws.close(),
				};
				broker.connect(ws.data.id, socket);
			},
			message(ws, message) {
				broker.receive(ws.data.id, typeof message === "string" ? message : message.toString());
			},
			close(ws) {
				broker.disconnect(ws.data.id);
			},
		},
	});
	return {
		port: server.port ?? requestedPort,
		stop: () => void server.stop(true),
	};
}
