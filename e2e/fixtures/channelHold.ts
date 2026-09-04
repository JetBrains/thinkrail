import type { Page } from "@playwright/test";

function parseFrame(message: unknown): Record<string, unknown> | null {
	if (typeof message !== "string") return null;
	try {
		const value: unknown = JSON.parse(message);
		return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

function signal() {
	let send = () => {};
	const received = new Promise<void>((resolve) => {
		send = resolve;
	});
	return { received, send };
}

export async function installChannelHold(page: Page) {
	let armed:
		| {
				channel: string;
				held: ReturnType<typeof signal>;
				release: ReturnType<typeof signal>;
		  }
		| undefined;
	await page.routeWebSocket(/\/ws(\?|$)/, (browserSocket) => {
		const serverSocket = browserSocket.connectToServer();
		browserSocket.onMessage((message) => serverSocket.send(message));
		serverSocket.onMessage((message) => {
			const pending = armed;
			if (pending && parseFrame(message)?.channel === pending.channel) {
				armed = undefined;
				pending.held.send();
				void pending.release.received.then(() => browserSocket.send(message));
				return;
			}
			browserSocket.send(message);
		});
	});
	return {
		arm(channel: string) {
			if (armed) throw new Error(`Already holding ${armed.channel}`);
			const held = signal();
			const release = signal();
			armed = { channel, held, release };
			return { held: held.received, release: release.send };
		},
	};
}
