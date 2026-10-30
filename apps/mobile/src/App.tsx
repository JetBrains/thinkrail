import { App as CapApp } from "@capacitor/app";
import type { SessionEventPayload } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import {
	connectRemoteProject,
	createHostRegistry,
	createRemoteSessions,
	type RemoteSessionItem,
	type SavedHost,
} from "@thinkrail/remote-client";
import { useEffect, useMemo, useState } from "react";
import { localStore } from "./store";

const DEVICE_LABEL = "Mobile";

export function App() {
	const registry = useMemo(() => createHostRegistry(localStore), []);
	const controller = useMemo(() => createRemoteSessions(), []);
	const [items, setItems] = useState<RemoteSessionItem[]>([]);
	const [link, setLink] = useState("");
	const [status, setStatus] = useState("");
	const [open, setOpen] = useState<{ hostKey: string; sessionId: string } | null>(null);

	useEffect(() => {
		const unsubscribe = controller.subscribe(() => setItems(controller.items()));
		for (const host of registry.list()) {
			void controller.connect(host).catch((error: unknown) => setStatus(String(error)));
		}
		const deepLink = CapApp.addListener("appUrlOpen", (event) => setLink(event.url));
		return () => {
			unsubscribe();
			void deepLink.then((handle) => handle.remove());
			controller.stop();
		};
	}, [controller, registry]);

	const addHost = async (): Promise<void> => {
		const value = link.trim();
		if (!value) return;
		setStatus("Pairing…");
		try {
			const connection = await connectRemoteProject(value, { label: DEVICE_LABEL });
			const host: SavedHost = {
				hostKey: connection.hostKey,
				relayUrl: connection.relayUrl,
				label: new URL(connection.relayUrl).host,
				pairedAt: Date.now(),
			};
			connection.close(); // device is now registered on the host; reconnect via resume below
			registry.add(host);
			await controller.connect(host);
			setLink("");
			setStatus("");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : String(error));
		}
	};

	if (open) {
		return (
			<SessionScreen
				hostKey={open.hostKey}
				sessionId={open.sessionId}
				onBack={() => setOpen(null)}
				controller={controller}
			/>
		);
	}

	return (
		<main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 680, margin: "0 auto" }}>
			<h1 style={{ fontSize: 20 }}>ThinkRail — sessions</h1>
			<div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
				<input
					value={link}
					onChange={(e) => setLink(e.target.value)}
					placeholder="Paste a thinkrail://pair link"
					style={{ flex: 1, padding: 8 }}
				/>
				<button type="button" onClick={() => void addHost()}>
					Add host
				</button>
			</div>
			{status ? <p style={{ color: "crimson" }}>{status}</p> : null}
			{items.length === 0 ? (
				<p style={{ opacity: 0.6 }}>No sessions yet. Pair a host with its link.</p>
			) : (
				<ul style={{ listStyle: "none", padding: 0 }}>
					{items.map((item) => (
						<li
							key={`${item.hostKey}:${item.record.sessionId}`}
							style={{ borderBottom: "1px solid #ddd" }}
						>
							<button
								type="button"
								onClick={() => setOpen({ hostKey: item.hostKey, sessionId: item.record.sessionId })}
								style={{
									width: "100%",
									textAlign: "left",
									padding: "10px 4px",
									background: "none",
									border: "none",
								}}
							>
								<strong>{item.hostLabel}</strong> ·{" "}
								{item.record.firstPrompt ?? item.record.sessionId}
								{item.record.state.needsInput ? " · ⚠ needs input" : ""}
								{item.record.state.execution === "running" ? " · ●" : ""}
							</button>
						</li>
					))}
				</ul>
			)}
		</main>
	);
}

function SessionScreen({
	hostKey,
	sessionId,
	onBack,
	controller,
}: {
	hostKey: string;
	sessionId: string;
	onBack: () => void;
	controller: ReturnType<typeof createRemoteSessions>;
}) {
	const client = controller.clientFor(hostKey);
	const [log, setLog] = useState<{ id: number; line: string }[]>([]);
	const [text, setText] = useState("");

	useEffect(() => {
		if (!client) return;
		let seq = 0;
		return client.subscribe(WS_CHANNELS.piEvent, (data) => {
			const payload = data as SessionEventPayload;
			if (payload.sessionId === sessionId) {
				seq += 1;
				const entry = { id: seq, line: payload.event.type };
				setLog((prev) => [...prev.slice(-200), entry]);
			}
		});
	}, [client, sessionId]);

	const send = async (): Promise<void> => {
		const value = text.trim();
		if (!value || !client) return;
		setText("");
		await client.request("session.followUp", { sessionId, text: value }).catch(() => {});
	};

	return (
		<main style={{ fontFamily: "system-ui", padding: 16, maxWidth: 680, margin: "0 auto" }}>
			<button type="button" onClick={onBack}>
				← Back
			</button>
			<h2 style={{ fontSize: 16 }}>{sessionId}</h2>
			<div
				style={{ height: 300, overflow: "auto", background: "#f6f6f6", padding: 8, fontSize: 12 }}
			>
				{log.map((entry) => (
					<div key={entry.id}>{entry.line}</div>
				))}
			</div>
			<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
				<input
					value={text}
					onChange={(e) => setText(e.target.value)}
					style={{ flex: 1, padding: 8 }}
				/>
				<button type="button" onClick={() => void send()}>
					Send
				</button>
			</div>
		</main>
	);
}
