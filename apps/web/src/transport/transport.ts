import type { WsMethodName, WsParams, WsResult, WsServerMessage } from "@thinkrail/contracts";
import { LAUNCH_AUTH_PATH, PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { randomId } from "../lib";
import { storeLaunchToken, withLaunchToken } from "./launchToken";
import { RequestError } from "./requestError";

const LAUNCH_REFUSALS = ["unauthorized", "token-rejected", "foreign-origin"] as const;
export type LaunchRefusal = (typeof LAUNCH_REFUSALS)[number];
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | LaunchRefusal;
export type LaunchProbe = "ok" | "bad-token" | "foreign-origin" | "down";
type PushHandler = (data: unknown) => void;

export const isLaunchRefusal = (status: ConnectionStatus): status is LaunchRefusal =>
	(LAUNCH_REFUSALS as readonly string[]).includes(status);

export interface TransportOptions {
	url?: string;
	onStatus?: (status: ConnectionStatus) => void;
	probeLaunch?: (probeUrl: string) => Promise<LaunchProbe>;
}

const probeVerdict = (status: number): LaunchProbe => {
	if (status === 401) return "bad-token";
	if (status === 403) return "foreign-origin";
	return status < 400 ? "ok" : "down";
};

const probeLaunchAuth = (probeUrl: string) =>
	fetch(probeUrl)
		.then((response) => probeVerdict(response.status))
		.catch((): LaunchProbe => "down");

interface TransportDispatchHooks {
	beforeDispatch?: (message: WsServerMessage) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;

const NON_REPLAYABLE_CHANNELS: ReadonlySet<string> = new Set([
	WS_CHANNELS.terminalData,
	WS_CHANNELS.terminalExit,
	WS_CHANNELS.terminalDetached,
	WS_CHANNELS.sessionDeleted,
	WS_CHANNELS.providerChanged,
	WS_CHANNELS.feedbackInterview,
]);

let clientId: string | undefined;

function pageClientId(): string {
	if (clientId === undefined) clientId = randomId("client");
	return clientId;
}

function withClientId(url: string): string {
	const u = new URL(url);
	u.searchParams.set("client", pageClientId());
	u.searchParams.set("protocol", String(PROTOCOL_VERSION));
	return withLaunchToken(u.toString());
}

export interface RequestOptions {
	sessionId?: string;
	timeoutMs?: number;
}

export class WsTransport {
	private ws: WebSocket | null = null;
	private readonly url: string;
	private readonly onStatus: ((status: ConnectionStatus) => void) | undefined;
	private readonly probeLaunch: (probeUrl: string) => Promise<LaunchProbe>;
	private readonly beforeDispatch: ((message: WsServerMessage) => void) | undefined;
	private seq = 0;
	private readonly pending = new Map<
		string,
		{
			frame: string;
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private readonly subscribers = new Map<string, Set<PushHandler>>();
	private readonly latest = new Map<string, unknown>();
	private ackQueue: string[] = [];
	private ackScheduled = false;
	private backoff = 500;
	private pastedToken = false;

	constructor(opts: TransportOptions = {}, dispatchHooks: TransportDispatchHooks = {}) {
		this.url = opts.url ?? inferUrl();
		this.onStatus = opts.onStatus;
		this.probeLaunch = opts.probeLaunch ?? probeLaunchAuth;
		this.beforeDispatch = dispatchHooks.beforeDispatch;
	}

	httpBase(): string {
		const u = new URL(this.url);
		u.protocol = u.protocol === "wss:" ? "https:" : "http:";
		return u.origin;
	}

	hostUrl(path: string): string {
		return withLaunchToken(`${this.httpBase()}${path}`);
	}

	authorize(token: string): void {
		storeLaunchToken(token);
		this.pastedToken = true;
		if (this.ws === null) this.open();
	}

	connect(): void {
		this.onStatus?.("connecting");
		this.open();
	}

	private open(): void {
		const ws = new WebSocket(withClientId(this.url));
		this.ws = ws;
		let opened = false;
		ws.onopen = () => {
			if (this.ws !== ws) {
				ws.close();
				return;
			}
			opened = true;
			this.pastedToken = false;
			this.backoff = 500;
			this.onStatus?.("connected");
			this.ackQueue = [];
			this.sendFrame(JSON.stringify({ resume: [...this.pending.keys()] }));
			for (const entry of this.pending.values()) this.sendFrame(entry.frame);
		};
		ws.onmessage = (ev) => this.handleMessage(ev.data);
		ws.onclose = () => {
			if (this.ws !== ws) return;
			this.ws = null;
			if (opened) {
				this.onStatus?.("disconnected");
				this.scheduleReconnect();
				return;
			}
			void this.probeLaunch(this.hostUrl(LAUNCH_AUTH_PATH)).then((probe) => {
				if (this.ws !== null) return;
				const refusal = this.refusalFor(probe);
				this.pastedToken = false;
				if (refusal !== null) {
					this.onStatus?.(refusal);
					return;
				}
				this.onStatus?.("disconnected");
				this.scheduleReconnect();
			});
		};
		ws.onerror = () => ws.close();
	}

	private refusalFor(probe: LaunchProbe): LaunchRefusal | null {
		if (probe === "foreign-origin") return "foreign-origin";
		if (probe !== "bad-token") return null;
		return this.pastedToken ? "token-rejected" : "unauthorized";
	}

	private scheduleReconnect(): void {
		setTimeout(() => {
			if (this.ws === null) this.connect();
		}, this.backoff);
		this.backoff = Math.min(this.backoff * 2, 10_000);
	}

	request<M extends WsMethodName>(
		method: M,
		params: WsParams<M>,
		options: RequestOptions = {},
	): Promise<WsResult<M>> {
		const { sessionId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
		const id = `trpi_${++this.seq}`;
		const frame = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
		return new Promise<WsResult<M>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`request "${method}" timed out`));
			}, timeoutMs);
			this.pending.set(id, {
				frame,
				resolve: resolve as (v: unknown) => void,
				reject,
				timer,
			});
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

	private queueAck(id: string): void {
		this.ackQueue.push(id);
		if (this.ackScheduled) return;
		this.ackScheduled = true;
		queueMicrotask(() => {
			this.ackScheduled = false;
			this.flushAcks();
		});
	}

	private flushAcks(): void {
		if (this.ackQueue.length === 0 || this.ws?.readyState !== WebSocket.OPEN) return;
		const ack = this.ackQueue;
		this.ackQueue = [];
		this.sendFrame(JSON.stringify({ ack }));
	}

	private sendFrame(frame: string): void {
		if (this.ws?.readyState !== WebSocket.OPEN) return;
		try {
			this.ws.send(frame);
		} catch {
			this.ws.close();
		}
	}

	private handleMessage(raw: unknown): void {
		if (typeof raw !== "string") return;
		let msg: WsServerMessage;
		try {
			msg = JSON.parse(raw) as WsServerMessage;
		} catch {
			return;
		}
		this.beforeDispatch?.(msg);
		if ("channel" in msg) {
			if (!NON_REPLAYABLE_CHANNELS.has(msg.channel)) this.latest.set(msg.channel, msg.data);
			const set = this.subscribers.get(msg.channel);
			if (set) for (const handler of set) handler(msg.data);
			return;
		}
		this.queueAck(msg.id);
		const entry = this.pending.get(msg.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.pending.delete(msg.id);
		if (msg.ok) {
			entry.resolve(msg.result);
			return;
		}
		const message = msg.error ?? "request failed";
		entry.reject(msg.errorCode ? new RequestError(msg.errorCode, message) : new Error(message));
	}
}

export function inferUrl(): string {
	const proto = location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${location.host}/ws`;
}
