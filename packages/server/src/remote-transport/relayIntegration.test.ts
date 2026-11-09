import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrokerToClient, encodeBrokerFrame, parseBrokerMessage } from "@thinkrail/contracts";
import { startBroker } from "@thinkrail/relay";
import { loadOrCreateIdentity } from "../remote";
import { connectHostBroker } from "./hostBrokerClient";
import type { HostSession } from "./hostSession";

/** Connects as a device and returns the relay's first answer: `ready` once the host is registered. */
function connectDevice(
	url: string,
	hostKey: string,
): Promise<{ ws: WebSocket; first: BrokerToClient | null }> {
	return new Promise((resolve) => {
		const ws = new WebSocket(url);
		ws.addEventListener("open", () => ws.send(encodeBrokerFrame({ t: "connect", hostKey })));
		ws.addEventListener(
			"message",
			(event) => resolve({ ws, first: parseBrokerMessage(String(event.data)) }),
			{
				once: true,
			},
		);
	});
}

test("over a real relay the host proves its key, registers, and receives a device session", async () => {
	const dir = mkdtempSync(join(tmpdir(), "trpi-relay-integration-"));
	const relay = startBroker({ port: 0, host: "127.0.0.1" });
	const url = `ws://127.0.0.1:${relay.port}`;
	const identity = loadOrCreateIdentity(dir);
	const opened: string[] = [];
	const connection = connectHostBroker(url, {
		hostKey: identity.publicKey,
		sign: identity.sign,
		openSession: (sessionId): HostSession => {
			opened.push(sessionId);
			return {
				receive: () => {},
				receiveUnreadable: () => {},
				onChannel: () => {},
				close: () => {},
			};
		},
	});
	const devices: WebSocket[] = [];
	try {
		const deadline = Date.now() + 5_000;
		let first: BrokerToClient | null = null;
		while (first?.t !== "ready") {
			if (Date.now() > deadline) throw new Error("host never registered");
			const attempt = await connectDevice(url, identity.publicKey);
			devices.push(attempt.ws);
			first = attempt.first;
			if (first?.t !== "ready") await Bun.sleep(20);
		}
		while (opened.length === 0 && Date.now() < deadline) await Bun.sleep(10);
		expect(opened).toHaveLength(1);
	} finally {
		for (const ws of devices) ws.close();
		connection.stop();
		relay.stop();
		rmSync(dir, { recursive: true, force: true });
	}
});
