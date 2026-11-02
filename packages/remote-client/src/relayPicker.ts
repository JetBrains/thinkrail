const RELAY_OPEN_TIMEOUT_MS = 6000;

export interface RelaySocket {
	addEventListener(type: "open" | "error" | "close", listener: () => void): void;
	removeEventListener(type: "open" | "error" | "close", listener: () => void): void;
	close(): void;
}

/** No relay address answered: the phone and computer share no network, or `thinkrail --remote` is not running. */
export class RelayUnreachableError extends Error {
	readonly code = "relay_unreachable";
	constructor(readonly urls: readonly string[]) {
		super(`couldn't reach the computer at ${urls.join(", ")}`);
		this.name = "RelayUnreachableError";
	}
}

/**
 * Opens every relay address at once and keeps the first that connects, closing the rest — a host on Wi‑Fi and
 * Tailscale is reached over whichever this phone can route to right now, without waiting out a dead address.
 */
export function openFirstRelay<S extends RelaySocket>(
	urls: readonly string[],
	open: (url: string) => S,
	timeoutMs = RELAY_OPEN_TIMEOUT_MS,
): Promise<{ socket: S; url: string }> {
	return new Promise((resolve, reject) => {
		if (urls.length === 0) {
			reject(new RelayUnreachableError(urls));
			return;
		}
		let done = false;
		let failed = 0;
		const sockets: S[] = [];
		const finish = (winner: { socket: S; url: string } | null): void => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			for (const socket of sockets) if (socket !== winner?.socket) socket.close();
			if (winner) resolve(winner);
			else reject(new RelayUnreachableError(urls));
		};
		const timer = setTimeout(() => finish(null), timeoutMs);
		for (const url of urls) {
			let socket: S;
			try {
				socket = open(url);
			} catch {
				failed += 1;
				if (failed === urls.length) finish(null);
				continue;
			}
			sockets.push(socket);
			const onOpen = (): void => {
				socket.removeEventListener("error", onFail);
				socket.removeEventListener("close", onFail);
				finish({ socket, url });
			};
			const onFail = (): void => {
				socket.removeEventListener("open", onOpen);
				failed += 1;
				if (failed === urls.length) finish(null);
			};
			socket.addEventListener("open", onOpen);
			socket.addEventListener("error", onFail);
			socket.addEventListener("close", onFail);
		}
	});
}
