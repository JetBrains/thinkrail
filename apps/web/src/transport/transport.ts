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
 * subscriber is exactly right and is why `latest` exists. These two carry **events**: `terminal.data` is an
 * append-only byte stream and `terminal.exit` is a one-time announcement. Replaying either re-delivers
 * something that already happened, which for a terminal means painting a chunk of output twice — visible as
 * stale text reappearing when a tab re-attaches to the shell it detached earlier.
 */
const NON_REPLAYABLE_CHANNELS: ReadonlySet<string> = new Set([
	WS_CHANNELS.terminalData,
	WS_CHANNELS.terminalExit,
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
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
			/** Already on the wire (vs. still queued for the next open) — decides who dies with the socket. */
			sent: boolean;
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
			this.backoff = 500;
			this.onStatus?.("connected");
			for (const frame of this.queue.splice(0)) ws.send(frame);
			// Everything queued has now gone out, so every pending request is in flight on THIS socket and must
			// die with it. `sent` was a snapshot taken at request time, so a request issued during a disconnect
			// stayed `sent: false` for life and `failInFlight` skipped it forever — leaving exactly the 60s hang
			// that method exists to prevent. (`sendFrame` is only ever called from `request`, so the queue and the
			// not-yet-sent pending entries are the same set.)
			for (const entry of this.pending.values()) entry.sent = true;
		};
		ws.onmessage = (ev) => this.handleMessage(ev.data);
		ws.onclose = () => {
			this.onStatus?.("disconnected");
			this.failInFlight();
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
			const sent = this.sendFrame(frame);
			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, sent });
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

	/** Send now if the socket is open, else queue for the next `onopen`. Returns whether it went out. */
	private sendFrame(frame: string): boolean {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(frame);
			return true;
		}
		this.queue.push(frame);
		return false;
	}

	/**
	 * Fail the requests that were already on the wire when the socket died. Their replies died with it, so they
	 * can never resolve — previously they sat until the 60s timeout, which for a `terminal.create` meant a tab
	 * stuck at "not ready" with no PTY behind it and nothing on screen to say why.
	 *
	 * Requests still *queued* are deliberately untouched: they were never sent, `onopen` flushes them, and that
	 * is exactly what makes a brief hiccup invisible to the caller. Rejecting those would turn a recoverable
	 * blip into a visible failure.
	 */
	private failInFlight(): void {
		for (const [id, entry] of this.pending) {
			if (!entry.sent) continue;
			clearTimeout(entry.timer);
			this.pending.delete(id);
			entry.reject(new Error("connection lost before the host replied"));
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
