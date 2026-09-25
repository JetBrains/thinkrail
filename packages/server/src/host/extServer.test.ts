import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EXT_PROTOCOL_VERSION,
	type ExtensionInfo,
	extAssetPath,
	type WsServerMessage,
} from "@thinkrail/contracts";
import { createServer, type RunningServer } from "./server";

const TOKEN = "ext-route-token";
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let dataDir: string;
let server: RunningServer;

const HOST_HALF = `
import { defineExtension } from "@thinkrail/ext";
export default defineExtension((tr) => {
	tr.publish("count", 1);
	tr.action("double", (payload) => Number(payload) * 2);
});
`;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-ext-server-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	const dir = join(dataDir, "extensions", "demo");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "extension.json"),
		JSON.stringify({ name: "demo", surfaces: [{ id: "main", slot: "panel" }] }),
	);
	writeFileSync(join(dir, "index.ts"), HOST_HALF);
	writeFileSync(
		join(dir, "main.tsx"),
		'export default () => <div className="flex gap-2">demo</div>;\n',
	);
	server = await createServer({ port: 0, launchToken: TOKEN });
});

afterAll(async () => {
	await server.shutdown();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

const connect = async (protocol: number) => {
	const messages: WsServerMessage[] = [];
	const ws = new WebSocket(
		`ws://localhost:${server.port}/ws?token=${TOKEN}&protocol=${protocol}&client=c${protocol}`,
	);
	ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)));
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	let next = 0;
	const request = async (method: string, params: unknown) => {
		const id = `r${next++}`;
		ws.send(JSON.stringify({ id, method, params }));
		const response = await waitFor(() =>
			messages.find((message) => "id" in message && message.id === id),
		);
		if (!("id" in response) || !response.ok) throw new Error(JSON.stringify(response));
		return response.result;
	};
	return { ws, messages, request };
};

const waitFor = async <T>(find: () => T | undefined) => {
	for (let i = 0; i < 400; i++) {
		const found = find();
		if (found !== undefined) return found;
		await Bun.sleep(10);
	}
	throw new Error("timed out");
};

const isInfoList = (value: unknown): value is ExtensionInfo[] => Array.isArray(value);

const loadedDemo = async (request: (method: string, params: unknown) => Promise<unknown>) => {
	for (let i = 0; i < 200; i++) {
		const list = await request("ext.list", {});
		const demo = isInfoList(list) ? list.find((info) => info.name === "demo") : undefined;
		if (demo?.build) return { ...demo, build: demo.build };
		await Bun.sleep(25);
	}
	throw new Error("demo never loaded");
};

test("ext wire methods, pushes, and the tokened immutable asset route", async () => {
	const current = await connect(EXT_PROTOCOL_VERSION);
	const legacy = await connect(EXT_PROTOCOL_VERSION - 1);
	try {
		const demo = await loadedDemo(current.request);
		expect(demo.status).toBe("active");
		expect(await current.request("ext.snapshot", { keys: ["demo:count"] })).toEqual({
			"demo:count": 1,
		});
		expect(await current.request("ext.action", { ext: "demo", id: "double", payload: 21 })).toBe(
			42,
		);
		expect(
			await current.request("ext.reportError", {
				name: "demo",
				surfaceId: "main",
				message: "boom",
			}),
		).toEqual({ ok: true });

		const base = `http://localhost:${server.port}`;
		const js = extAssetPath({ name: "demo", build: demo.build, surfaceId: "main", kind: "js" });
		const css = extAssetPath({ name: "demo", build: demo.build, surfaceId: "main", kind: "css" });
		expect((await fetch(`${base}${js}`)).status).toBe(401);
		const served = await fetch(`${base}${js}?token=${TOKEN}`);
		expect(served.status).toBe(200);
		expect(served.headers.get("cache-control")).toContain("immutable");
		expect(served.headers.get("content-type")).toContain("javascript");
		expect(await served.text()).toContain("__thinkrail_runtime__");
		const style = await fetch(`${base}${css}?token=${TOKEN}`);
		expect(style.headers.get("content-type")).toContain("text/css");
		expect(await style.text()).toContain(".gap-2");
		const stale = js.replace(demo.build, "0".repeat(16));
		expect((await fetch(`${base}${stale}?token=${TOKEN}`)).status).toBe(404);

		await current.request("ext.reload", { name: "demo" });
		await waitFor(() =>
			current.messages.find((message) => "channel" in message && message.channel === "ext.changed"),
		);
		await waitFor(() =>
			current.messages.find(
				(message) => "channel" in message && message.channel === "ext.channelsDropped",
			),
		);
		await waitFor(() =>
			current.messages.find((message) => "channel" in message && message.channel === "ext.channel"),
		);
		expect(
			legacy.messages.some((message) => "channel" in message && message.channel.startsWith("ext.")),
		).toBe(false);
	} finally {
		current.ws.close();
		legacy.ws.close();
	}
}, 30_000);
