import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FONTS_PROTOCOL_VERSION,
	USER_FONT_UPLOAD_HEADER,
	type UserFontFile,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { resetAnalyticsForTests } from "../analytics";
import { resetJbcentralStateForTests } from "../auth";
import { fontsDir, MAX_FONT_FILE_BYTES, MAX_FONT_FILES, readUserFonts } from "../fonts";
import { buildTestCollection, buildTestFont } from "../fonts/testFonts";
import { resetConfigCache } from "../settings";
import { serveUserFonts } from "./fontRoutes";
import { createServer } from "./server";

const saved = {
	THINKRAIL_DATA_DIR: process.env.THINKRAIL_DATA_DIR,
	PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
	PI_OFFLINE: process.env.PI_OFFLINE,
};
const UPLOAD = { [USER_FONT_UPLOAD_HEADER.name]: USER_FONT_UPLOAD_HEADER.value };
let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "thinkrail-font-routes-"));
	process.env.THINKRAIL_DATA_DIR = join(directory, "data");
	process.env.PI_CODING_AGENT_DIR = join(directory, "pi");
	process.env.PI_OFFLINE = "1";
});

afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function send(
	method: string,
	name: string,
	init: { body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<Response> {
	const pathname = `/fonts/${name}`;
	return serveUserFonts(new Request(`http://127.0.0.1${pathname}`, { method, ...init }), pathname);
}

function upload(name: string, body: BodyInit | null, headers: Record<string, string> = {}) {
	return send("PUT", name, {
		...(body === null ? {} : { body }),
		headers: { ...UPLOAD, ...headers },
	});
}

function streamOf(chunk: Uint8Array, count: number): ReadableStream<Uint8Array> {
	let sent = 0;
	return new ReadableStream({
		pull(controller) {
			if (sent++ < count) controller.enqueue(chunk);
			else controller.close();
		},
	});
}

function withoutCors(response: Response): void {
	for (const key of response.headers.keys()) expect(key).not.toStartWith("access-control-");
}

test("an upload without the upload header is forbidden and writes nothing", async () => {
	const response = await send("PUT", "Inter.ttf", { body: buildTestFont("ttf") });
	expect(response.status).toBe(403);
	withoutCors(response);
	expect(existsSync(fontsDir())).toBe(false);
});

test("an upload stores the font, replaces a same-named file and answers its entry", async () => {
	const first = await upload("My%20Font.woff2", buildTestFont("woff2", { family: "My Font" }));
	expect(first.status).toBe(200);
	const entry = (await first.json()) as UserFontFile;
	expect(entry).toMatchObject({
		fileName: "My Font.woff2",
		ok: true,
		url: expect.stringMatching(/^\/fonts\/My%20Font\.woff2\?v=/),
		face: { family: "My Font", weight: { min: 400, max: 400 } },
	});
	expect(readUserFonts().files).toEqual([entry]);
	const second = await upload("My%20Font.woff2", buildTestFont("woff2", { weightClass: 700 }));
	expect(second.status).toBe(200);
	const replaced = (await second.json()) as UserFontFile;
	expect(replaced).toMatchObject({ ok: true, face: { weight: { min: 700, max: 700 } } });
	expect(readUserFonts().files).toEqual([replaced]);
	expect(readdirSync(fontsDir())).toEqual(["My Font.woff2"]);
});

test("unsafe names are refused; a collection or a broken font is unprocessable", async () => {
	for (const name of [
		"",
		"a%2Fb.ttf",
		"a%5Cb.ttf",
		"..%2Fescape.ttf",
		"x..y.ttf",
		"%2Ehidden.ttf",
		"nul%00.ttf",
		"%E0%A4%A.ttf",
		"font.exe",
		"font",
	]) {
		expect((await upload(name, buildTestFont("ttf"))).status).toBe(400);
	}
	const collection = await upload("Set.TTC", buildTestCollection());
	expect(collection.status).toBe(422);
	expect(await collection.json()).toEqual({
		fileName: "Set.TTC",
		ok: false,
		error: "unsupported-collection",
	});
	const broken = await upload("Broken.otf", "not a font");
	expect(broken.status).toBe(422);
	expect(await broken.json()).toMatchObject({ fileName: "Broken.otf", error: "invalid-font" });
	expect(readUserFonts().files).toEqual([]);
});

test("oversized uploads are refused up front by length or while streaming", async () => {
	const declared = await upload("Huge.ttf", "tiny", {
		"Content-Length": String(MAX_FONT_FILE_BYTES + 1),
	});
	expect(declared.status).toBe(413);
	expect(await declared.json()).toEqual({ fileName: "Huge.ttf", ok: false, error: "too-large" });
	const megabyte = new Uint8Array(1024 * 1024);
	const streamed = await upload(
		"Huge.ttf",
		streamOf(megabyte, MAX_FONT_FILE_BYTES / megabyte.length + 1),
	);
	expect(streamed.status).toBe(413);
	expect(await streamed.json()).toEqual({ fileName: "Huge.ttf", ok: false, error: "too-large" });
	expect(readdirSync(fontsDir())).toEqual([]);
});

test("a full folder refuses a new name with a too-many entry", async () => {
	mkdirSync(fontsDir(), { recursive: true });
	for (let index = 0; index < MAX_FONT_FILES; index++) {
		writeFileSync(join(fontsDir(), `f${String(index).padStart(3, "0")}.otf`), "x");
	}
	const response = await upload("new.ttf", buildTestFont("ttf"));
	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({ fileName: "new.ttf", ok: false, error: "too-many" });
});

test("GET serves a font with its type, revalidated, and 404s anything else", async () => {
	const bytes = buildTestFont("woff");
	mkdirSync(join(fontsDir(), "folder.ttf"), { recursive: true });
	writeFileSync(join(fontsDir(), "Face.WOFF"), bytes);
	writeFileSync(join(fontsDir(), "Set.ttc"), buildTestCollection());
	writeFileSync(join(fontsDir(), "notes.txt"), "x");
	const response = await send("GET", "Face.WOFF");
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("font/woff");
	expect(response.headers.get("Cache-Control")).toBe("no-cache");
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	withoutCors(response);
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
	for (const name of [
		"missing.ttf",
		"Set.ttc",
		"notes.txt",
		"folder.ttf",
		"..%2Fdata.ttf",
		"%E0",
	]) {
		expect((await send("GET", name)).status).toBe(404);
	}
});

test("other methods, a CORS preflight included, are not allowed", async () => {
	for (const method of ["OPTIONS", "POST", "DELETE", "PATCH", "HEAD"]) {
		const response = await send(method, "Face.ttf", { headers: UPLOAD });
		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("GET, PUT");
		withoutCors(response);
	}
});

test("the host routes /fonts/ and nudges only sockets that speak the fonts protocol", async () => {
	resetConfigCache();
	await resetJbcentralStateForTests();
	const server = await createServer({ port: 0, host: "127.0.0.1", analytics: { mute: true } });
	const sockets: WebSocket[] = [];
	try {
		const base = `127.0.0.1:${server.port}`;
		const put = await fetch(`http://${base}/fonts/Wired.ttf`, {
			method: "PUT",
			headers: UPLOAD,
			body: buildTestFont("ttf", { family: "Wired" }),
		});
		expect(put.status).toBe(200);
		const get = await fetch(`http://${base}/fonts/Wired.ttf`);
		expect(get.headers.get("Content-Type")).toBe("font/ttf");
		expect((await fetch(`http://${base}/fonts/Wired.ttf`, { method: "OPTIONS" })).status).toBe(405);

		const messages = new Map<number, unknown[]>();
		const connect = async (protocol: number) => {
			const socket = new WebSocket(`ws://${base}/ws?client=fonts-${protocol}&protocol=${protocol}`);
			sockets.push(socket);
			const received: unknown[] = [];
			messages.set(protocol, received);
			const welcomed = Promise.withResolvers<void>();
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(String(event.data)) as { channel?: string };
				received.push(message);
				if (message.channel === WS_CHANNELS.serverWelcome) welcomed.resolve();
			});
			await welcomed.promise;
			return socket;
		};
		const current = await connect(FONTS_PROTOCOL_VERSION);
		await connect(FONTS_PROTOCOL_VERSION - 1);

		const count = (protocol: number, matches: (message: Record<string, unknown>) => boolean) =>
			(messages.get(protocol) ?? []).filter((message) =>
				matches(message as Record<string, unknown>),
			).length;
		const within = async (condition: () => boolean) => {
			for (let waited = 0; waited < 5_000 && !condition(); waited += 50) await Bun.sleep(50);
		};
		current.send(JSON.stringify({ id: "list-1", method: "fonts.list", params: {} }));
		await within(() => count(FONTS_PROTOCOL_VERSION, (message) => message.id === "list-1") > 0);
		expect(messages.get(FONTS_PROTOCOL_VERSION)).toContainEqual({
			id: "list-1",
			ok: true,
			result: {
				dir: fontsDir(),
				files: [expect.objectContaining({ fileName: "Wired.ttf", ok: true })],
			},
		});
		const nudge = (message: Record<string, unknown>) =>
			message.channel === WS_CHANNELS.fontsChanged;
		const before = count(FONTS_PROTOCOL_VERSION, nudge);
		writeFileSync(join(fontsDir(), "Later.otf"), buildTestFont("otf", { family: "Later" }));
		await within(() => count(FONTS_PROTOCOL_VERSION, nudge) > before);
		expect(count(FONTS_PROTOCOL_VERSION, nudge)).toBeGreaterThan(before);
		expect(count(FONTS_PROTOCOL_VERSION - 1, nudge)).toBe(0);
	} finally {
		for (const socket of sockets) socket.close();
		await server.shutdown();
		resetAnalyticsForTests();
		resetConfigCache();
		await resetJbcentralStateForTests();
	}
});
