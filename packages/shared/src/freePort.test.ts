import { afterEach, expect, test } from "bun:test";
import { findFreePort, isPortFree, parsePort } from "./freePort";

const servers: ReturnType<typeof Bun.serve>[] = [];
function listenOn(port: number): number {
	const server = Bun.serve({ port, hostname: "localhost", fetch: () => new Response("ok") });
	servers.push(server);
	const actual = server.port;
	if (actual == null) throw new Error("server failed to bind");
	return actual;
}

afterEach(() => {
	while (servers.length) servers.pop()?.stop(true);
});

test("isPortFree is true for an unused port", async () => {
	const port = listenOn(0);
	servers.pop()?.stop(true);
	expect(await isPortFree(port)).toBe(true);
});

test("isPortFree is false while a server is listening", async () => {
	const port = listenOn(0);
	expect(await isPortFree(port)).toBe(false);
});

test("findFreePort returns the preferred port when it is free", async () => {
	const port = listenOn(0);
	servers.pop()?.stop(true);
	expect(await findFreePort(port)).toBe(port);
});

test("findFreePort skips a taken port and scans upward", async () => {
	const taken = listenOn(0);
	const chosen = await findFreePort(taken);
	expect(chosen).toBeGreaterThan(taken);
});

test("findFreePort never scans the well-known range", async () => {
	// Regression: the Windows desktop host settled on port 1 (ERR_UNSAFE_PORT
	// in WebView2) after a scan that started at port 0.
	for (const preferred of [0, 1, 80]) {
		const port = await findFreePort(preferred, "127.0.0.1");
		expect(port).toBeGreaterThan(1023);
		expect(await isPortFree(port, "127.0.0.1")).toBe(true);
	}
});

test("parsePort accepts plain decimal ports from 0 to 65535", () => {
	expect(parsePort("0")).toBe(0);
	expect(parsePort("24242")).toBe(24242);
	expect(parsePort("65535")).toBe(65535);
});

test("parsePort rejects empty, non-decimal and out-of-range values", () => {
	for (const bad of [
		undefined,
		"",
		" ",
		"abc",
		"0x10",
		"1e3",
		"-1",
		"+80",
		" 80",
		"80.5",
		"65536",
		"99999",
	]) {
		expect(parsePort(bad)).toBeUndefined();
	}
});
