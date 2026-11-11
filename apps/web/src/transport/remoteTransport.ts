import type { WsErrorCode, WsMethodName, WsParams, WsResult } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { type DeviceWireClient, RemoteRequestError } from "@thinkrail/remote-client";
import { RequestError, RequestTimeoutError } from "./requestError";
import type { RequestOptions, Transport } from "./transport";

/**
 * A `Transport` backed by a remote host's WebRTC DataChannel (via `DeviceWireClient`). Requests and channel
 * subscriptions pass through; a coded failure becomes the same `RequestError` the WS transport raises, and an
 * explicit `timeoutMs` bounds the wait (with none, a request waits out a reconnect). `sessionId` has no
 * equivalent on the remote wire. `httpBase` has no equivalent either — the `/files` and `/blob` HTTP routes are
 * not tunnelled over the data channel yet — so byte-URL surfaces (markdown images, diff blobs) are not
 * available over a remote session until that tunnel lands.
 */
export class RemoteTransport implements Transport {
	private readonly client: DeviceWireClient;
	private readonly hostKey: string;
	private readonly unsubscribes = new Set<() => void>();
	private closed = false;

	constructor(client: DeviceWireClient, hostKey: string) {
		this.client = client;
		this.hostKey = hostKey;
	}

	request<M extends WsMethodName>(
		method: M,
		params: WsParams<M>,
		options: RequestOptions = {},
	): Promise<WsResult<M>> {
		const answer = this.client.request<WsResult<M>>(method, params).catch((error: unknown) => {
			throw error instanceof RemoteRequestError && error.code
				? new RequestError(error.code as WsErrorCode, error.message)
				: error;
		});
		const { timeoutMs } = options;
		if (timeoutMs === undefined) return answer;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new RequestTimeoutError(t("app.transport.timedOut", { method }))),
				timeoutMs,
			);
		});
		return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
	}

	subscribe(channel: string, handler: (data: unknown) => void): () => void {
		if (this.closed) return () => {};
		const unsubscribe = this.client.subscribe(channel, handler);
		this.unsubscribes.add(unsubscribe);
		return () => {
			this.unsubscribes.delete(unsubscribe);
			unsubscribe();
		};
	}

	httpBase(): string {
		return "";
	}

	backendKey(): string {
		return `remote:${this.hostKey}`;
	}

	close(): void {
		this.closed = true;
		for (const unsubscribe of this.unsubscribes) unsubscribe();
		this.unsubscribes.clear();
	}
}
