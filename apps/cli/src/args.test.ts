import { describe, expect, test } from "bun:test";
import { DEFAULT_HOST, DEFAULT_PORT, parseArgs, parseSubcommand } from "./args";

describe("parseSubcommand", () => {
	test("only a leading, exact subcommand counts", () => {
		expect(parseSubcommand(["update"])).toBe("update");
		expect(parseSubcommand(["uninstall", "--yes"])).toBe("uninstall");
		expect(parseSubcommand([])).toBeUndefined();
		expect(parseSubcommand(["--no-open"])).toBeUndefined();
		expect(parseSubcommand(["./update"])).toBeUndefined();
		expect(parseSubcommand(["--port", "80", "update"])).toBeUndefined();
	});

	test("a launch is not a subcommand — the host boot path must stay reachable", () => {
		expect(parseSubcommand(["/home/u/code/repo"])).toBeUndefined();
		expect(parseSubcommand(["--version"])).toBeUndefined();
	});
});

describe("parseArgs", () => {
	test("defaults when no args or env", () => {
		expect(parseArgs([], {})).toEqual({
			port: DEFAULT_PORT,
			host: DEFAULT_HOST,
			open: true,
			noAnalytics: false,
			verbose: false,
			staticDir: undefined,
			projectDir: undefined,
			help: false,
			version: false,
		});
	});

	test("--no-analytics mutes for the run; the env spelling is the analytics service's job", () => {
		expect(parseArgs(["--no-analytics"], {}).noAnalytics).toBe(true);
		expect(parseArgs([], { THINKRAIL_NO_ANALYTICS: "1" }).noAnalytics).toBe(false);
		expect(parseArgs([], {}).noAnalytics).toBe(false);
	});

	test("--verbose turns on debug logging; the env spelling is the log module's job", () => {
		expect(parseArgs(["--verbose"], {}).verbose).toBe(true);
		expect(parseArgs([], { THINKRAIL_LOG_LEVEL: "debug" }).verbose).toBe(false);
		expect(parseArgs([], {}).verbose).toBe(false);
	});

	test("flags win over env over defaults", () => {
		const env = {
			THINKRAIL_PORT: "9000",
			THINKRAIL_HOST: "envhost",
			THINKRAIL_STATIC_DIR: "/web/dist",
		};
		expect(parseArgs(["--port", "8080", "--host", "0.0.0.0"], env)).toMatchObject({
			port: 8080,
			host: "0.0.0.0",
			staticDir: "/web/dist",
		});
	});

	test("env fills in when a flag is absent", () => {
		expect(parseArgs([], { THINKRAIL_PORT: "9000", THINKRAIL_HOST: "envhost" })).toMatchObject({
			port: 9000,
			host: "envhost",
		});
	});

	test("supports --flag=value form", () => {
		expect(parseArgs(["--port=5000", "--host=h"], {})).toMatchObject({ port: 5000, host: "h" });
	});

	test("--no-open disables the browser", () => {
		expect(parseArgs(["--no-open"], {}).open).toBe(false);
	});

	test("--help / -h set help", () => {
		expect(parseArgs(["--help"], {}).help).toBe(true);
		expect(parseArgs(["-h"], {}).help).toBe(true);
	});

	test("--version / -v set version", () => {
		expect(parseArgs(["--version"], {}).version).toBe(true);
		expect(parseArgs(["-v"], {}).version).toBe(true);
	});

	test("a positional arg is the project dir", () => {
		expect(parseArgs(["/path/to/repo"], {}).projectDir).toBe("/path/to/repo");
		expect(parseArgs(["--no-open", "/repo"], {}).projectDir).toBe("/repo");
	});

	test("throws on an unknown option", () => {
		expect(() => parseArgs(["--nope"], {})).toThrow("Unknown option: --nope");
	});

	test("throws on a missing flag value", () => {
		expect(() => parseArgs(["--port"], {})).toThrow("Missing value for --port");
	});

	test("throws on an unparseable / out-of-range port", () => {
		expect(() => parseArgs(["--port", "abc"], {})).toThrow("Invalid --port: abc");
		expect(() => parseArgs(["--port", "99999"], {})).toThrow("Invalid --port: 99999");
	});

	test("throws on a second positional arg", () => {
		expect(() => parseArgs(["/a", "/b"], {})).toThrow("Unexpected argument: /b");
	});

	test("ignores a non-numeric env port (falls back to default)", () => {
		expect(parseArgs([], { THINKRAIL_PORT: "notanumber" }).port).toBe(DEFAULT_PORT);
	});
});
