import { expect, test } from "bun:test";
import { isLoopbackHost } from "./uiOrigin";

test("loopback hosts keep the paste fallback collapsed", () => {
	for (const host of [
		"localhost",
		"LOCALHOST",
		"app.localhost",
		"127.0.0.1",
		"127.1.2.3",
		"[::1]",
	]) {
		expect(isLoopbackHost(host)).toBe(true);
	}
});

test("any other host is treated as a possibly remote browser", () => {
	for (const host of [
		"my-server",
		"10.0.0.5",
		"192.168.1.20",
		"thinkrail.example.com",
		"127.0.0.1.nip.io",
		"localhost.evil.com",
	]) {
		expect(isLoopbackHost(host)).toBe(false);
	}
});
