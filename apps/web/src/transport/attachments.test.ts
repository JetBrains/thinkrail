import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { WsMethodName } from "@thinkrail/contracts";
import type { PromptFile } from "../store";
import { AttachmentUploadError, attachmentFailureText, uploadPromptFiles } from "./attachments";
import { WsTransport } from "./transport";
import * as wireTransport from "./wireTransport";

let restore: (() => void)[] = [];
let copies: { path: string; workspaceId?: string }[] = [];
let puts: string[] = [];
let answer: (url: string) => Promise<Response> = async () => Response.json({ ok: true, path: "x" });

beforeEach(() => {
	copies = [];
	puts = [];
	const transport = new WsTransport({ url: "ws://localhost:24242/ws" });
	const base = spyOn(transport, "httpBase").mockReturnValue("http://host");
	const request = spyOn(transport, "request").mockImplementation(((
		method: WsMethodName,
		params: { path: string; workspaceId?: string },
	) => {
		if (method !== "attachments.copyLocal") throw new Error(`unexpected ${method}`);
		copies.push(params);
		if (params.path.endsWith("offline.pdf")) return Promise.reject(new Error("socket closed"));
		return Promise.resolve({
			ok: true,
			path: `.thinkrail/context/attachments/${params.path.slice(1)}`,
		});
	}) as typeof transport.request);
	const wire = spyOn(wireTransport, "getTransport").mockReturnValue(transport);
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
		input: RequestInfo | URL,
		init?: RequestInit,
	) => {
		const url = String(input);
		puts.push(url);
		init?.signal?.throwIfAborted();
		return answer(url);
	}) as typeof fetch);
	restore = [
		() => base.mockRestore(),
		() => request.mockRestore(),
		() => wire.mockRestore(),
		() => fetchSpy.mockRestore(),
	];
});

afterEach(() => {
	for (const undo of restore) undo();
	answer = async () => Response.json({ ok: true, path: "x" });
});

const blob = (id: string, name: string): PromptFile => ({
	id,
	name,
	size: 1,
	source: { kind: "blob", blob: new Blob(["x"]) },
});
const local = (id: string, path: string): PromptFile => ({
	id,
	name: path.slice(1),
	size: 1,
	source: { kind: "local", path },
});

test("files go to the host in order, each copy reported, and an already-copied file is not sent again", async () => {
	answer = async (url) =>
		Response.json({
			ok: true,
			path: `.thinkrail/context/attachments/${new URL(url).pathname.split("/").pop()}`,
		});
	const copied: [string, string][] = [];
	const paths = await uploadPromptFiles(
		"w1",
		[
			{ ...blob("a", "done.pdf"), copied: ".thinkrail/context/attachments/done.pdf" },
			blob("b", "b.pdf"),
			local("c", "/c.txt"),
		],
		{ onCopied: (id, path) => copied.push([id, path]) },
	);
	expect(paths).toEqual([
		".thinkrail/context/attachments/done.pdf",
		".thinkrail/context/attachments/b.pdf",
		".thinkrail/context/attachments/c.txt",
	]);
	expect(puts).toEqual(["http://host/attachments/b.pdf?workspace=w1"]);
	expect(copies).toEqual([{ path: "/c.txt", workspaceId: "w1" }]);
	expect(copied.map(([id]) => id)).toEqual(["b", "c"]);
});

test("a refusal after a copy keeps the copy reported, so a retry skips it", async () => {
	answer = async (url) =>
		url.includes("big.mov")
			? Response.json({ ok: false, error: "too-large" }, { status: 413 })
			: Response.json({ ok: true, path: "a.pdf" });
	const copied: string[] = [];
	const failure = await uploadPromptFiles("w1", [blob("a", "a.pdf"), blob("b", "big.mov")], {
		onCopied: (id) => copied.push(id),
	}).catch((error: unknown) => error);
	expect(copied).toEqual(["a"]);
	expect(failure).toBeInstanceOf(AttachmentUploadError);
	expect(attachmentFailureText(failure)).toBe("Couldn't copy big.mov — larger than 100 MB");
});

test("a non-JSON answer, an unreachable host and a socket failure name the file in catalog words", async () => {
	answer = async () => new Response("<html>Bad gateway</html>", { status: 502 });
	const badGateway = await uploadPromptFiles(null, [blob("a", "a.pdf")]).catch((e: unknown) => e);
	expect(attachmentFailureText(badGateway)).toBe(
		"Couldn't copy a.pdf — the host answered HTTP 502",
	);
	answer = async () => {
		throw new TypeError("Failed to fetch");
	};
	const offline = await uploadPromptFiles(null, [blob("a", "notes.md")]).catch((e: unknown) => e);
	expect(attachmentFailureText(offline)).toBe("Couldn't copy notes.md — the host can't be reached");
	const socket = await uploadPromptFiles(null, [local("c", "/offline.pdf")]).catch(
		(e: unknown) => e,
	);
	expect(attachmentFailureText(socket)).toMatch(/^Couldn't copy offline\.pdf — /);
});

test("an aborted upload stops before the next file and rejects as an abort", async () => {
	const upload = new AbortController();
	const failure = await uploadPromptFiles("w1", [blob("a", "a.pdf"), blob("b", "b.pdf")], {
		signal: upload.signal,
		onCopied: () => upload.abort(),
	}).catch((error: unknown) => error);
	expect(puts).toHaveLength(1);
	expect(failure).not.toBeInstanceOf(AttachmentUploadError);
	expect(upload.signal.aborted).toBe(true);
});
