import { expect, test } from "bun:test";
import { isLoopbackHost, redirectsToLoopback } from "./uiOrigin";

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

test("a loopback redirect_uri or callback_url marks the paste prompt as a fallback", () => {
	for (const url of [
		"https://radius.example/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A1456%2Foauth%2Fcallback",
		"https://auth.example/authorize?client_id=x&redirect_uri=http://localhost:1455/auth/callback",
		"https://auth.example/authorize?redirect_uri=http%3A%2F%2F%5B%3A%3A1%5D%3A8080%2Fcb",
		"https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A3000%2Foauth%2Fcallback%2Fabc",
	]) {
		expect(redirectsToLoopback(url)).toBe(true);
	}
});

test("an https, missing, or malformed redirect keeps the prompt required", () => {
	for (const url of [
		"https://claude.ai/oauth/authorize?code=true&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback",
		"https://e2e.test/authorize?probe=1",
		"https://auth.example/authorize?redirect_uri=not%20a%20url",
		"https://auth.example/authorize?redirect_uri=https%3A%2F%2F127.0.0.1%2Fcb",
		"not a url",
		"",
	]) {
		expect(redirectsToLoopback(url)).toBe(false);
	}
});
