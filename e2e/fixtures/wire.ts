import type { WsMethodName, WsParams, WsRequest, WsResult } from "@thinkrail/contracts";
import { E2E_PORT } from "./paths";

export class E2eWireTransientError extends Error {}

function readResponse(data: unknown, id: string): { ok: boolean; result?: unknown } | null {
	if (typeof data !== "object" || data === null) return null;
	const frame = data as Record<string, unknown>;
	if (frame.id !== id || typeof frame.ok !== "boolean") return null;
	return frame.ok ? { ok: true, result: frame.result } : { ok: false };
}

export class E2eWire {
	private sequence = 0;

	private constructor(private readonly socket: WebSocket) {}

	static async connect(port = E2E_PORT, timeoutMs = 10_000): Promise<E2eWire> {
		const socket = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				socket.close();
				reject(new E2eWireTransientError("Timed out connecting to the isolated host wire"));
			}, timeoutMs);
			const settle = (callback: () => void) => {
				clearTimeout(timer);
				socket.removeEventListener("open", onOpen);
				socket.removeEventListener("error", onError);
				callback();
			};
			const onOpen = () => settle(resolve);
			const onError = () =>
				settle(() =>
					reject(new E2eWireTransientError("Could not connect to the isolated host wire")),
				);
			socket.addEventListener("open", onOpen, { once: true });
			socket.addEventListener("error", onError, { once: true });
		});
		return new E2eWire(socket);
	}

	request<M extends WsMethodName>(
		method: M,
		params: WsParams<M>,
		timeoutMs = 10_000,
	): Promise<WsResult<M>> {
		const id = `e2e_setup_${++this.sequence}`;
		const request: WsRequest<M> = { id, method, params };
		return new Promise<WsResult<M>>((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup();
				reject(new E2eWireTransientError(`Timed out waiting for ${method}`));
			}, timeoutMs);
			const cleanup = () => {
				clearTimeout(timer);
				this.socket.removeEventListener("message", onMessage);
				this.socket.removeEventListener("close", onClose);
				this.socket.removeEventListener("error", onError);
			};
			const onMessage = (event: MessageEvent) => {
				if (typeof event.data !== "string") return;
				let parsed: unknown;
				try {
					parsed = JSON.parse(event.data);
				} catch {
					return;
				}
				const response = readResponse(parsed, id);
				if (!response) return;
				cleanup();
				if (response.ok) resolve(response.result as WsResult<M>);
				else reject(new Error(`${method} failed on the isolated host wire`));
			};
			const onClose = () => {
				cleanup();
				reject(new E2eWireTransientError("The isolated host wire closed during setup"));
			};
			const onError = () => {
				cleanup();
				reject(new E2eWireTransientError("The isolated host wire failed during setup"));
			};
			this.socket.addEventListener("message", onMessage);
			this.socket.addEventListener("close", onClose, { once: true });
			this.socket.addEventListener("error", onError, { once: true });
			this.socket.send(JSON.stringify(request));
		});
	}

	close(): void {
		this.socket.close();
	}
}
