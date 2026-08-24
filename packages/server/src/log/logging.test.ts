import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatLogLine,
	LogFileWriter,
	latestLogSequence,
	logFileName,
	parseLogFileName,
	resolveLogLevel,
	selectRetentionVictims,
	shouldLog,
} from "./logging";

describe("logFileName / parseLogFileName", () => {
	test("sequence 0 has no suffix, later sequences carry _n", () => {
		expect(logFileName("2026-01-28", 0)).toBe("thinkrail-2026-01-28.log");
		expect(logFileName("2026-01-28", 1)).toBe("thinkrail-2026-01-28_1.log");
		expect(logFileName("2026-01-28", 12)).toBe("thinkrail-2026-01-28_12.log");
	});

	test("round-trips through parse and rejects foreign files", () => {
		expect(parseLogFileName("thinkrail-2026-01-28.log")).toEqual({
			day: "2026-01-28",
			sequence: 0,
		});
		expect(parseLogFileName("thinkrail-2026-01-28_3.log")).toEqual({
			day: "2026-01-28",
			sequence: 3,
		});
		expect(parseLogFileName("crash.log")).toBeNull();
		expect(parseLogFileName("thinkrail-notadate.log")).toBeNull();
	});
});

describe("latestLogSequence", () => {
	test("picks the highest sequence for the day, ignoring other days and foreign files", () => {
		const names = [
			"crash.log",
			"thinkrail-2026-01-27_9.log",
			"thinkrail-2026-01-28.log",
			"thinkrail-2026-01-28_2.log",
			"thinkrail-2026-01-28_1.log",
		];
		expect(latestLogSequence(names, "2026-01-28")).toBe(2);
		expect(latestLogSequence(names, "2026-01-27")).toBe(9);
		expect(latestLogSequence(names, "2026-01-26")).toBeNull();
	});
});

describe("selectRetentionVictims", () => {
	test("deletes files strictly older than the retention window, never crash.log", () => {
		const names = [
			"crash.log",
			"thinkrail-2026-01-13.log",
			"thinkrail-2026-01-14.log",
			"thinkrail-2026-01-14_4.log",
			"thinkrail-2026-01-28.log",
		];
		expect(selectRetentionVictims(names, "2026-01-28", 14)).toEqual(["thinkrail-2026-01-13.log"]);
	});
});

describe("shouldLog / resolveLogLevel", () => {
	test("threshold gates lower levels", () => {
		expect(shouldLog("debug", "info")).toBe(false);
		expect(shouldLog("info", "info")).toBe(true);
		expect(shouldLog("error", "warn")).toBe(true);
		expect(shouldLog("debug", "debug")).toBe(true);
	});

	test("option beats env beats default; invalid env is reported", () => {
		expect(resolveLogLevel("debug", "error")).toEqual({ level: "debug", invalidEnv: false });
		expect(resolveLogLevel(undefined, "warn")).toEqual({ level: "warn", invalidEnv: false });
		expect(resolveLogLevel(undefined, undefined)).toEqual({ level: "info", invalidEnv: false });
		expect(resolveLogLevel(undefined, "loud")).toEqual({ level: "info", invalidEnv: true });
	});
});

describe("formatLogLine", () => {
	const at = new Date("2026-01-28T10:03:22.123Z");

	test("renders ts, padded level, scope, message", () => {
		expect(formatLogLine(at, "info", "host", "listening on http://localhost:24242")).toBe(
			"2026-01-28T10:03:22.123Z INFO  [host] listening on http://localhost:24242",
		);
		expect(formatLogLine(at, "warn", "watch", "watcher failed")).toBe(
			"2026-01-28T10:03:22.123Z WARN  [watch] watcher failed",
		);
	});

	test("appends an indented error rendering", () => {
		const line = formatLogLine(at, "error", "agent", "prompt failed", new Error("boom"));
		const [head, ...rest] = line.split("\n");
		expect(head).toBe("2026-01-28T10:03:22.123Z ERROR [agent] prompt failed");
		expect(rest.length).toBeGreaterThan(0);
		expect(rest[0]).toMatch(/^ {2}Error: boom/);
		expect(rest.every((l) => l.startsWith("  "))).toBe(true);
	});

	test("renders non-Error values without throwing", () => {
		expect(formatLogLine(at, "warn", "host", "odd", "just a string")).toContain(
			"Non-Error thrown: just a string",
		);
	});
});

function tempLogsDir(): string {
	return mkdtempSync(join(tmpdir(), "thinkrail-log-test-"));
}

describe("LogFileWriter", () => {
	test("appends to the day file and rolls to _1, _2 at the byte cap", () => {
		const dir = tempLogsDir();
		try {
			const writer = new LogFileWriter(dir, 64, 14);
			const at = new Date("2026-01-28T10:00:00.000Z");
			const line = "x".repeat(30);
			writer.append(line, at);
			writer.append(line, at);
			writer.append(line, at);
			writer.append(line, at);
			writer.append(line, at);
			const names = readdirSync(dir).sort();
			expect(names).toEqual([
				"thinkrail-2026-01-28.log",
				"thinkrail-2026-01-28_1.log",
				"thinkrail-2026-01-28_2.log",
			]);
			expect(readFileSync(join(dir, "thinkrail-2026-01-28.log"), "utf8")).toBe(
				`${line}\n${line}\n`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a single oversized line still lands (in a file of its own)", () => {
		const dir = tempLogsDir();
		try {
			const writer = new LogFileWriter(dir, 16, 14);
			const at = new Date("2026-01-28T10:00:00.000Z");
			writer.append("y".repeat(100), at);
			writer.append("z", at);
			const names = readdirSync(dir).sort();
			expect(names).toEqual(["thinkrail-2026-01-28.log", "thinkrail-2026-01-28_1.log"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("switches file on day change", () => {
		const dir = tempLogsDir();
		try {
			const writer = new LogFileWriter(dir, 1024, 14);
			writer.append("today", new Date("2026-01-28T23:59:59.000Z"));
			writer.append("tomorrow", new Date("2026-01-29T00:00:01.000Z"));
			expect(readdirSync(dir).sort()).toEqual([
				"thinkrail-2026-01-28.log",
				"thinkrail-2026-01-29.log",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("resumes the highest existing sequence on open and honors its size", () => {
		const dir = tempLogsDir();
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "thinkrail-2026-01-28.log"), "old\n");
			writeFileSync(join(dir, "thinkrail-2026-01-28_1.log"), "w".repeat(64));
			const writer = new LogFileWriter(dir, 64, 14);
			writer.append("fresh", new Date("2026-01-28T12:00:00.000Z"));
			expect(readdirSync(dir).sort()).toEqual([
				"thinkrail-2026-01-28.log",
				"thinkrail-2026-01-28_1.log",
				"thinkrail-2026-01-28_2.log",
			]);
			expect(readFileSync(join(dir, "thinkrail-2026-01-28_2.log"), "utf8")).toBe("fresh\n");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sweeps files older than retention on open, keeping the boundary day and crash.log", () => {
		const dir = tempLogsDir();
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "thinkrail-2026-01-10.log"), "ancient\n");
			writeFileSync(join(dir, "thinkrail-2026-01-14.log"), "boundary\n");
			writeFileSync(join(dir, "crash.log"), "fatal\n");
			const writer = new LogFileWriter(dir, 1024, 14);
			writer.append("hello", new Date("2026-01-28T12:00:00.000Z"));
			expect(readdirSync(dir).sort()).toEqual([
				"crash.log",
				"thinkrail-2026-01-14.log",
				"thinkrail-2026-01-28.log",
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
