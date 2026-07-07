import type { WsMethodName, WsParams, WsResult, WsServerMessage } from "@thinkrail/contracts";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
type PushHandler = (data: unknown) => void;

export interface TransportOptions {
	/** Host endpoint. Defaults to same-origin (`inferUrl()`); a remote client passes a URL. */
	url?: string;
	onStatus?: (status: ConnectionStatus) => void;
}

/** Single WebSocket to the host: id-correlated requests + channel subscriptions, with reconnect. */
export class WsTransport {
	private ws: WebSocket | null = null;
	private readonly url: string;
	private readonly onStatus: ((status: ConnectionStatus) => void) | undefined;
	private seq = 0;
	private readonly pending = new Map<
		string,
		{
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private readonly subscribers = new Map<string, Set<PushHandler>>();
	private readonly latest = new Map<string, unknown>();
	private readonly queue: string[] = [];
	private backoff = 500;

	constructor(opts: TransportOptions = {}) {
		this.url = opts.url ?? inferUrl();
		this.onStatus = opts.onStatus;
	}

	connect(): void {
		this.onStatus?.("connecting");
		const ws = new WebSocket(this.url);
		this.ws = ws;
		ws.onopen = () => {
			this.backoff = 500;
			this.onStatus?.("connected");
			for (const frame of this.queue.splice(0)) ws.send(frame);
		};
		ws.onmessage = (ev) => this.handleMessage(ev.data);
		ws.onclose = () => {
			this.onStatus?.("disconnected");
			setTimeout(() => this.connect(), this.backoff);
			this.backoff = Math.min(this.backoff * 2, 10_000);
		};
		ws.onerror = () => ws.close();
	}

	request<M extends WsMethodName>(
		method: M,
		params: WsParams<M>,
		sessionId?: string,
	): Promise<WsResult<M>> {
		const id = `trpi_${++this.seq}`;
		const frame = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
		return new Promise<WsResult<M>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`request "${method}" timed out`));
			}, 60_000);
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			this.sendFrame(frame);
		});
	}

	subscribe(channel: string, handler: PushHandler): () => void {
		let set = this.subscribers.get(channel);
		if (!set) {
			set = new Set();
			this.subscribers.set(channel, set);
		}
		set.add(handler);
		if (this.latest.has(channel)) handler(this.latest.get(channel));
		return () => {
			this.subscribers.get(channel)?.delete(handler);
		};
	}

	private sendFrame(frame: string): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
		else this.queue.push(frame);
	}

	private handleMessage(raw: unknown): void {
		if (typeof raw !== "string") return;
		let msg: WsServerMessage;
		try {
			msg = JSON.parse(raw) as WsServerMessage;
		} catch {
			return;
		}
		if ("channel" in msg) {
			this.latest.set(msg.channel, msg.data);
			const set = this.subscribers.get(msg.channel);
			if (set) for (const handler of set) handler(msg.data);
			return;
		}
		const entry = this.pending.get(msg.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.pending.delete(msg.id);
		if (msg.ok) entry.resolve(msg.result);
		else entry.reject(new Error(msg.error ?? "request failed"));
	}
}

export function inferUrl(): string {
	const proto = location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${location.host}/ws`;
}
