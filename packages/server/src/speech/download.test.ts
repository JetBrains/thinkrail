import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { downloadVerified } from "./download";
import { type ServedFile, serveFiles, sha256 } from "./testServer";

const body = new Uint8Array(Array.from({ length: 64 * 1024 }, (_, i) => i % 251));
let dir: string;
let files: Map<string, ServedFile>;
let server: ReturnType<typeof serveFiles>;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "speech-download-"));
	files = new Map([["/model.gguf", { body }]]);
	server = serveFiles(files);
});

afterEach(() => {
	server.stop();
	rmSync(dir, { recursive: true, force: true });
});

const artifact = () => ({
	url: server.url("/model.gguf"),
	sha256: sha256(body),
	bytes: body.length,
});
const opts = (progress: number[] = []) => ({
	signal: new AbortController().signal,
	onProgress: (received: number) => progress.push(received),
});

test("a verified download lands at its destination with progress", async () => {
	const progress: number[] = [];
	const dest = join(dir, "model.gguf");
	await downloadVerified(artifact(), dest, opts(progress));
	expect(readFileSync(dest)).toEqual(Buffer.from(body));
	expect(existsSync(`${dest}.partial`)).toBe(false);
	expect(progress.at(-1)).toBe(body.length);
});

test("an interrupted download keeps its partial and resumes with a range", async () => {
	const dest = join(dir, "model.gguf");
	files.set("/model.gguf", { body, truncateAt: 10_000 });
	await expect(downloadVerified(artifact(), dest, opts())).rejects.toMatchObject({
		code: "SPEECH_DOWNLOAD_FAILED",
	});
	expect(existsSync(`${dest}.partial`)).toBe(true);
	files.set("/model.gguf", { body });
	await downloadVerified(artifact(), dest, opts());
	expect(readFileSync(dest)).toEqual(Buffer.from(body));
	expect(server.requests.at(-1)?.range).toMatch(/^bytes=\d+-$/);
});

test("a server that ignores the range restarts from zero", async () => {
	const dest = join(dir, "model.gguf");
	writeFileSync(`${dest}.partial`, body.slice(0, 5000));
	files.set("/model.gguf", { body, ignoreRange: true });
	await downloadVerified(artifact(), dest, opts());
	expect(readFileSync(dest)).toEqual(Buffer.from(body));
});

test("a checksum mismatch deletes the partial and never lands the file", async () => {
	const dest = join(dir, "model.gguf");
	const wrong = { ...artifact(), sha256: "0".repeat(64) };
	await expect(downloadVerified(wrong, dest, opts())).rejects.toMatchObject({
		code: "SPEECH_CHECKSUM_MISMATCH",
	});
	expect(existsSync(dest)).toBe(false);
	expect(existsSync(`${dest}.partial`)).toBe(false);
});

test("a server error is a download failure", async () => {
	const dest = join(dir, "missing.gguf");
	await expect(
		downloadVerified({ ...artifact(), url: server.url("/nope") }, dest, opts()),
	).rejects.toMatchObject({ code: "SPEECH_DOWNLOAD_FAILED" });
});

test("an abort propagates without a speech code", async () => {
	const controller = new AbortController();
	controller.abort();
	const dest = join(dir, "model.gguf");
	const error = await downloadVerified(artifact(), dest, {
		signal: controller.signal,
		onProgress: () => {},
	}).catch((err: unknown) => err);
	expect(error).toBeInstanceOf(Error);
	expect(error).not.toBeInstanceOf(CodedError);
});
