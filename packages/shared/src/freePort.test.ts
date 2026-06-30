import { afterEach, expect, test } from "bun:test";
import { findFreePort, isPortFree } from "./freePort";

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
	const port = listenOn(0); // OS-assigned port we immediately release
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
	expect(await isPortFree(chosen)).toBe(true);
});
