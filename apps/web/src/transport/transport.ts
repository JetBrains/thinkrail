import type { WsMethodName, WsParams, WsResult, WsServerMessage } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { RequestError } from "./requestError";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
type PushHandler = (data: unknown) => void;

export interface TransportOptions {
	/** Host endpoint. Defaults to same-origin (`inferUrl()`); a remote client passes a URL. */
	url?: string;
	onStatus?: (status: ConnectionStatus) => void;
}

/** How long a request waits for its reply before rejecting, unless the caller overrides it. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Channels whose last payload must NOT be replayed to a new subscriber.
 *
 * Most push channels carry a *snapshot* — the newest value is the whole truth, so handing it to a late
 * subscriber is exactly right and is why `latest` exists. These channels carry **events**: terminal data is
 * an append-only byte stream, terminal exit is a one-time announcement, and session deletion is folded into
 * a store tombstone when witnessed (a reconnecting active workspace repairs a missed event from authoritative
 * `session.list`). Replaying one re-delivers something that already happened rather than a current snapshot
 * (for terminal data that visibly paints output twice).
 */
const NON_REPLAYABLE_CHANNELS: ReadonlySet<string> = new Set([
	WS_CHANNELS.terminalData,
	WS_CHANNELS.terminalExit,
	WS_CHANNELS.sessionDeleted,
]);

/** 16 random bytes as hex. `getRandomValues` works in an insecure context, unlike `randomUUID`. */
function randomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let clientId: string | undefined;

/**
 * This page's identity to the host, sent as `?client=` on the socket URL.
 *
 * It deliberately spans **reconnects but not reloads**. The host uses it to own per-client resources that must
 * not die on a hiccup — today a workspace's PTYs, whose shells hold real running work. Keying those to the
 * *socket* would mean a dropped connection (the transport reconnects on its own, below) silently orphaned
 * every shell; keying them to a value that also survived a reload would mean they could never be reaped at
 * all. One id for the life of the document is exactly the middle.
 *
 * Minted on first use and **never at import time**, and not via `crypto.randomUUID`: that is a
 * secure-context-only API, undefined over plain http on anything but localhost — which is precisely how a
 * remote client reaches the host (a LAN IP, or the Tailscale MagicDNS name architecture decision #4
 * prescribes). Calling it at module scope threw while `main.tsx` was still importing, so the whole app died
 * before `createRoot().render()` and even the app-level ErrorBoundary never mounted: a blank page. The id only
 * has to be unique per document, so plain random bytes are enough.
 */
function pageClientId(): string {
	if (clientId === undefined) clientId = crypto.randomUUID?.() ?? randomId();
	return clientId;
}

/** The socket URL with this page's client id attached. */
function withClientId(url: string): string {
	const u = new URL(url);
	u.searchParams.set("client", pageClientId());
	return u.toString();
}

export interface RequestOptions {
	sessionId?: string;
	/**
	 * Override the reply deadline (ms). Raise it for a request the **host answers only once a human has**
	 * — `dialog.selectDirectory` sits on an open folder dialog — where the default would reject while the
	 * dialog is still on screen *and* drop the reply that follows (the pending entry is gone by then).
	 */
	timeoutMs?: number;
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

	constructor(opts: TransportOptions = {}) {
		this.url = opts.url ?? inferUrl();
		this.onStatus = opts.onStatus;
	}

	/**
	 * HTTP origin of the dialed host (derives from the WS `url`: `ws→http`, `wss→https`, drop `/ws`). Use
	 * it to build host HTTP URLs — e.g. the `/files/<workspaceId>/<path>` worktree-file endpoint the
	 * markdown viewer points relative `<img>`s at — so they target the same host the transport dials.
	 */
	httpBase(): string {
		const u = new URL(this.url);
		u.protocol = u.protocol === "wss:" ? "https:" : "http:";
		return u.origin;
	}

	connect(): void {
		this.onStatus?.("connecting");
		const ws = new WebSocket(withClientId(this.url));
		this.ws = ws;
		ws.onopen = () => {
			if (this.ws !== ws) {
				ws.close();
				return;
			}
			this.backoff = 500;
			this.onStatus?.("connected");
			// Restate the whole truth before replaying anything: these ids, and only these, may still come back
			// under their original id, so the host can release every other result it is holding for this page.
			// It supersedes any receipt that died with the previous socket — which is why receipts below are
			// best-effort and never retransmitted — and it precedes the replays so nothing it frees is a frame
			// still owed an answer.
			this.ackQueue = [];
			this.sendFrame(JSON.stringify({ resume: [...this.pending.keys()] }));
			// Every unresolved frame is safe to replay under the SAME id: the host's per-client replay cache
			// returns the original handler result instead of executing it again. This includes requests issued
			// while disconnected and requests whose response died with the previous socket.
			for (const entry of this.pending.values()) this.sendFrame(entry.frame);
		};
		ws.onmessage = (ev) => this.handleMessage(ev.data);
		ws.onclose = () => {
			// A replaced socket may close after its successor is already live. It no longer owns reconnect state.
			if (this.ws !== ws) return;
			this.ws = null;
			this.onStatus?.("disconnected");
			setTimeout(() => this.connect(), this.backoff);
			this.backoff = Math.min(this.backoff * 2, 10_000);
		};
		ws.onerror = () => ws.close();
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
			// Register before send: even an eager test socket cannot answer before the correlation entry exists.
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
		// Catch a late subscriber up on the current value. Nothing to catch up on for an event channel, which
		// never gets cached in the first place (see NON_REPLAYABLE_CHANNELS).
		if (this.latest.has(channel)) handler(this.latest.get(channel));
		return () => {
			this.subscribers.get(channel)?.delete(handler);
		};
	}

	/**
	 * Tell the host a response landed, so it can drop the copy it retains for a replay.
	 *
	 * Until this arrives the host must assume the reply died with the socket and keep it replayable — that is
	 * what makes a reconnect replay return the first execution's result instead of running a mutation twice.
	 * Batched on a microtask so a burst of replies costs one frame.
	 *
	 * Deliberately best-effort: a receipt is only as reliable as the socket carrying it, and tracking which
	 * ones were confirmed would just move the same problem one level up. Losing one is safe in the direction
	 * that matters — the host keeps a result it could have freed, never frees one it still owes — and the
	 * `resume` frame on the next connect states the live set outright, which releases it.
	 */
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

	/** Send now if the socket is open; otherwise the pending map is the reconnect queue. */
	private sendFrame(frame: string): void {
		if (this.ws?.readyState !== WebSocket.OPEN) return;
		try {
			this.ws.send(frame);
		} catch {
			// `close` owns status/backoff. The unresolved frame remains in `pending` for the replacement socket.
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
		if ("channel" in msg) {
			// Snapshot channels remember their newest value for late subscribers; event channels must not, or a
			// late subscriber would be handed a past event as if it were new.
			if (!NON_REPLAYABLE_CHANNELS.has(msg.channel)) this.latest.set(msg.channel, msg.data);
			const set = this.subscribers.get(msg.channel);
			if (set) for (const handler of set) handler(msg.data);
			return;
		}
		// Acknowledge before correlating: an id already resolved — a duplicate reply to a replayed frame —
		// still wants a receipt, because the one for the first copy may be exactly what died with its socket.
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
		// A host-named failure rejects with its code attached, so a caller can gate behaviour on *this*
		// failure; an unnamed one stays a plain Error.
		entry.reject(msg.errorCode ? new RequestError(msg.errorCode, message) : new Error(message));
	}
}

export function inferUrl(): string {
	const proto = location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${location.host}/ws`;
}
