import { App as CapApp } from "@capacitor/app";
import type { SessionEventPayload, TranscriptMessage } from "@thinkrail/contracts";
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
	const [open, setOpen] = useState<{
		hostKey: string;
		sessionId: string;
		workspaceId: string;
	} | null>(null);

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
				workspaceId={open.workspaceId}
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
								onClick={() =>
									setOpen({
										hostKey: item.hostKey,
										sessionId: item.record.sessionId,
										workspaceId: item.record.workspaceId,
									})
								}
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

interface Line {
	role: string;
	text: string;
}

/** Best-effort text from a transcript message (string content, text blocks, or a summary). */
function messageLine(message: TranscriptMessage): Line | null {
	const m = message as { role?: unknown; content?: unknown; summary?: unknown };
	const role = typeof m.role === "string" ? m.role : "message";
	let text = "";
	if (typeof m.content === "string") text = m.content;
	else if (Array.isArray(m.content)) {
		text = m.content
			.map((block) =>
				block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
					? (block as { text: string }).text
					: "",
			)
			.join("");
	} else if (typeof m.summary === "string") text = m.summary;
	text = text.trim();
	return text ? { role, text } : null;
}

function SessionScreen({
	hostKey,
	sessionId,
	workspaceId,
	onBack,
	controller,
}: {
	hostKey: string;
	sessionId: string;
	workspaceId: string;
	onBack: () => void;
	controller: ReturnType<typeof createRemoteSessions>;
}) {
	const client = controller.clientFor(hostKey);
	const [lines, setLines] = useState<Line[]>([]);
	const [text, setText] = useState("");

	useEffect(() => {
		if (!client) return;
		let cancelled = false;
		let pending: ReturnType<typeof setTimeout> | undefined;

		// Load the conversation so far — the phone picks up the ongoing session, not just new events.
		const refresh = (): void => {
			client
				.request<{ messages: TranscriptMessage[] }>("session.getMessages", {
					sessionId,
					workspaceId,
				})
				.then((result) => {
					if (!cancelled) setLines(result.messages.flatMap((m) => messageLine(m) ?? []));
				})
				.catch(() => {});
		};
		refresh();

		// Keep it current as the session streams, coalescing bursts of events into one refetch.
		const unsubscribe = client.subscribe(WS_CHANNELS.piEvent, (data) => {
			if ((data as SessionEventPayload).sessionId !== sessionId) return;
			if (pending) return;
			pending = setTimeout(() => {
				pending = undefined;
				refresh();
			}, 400);
		});
		return () => {
			cancelled = true;
			if (pending) clearTimeout(pending);
			unsubscribe();
		};
	}, [client, sessionId, workspaceId]);

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
			<pre
				style={{
					height: 360,
					overflow: "auto",
					background: "#f6f6f6",
					padding: 8,
					fontSize: 13,
					whiteSpace: "pre-wrap",
					fontFamily: "system-ui",
				}}
			>
				{lines.length === 0
					? "Loading conversation…"
					: lines.map((line) => `${line.role}: ${line.text}`).join("\n\n")}
			</pre>
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
