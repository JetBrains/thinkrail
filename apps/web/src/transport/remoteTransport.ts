import type { WsMethodName, WsParams, WsResult } from "@thinkrail/contracts";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import type { RequestOptions, Transport } from "./transport";

/**
 * A `Transport` backed by a remote host's WebRTC DataChannel (via `DeviceWireClient`). Requests and channel
 * subscriptions pass straight through. `httpBase` has no equivalent — the `/files` and `/blob` HTTP routes are
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
		_options?: RequestOptions,
	): Promise<WsResult<M>> {
		return this.client.request<WsResult<M>>(method, params);
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
