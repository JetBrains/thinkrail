import { expect, test } from "bun:test";
import { configFromEnv, DEFAULT_LIMITS } from "./config";
import { turnCredentials, turnIssuer } from "./turnCredentials";

test("an empty environment gives the local defaults with TURN off", () => {
	expect(configFromEnv({})).toEqual({
		port: 24243,
		host: "0.0.0.0",
		trustProxy: false,
		limits: DEFAULT_LIMITS,
		turn: null,
	});
});

test("TURN, proxy and limits are read from the environment", () => {
	const config = configFromEnv({
		PORT: "8080",
		TRUST_PROXY: "1",
		MAX_CONNECTIONS_PER_ADDRESS: "5",
		TURN_URLS: "turn:turn.example:3478?transport=udp, turns:turn.example:443?transport=tcp",
		TURN_SECRET: "s3cret",
	});
	expect(config.port).toBe(8080);
	expect(config.trustProxy).toBe(true);
	expect(config.limits.maxConnectionsPerAddress).toBe(5);
	expect(config.turn).toEqual({
		urls: ["turn:turn.example:3478?transport=udp", "turns:turn.example:443?transport=tcp"],
		secret: "s3cret",
		ttlSeconds: 43_200,
		issuesPerMinute: 10,
	});
	expect(
		configFromEnv({
			TURN_URLS: "turn:x",
			TURN_SECRET: "s",
			TURN_TTL_SECONDS: "120",
			TURN_ISSUES_PER_MINUTE: "3",
		}).turn,
	).toMatchObject({ ttlSeconds: 120, issuesPerMinute: 3 });
});

test("malformed values fail loudly instead of falling back", () => {
	expect(() => configFromEnv({ PORT: "abc" })).toThrow();
	expect(() => configFromEnv({ TURN_URLS: "turn:x" })).toThrow();
});

test("TURN credentials follow coturn's REST scheme: expiry username, HMAC-SHA1 password", () => {
	const credentials = turnCredentials(
		{ urls: ["turn:t"], secret: "secret", ttlSeconds: 60, issuesPerMinute: 1 },
		1_000_000,
	);
	expect(credentials.username).toBe("1060:thinkrail");
	const expected = new Bun.CryptoHasher("sha1", "secret").update("1060:thinkrail").digest("base64");
	expect(credentials.credential).toBe(expected);
	expect(credentials.urls).toEqual(["turn:t"]);
});

test("TURN credentials are handed out per client address at most at its rate", () => {
	const issue = turnIssuer({ urls: ["turn:t"], secret: "s", ttlSeconds: 60, issuesPerMinute: 2 });
	const start = 1_000_000;
	expect(issue("a", start)?.[0]?.username).toBe("1060:thinkrail");
	expect(issue("a", start)).toHaveLength(1);
	expect(issue("a", start)).toBeUndefined();
	expect(issue("b", start)).toHaveLength(1);
	expect(issue("a", start + 30_000)).toHaveLength(1);
});
