import { expect, test } from "bun:test";
import {
	existsSync,
	linkSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { claimAppInstalledIn, ensureInstallationIn } from "./installation";

const claimMarker = ".installation-app-installed.claim";

test("overlapping installation creation publishes only complete records and rereads the winner", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-installation-test-"));
	try {
		let contender: ReturnType<typeof ensureInstallationIn> | undefined;
		const winner = ensureInstallationIn(directory, (temp, target) => {
			expect(JSON.parse(readFileSync(temp, "utf8"))).toEqual({ id: expect.any(String) });
			expect(existsSync(target)).toBe(false);
			contender = ensureInstallationIn(directory);
			linkSync(temp, target);
		});

		if (!contender) throw new Error("the interleaved installation create did not run");
		expect(winner).toEqual(contender);
		expect(JSON.parse(readFileSync(join(directory, "installation.json"), "utf8"))).toEqual(winner);
		expect(readdirSync(directory)).toEqual(["installation.json"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("overlapping app-installed claims allow one event decision and preserve one stable id", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-installation-test-"));
	writeFileSync(join(directory, "installation.json"), JSON.stringify({ id: "shared-install" }));
	try {
		let contender: boolean | undefined;
		const winner = claimAppInstalledIn(directory, (temp, target) => {
			contender = claimAppInstalledIn(directory);
			renameSync(temp, target);
		});

		expect(winner).toBe(true);
		expect(contender).toBe(false);
		expect([winner, contender].filter(Boolean)).toHaveLength(1);
		expect(JSON.parse(readFileSync(join(directory, "installation.json"), "utf8"))).toEqual({
			id: "shared-install",
			appInstalled: true,
		});
		expect(readdirSync(directory)).toContain(claimMarker);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("legacy records already marked installed are preserved without another claim", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-installation-test-"));
	const target = join(directory, "installation.json");
	const contents = `${JSON.stringify({ id: "existing-install", appInstalled: true }, null, "\t")}\n`;
	writeFileSync(target, contents);
	try {
		expect(claimAppInstalledIn(directory)).toBe(false);
		expect(readFileSync(target, "utf8")).toBe(contents);
		expect(readdirSync(directory)).toEqual(["installation.json"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("a durable claim marker survives a simulated crash before record replacement", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-installation-test-"));
	const target = join(directory, "installation.json");
	const contents = `${JSON.stringify({ id: "existing-install" }, null, "\t")}\n`;
	writeFileSync(target, contents);
	writeFileSync(join(directory, claimMarker), "");
	try {
		expect(claimAppInstalledIn(directory)).toBe(false);
		expect(readFileSync(target, "utf8")).toBe(contents);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("malformed installation records are preserved rather than replacing a possible winner", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-installation-test-"));
	const target = join(directory, "installation.json");
	const contents = "{not-json";
	writeFileSync(target, contents);
	try {
		expect(() => ensureInstallationIn(directory)).toThrow("without a valid installation id");
		expect(readFileSync(target, "utf8")).toBe(contents);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("a failed atomic marker replacement preserves the install record and a retry claims once", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-installation-test-"));
	const target = join(directory, "installation.json");
	const oldContents = `${JSON.stringify({ id: "existing-install" }, null, "\t")}\n`;
	writeFileSync(target, oldContents);
	try {
		expect(() =>
			claimAppInstalledIn(directory, (temp, destination) => {
				expect(dirname(String(temp))).toBe(directory);
				expect(dirname(String(destination))).toBe(directory);
				expect(String(destination)).toBe(target);
				expect(JSON.parse(readFileSync(temp, "utf8"))).toEqual({
					id: "existing-install",
					appInstalled: true,
				});
				throw new Error("replacement failed");
			}),
		).toThrow("replacement failed");
		expect(readFileSync(target, "utf8")).toBe(oldContents);
		expect(readdirSync(directory)).toEqual(["installation.json"]);

		expect(claimAppInstalledIn(directory, renameSync)).toBe(true);
		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
			id: "existing-install",
			appInstalled: true,
		});
		expect(claimAppInstalledIn(directory, renameSync)).toBe(false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
