import { describe, expect, test } from "bun:test";
import { parseUpdateArgs, resolveUpdatePlan } from "./update";

describe("parseUpdateArgs", () => {
	test("defaults to latest, no channel override", () => {
		expect(parseUpdateArgs([])).toEqual({ version: "latest" });
	});

	test("reads --channel and --version (space + = forms)", () => {
		expect(parseUpdateArgs(["--channel", "nightly", "--version", "0.2.0"])).toEqual({
			channel: "nightly",
			version: "0.2.0",
		});
		expect(parseUpdateArgs(["--channel=stable", "--version=1.2.3-nightly.4"])).toEqual({
			channel: "stable",
			version: "1.2.3-nightly.4",
		});
	});

	test("rejects a bad channel, version, or unknown flag", () => {
		expect(() => parseUpdateArgs(["--channel", "beta"])).toThrow("Invalid --channel: beta");
		expect(() => parseUpdateArgs(["--version", "v1.2.3"])).toThrow("Invalid --version: v1.2.3");
		expect(() => parseUpdateArgs(["--nope"])).toThrow("Unknown option: --nope");
		expect(() => parseUpdateArgs(["--channel"])).toThrow("Missing value for --channel");
	});
});

describe("resolveUpdatePlan", () => {
	const home = "/home/u";

	test("flag channel wins over metadata and baked", () => {
		const plan = resolveUpdatePlan({
			args: { channel: "nightly", version: "latest" },
			installMeta: { channel: "stable", prefix: "/home/u/.local" },
			baked: "stable",
			home,
		});
		expect(plan.channel).toBe("nightly");
		expect(plan.bashArgs).toEqual([
			"-s",
			"--",
			"--channel",
			"nightly",
			"--prefix",
			"/home/u/.local",
		]);
	});

	test("falls back metadata → baked → stable, and default prefix", () => {
		expect(
			resolveUpdatePlan({
				args: { version: "latest" },
				installMeta: { channel: "nightly" },
				baked: "stable",
				home,
			}).channel,
		).toBe("nightly");
		expect(
			resolveUpdatePlan({ args: { version: "latest" }, installMeta: {}, baked: "nightly", home })
				.channel,
		).toBe("nightly");
		const dev = resolveUpdatePlan({
			args: { version: "latest" },
			installMeta: {},
			baked: "dev",
			home,
		});
		expect(dev.channel).toBe("stable");
		expect(dev.prefix).toBe("/home/u/.local");
	});

	test("appends --version only when pinned", () => {
		const pinned = resolveUpdatePlan({
			args: { version: "0.3.0" },
			installMeta: {},
			baked: "stable",
			home,
		});
		expect(pinned.bashArgs).toEqual([
			"-s",
			"--",
			"--channel",
			"stable",
			"--prefix",
			"/home/u/.local",
			"--version",
			"0.3.0",
		]);
	});

	test("rejects an unsafe or relative prefix from metadata", () => {
		expect(() =>
			resolveUpdatePlan({
				args: { version: "latest" },
				installMeta: { prefix: "/tmp/$(rm -rf ~)" },
				baked: "stable",
				home,
			}),
		).toThrow("suspicious install prefix");
		expect(() =>
			resolveUpdatePlan({
				args: { version: "latest" },
				installMeta: { prefix: "relative/dir" },
				baked: "stable",
				home,
			}),
		).toThrow("suspicious install prefix");
	});
});
