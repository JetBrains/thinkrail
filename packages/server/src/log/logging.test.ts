import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Writable } from "node:stream";
import pino, { type DestinationStream } from "pino";
import pretty from "pino-pretty";
import {
	createPinoOptions,
	createPinoRollOptions,
	createPrettyOptions,
	describeError,
	LOG_FILE_SIZE,
	LOG_RETENTION_FILES,
	LOG_SCHEMA_VERSION,
	resolveLogLevel,
	serializeLogError,
	shouldLog,
} from "./logging";

class StringSink extends Writable {
	value = "";

	override _write(
		chunk: string | Buffer,
		_encoding: BufferEncoding,
		callback: (error?: Error | null) => void,
	): void {
		this.value += chunk.toString();
		callback();
	}
}

describe("level resolution", () => {
	test("gates lower levels", () => {
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

describe("Pino records", () => {
	test("writes the support schema and a structured error", () => {
		const lines: string[] = [];
		const destination: DestinationStream = { write: (line) => lines.push(line) };
		const log = pino(createPinoOptions("debug"), destination).child({ scope: "agent" });

		log.error({ err: serializeLogError(new Error("boom")) }, "prompt failed");

		const record = JSON.parse(lines[0] as string);
		expect(record).toMatchObject({
			err: { message: "boom", type: "Error" },
			level: 50,
			levelName: "error",
			msg: "prompt failed",
			schemaVersion: LOG_SCHEMA_VERSION,
			scope: "agent",
		});
		expect(record.err.stack).toContain("Error: boom");
		expect(new Date(record.time).toISOString()).toBe(record.time);
	});

	test("removes structured secret fields", () => {
		const lines: string[] = [];
		const destination: DestinationStream = { write: (line) => lines.push(line) };
		const log = pino(createPinoOptions("info"), destination);

		log.info(
			{
				headers: { authorization: "Bearer secret", safe: "kept" },
				token: "secret",
			},
			"redacted",
		);

		const record = JSON.parse(lines[0] as string);
		expect(record.token).toBeUndefined();
		expect(record.headers).toEqual({ safe: "kept" });
		expect(lines[0]).not.toContain("secret");
	});
});

describe("destinations", () => {
	test("configures pino-roll as the file lifecycle owner", () => {
		expect(createPinoRollOptions("/tmp/logs")).toEqual({
			dateFormat: "yyyy-MM-dd",
			file: join("/tmp/logs", "thinkrail.jsonl"),
			frequency: "daily",
			limit: { count: LOG_RETENTION_FILES, removeOtherLogFiles: true },
			mkdir: true,
			size: LOG_FILE_SIZE,
			sync: true,
		});
	});

	test("renders readable stderr text", async () => {
		const sink = new StringSink();
		const prettyStream = pretty(createPrettyOptions(sink));
		const log = pino(createPinoOptions("info"), prettyStream).child({ scope: "host" });

		log.info("listening");
		await Bun.sleep(10);
		prettyStream.end();

		expect(sink.value).toContain("INFO");
		expect(sink.value).toContain("[host] listening");
		expect(sink.value).not.toContain("schemaVersion");
	});
});

describe("error normalization", () => {
	test("keeps only the stable Error fields", () => {
		const error = Object.assign(new Error("boom"), { token: "secret" });
		const serialized = serializeLogError(error);
		expect(serialized).toMatchObject({ type: "Error", message: "boom" });
		expect(serialized).not.toHaveProperty("token");
	});

	test("renders non-Error throws without throwing", () => {
		expect(serializeLogError("odd")).toEqual({
			type: "NonError",
			message: "Non-Error thrown: odd",
		});
		expect(describeError({ reason: "odd" })).toBe('Non-Error thrown: {"reason":"odd"}');
	});
});
