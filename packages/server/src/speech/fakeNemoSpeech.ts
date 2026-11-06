#!/usr/bin/env bun
/** Test stand-in for the `nemo-speech` CLI; its behavior is specified in the speech SPEC (Engine). */
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const BYTES_PER_WORD = 16_000 * 2 * 0.16;

function flag(name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

if (args[0] === "--version") {
	console.log(`nemo-speech ${process.env.FAKE_SPEECH_VERSION ?? "0.3.0"}`);
	process.exit(0);
}
if (args[0] === "doctor") {
	console.log(JSON.stringify({ features: { backend_metal: false, backend_cuda: false } }));
	process.exit(0);
}
if (args[0] !== "serve") {
	console.error(`fake nemo-speech: unsupported command ${args[0]}`);
	process.exit(2);
}
if (process.env.FAKE_SPEECH_FAIL_START) {
	console.error("fake nemo-speech: failing on purpose");
	process.exit(3);
}

if (process.env.FAKE_SPEECH_START_DELAY_MS) {
	await Bun.sleep(Number(process.env.FAKE_SPEECH_START_DELAY_MS));
}

const port = Number(flag("--port"));
const apiKey = flag("--api-key");
const words = (process.env.FAKE_SPEECH_TEXT ?? "Hello from the fake engine").split(/\s+/);

interface Session {
	received: number;
	emitted: number;
	text: string;
}

const authorized = (req: Request, url: URL) =>
	!apiKey ||
	req.headers.get("authorization") === `Bearer ${apiKey}` ||
	url.searchParams.get("api_key") === apiKey;

Bun.serve<Session, never>({
	port,
	hostname: "127.0.0.1",
	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/health") return Response.json({ status: "ok", version: "0.3.0" });
		if (!authorized(req, url)) return new Response("unauthorized", { status: 401 });
		if (url.pathname === "/v1/models") return Response.json({ data: [{ streaming: true }] });
		if (url.pathname === "/v1/audio/transcriptions/realtime") {
			return server.upgrade(req, { data: { received: 0, emitted: 0, text: "" } })
				? undefined
				: new Response("upgrade failed", { status: 400 });
		}
		return new Response("not found", { status: 404 });
	},
	websocket: {
		open(ws) {
			ws.send(JSON.stringify({ type: "session.created" }));
		},
		message(ws, message) {
			if (typeof message !== "string") {
				ws.data.received += message.byteLength;
				while (
					ws.data.emitted < words.length &&
					ws.data.received >= (ws.data.emitted + 1) * BYTES_PER_WORD
				) {
					const delta = `${ws.data.emitted === 0 ? "" : " "}${words[ws.data.emitted]}`;
					ws.data.emitted += 1;
					ws.data.text += delta;
					ws.send(
						JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta }),
					);
				}
				return;
			}
			const event = JSON.parse(message);
			if (event.type === "session.update") {
				if (process.env.FAKE_SPEECH_LOG) {
					appendFileSync(process.env.FAKE_SPEECH_LOG, `${JSON.stringify(event.session)}\n`);
				}
				ws.send(JSON.stringify({ type: "session.updated", session: event.session }));
			} else if (event.type === "input_audio_buffer.commit") {
				ws.send(
					JSON.stringify({
						type: "conversation.item.input_audio_transcription.completed",
						transcript: ws.data.text,
					}),
				);
				ws.send(JSON.stringify({ type: "input_audio_buffer.committed" }));
				ws.data.text = "";
			}
		},
	},
});
