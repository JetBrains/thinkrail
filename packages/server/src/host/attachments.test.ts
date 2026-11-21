import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CHAT_ATTACHMENT_MAX_BYTES,
	CHAT_ATTACHMENT_UPLOAD_HEADER,
	CHAT_ATTACHMENTS_ROUTE,
} from "@thinkrail/contracts";
import {
	ATTACHMENTS_DIR,
	attachmentCandidate,
	attachmentFileName,
	copyLocalAttachment,
	saveAttachment,
	serveChatAttachments,
} from "./attachments";

let dataDir: string;
let worktree: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-attachments-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	worktree = join(dataDir, "repo");
	mkdirSync(worktree, { recursive: true });
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "w1",
				branch: "main",
				worktreePath: worktree,
				baseBranch: "main",
				createdAt: 1,
			},
		]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function upload(name: string, body: BodyInit, query = "?workspace=w1", headers = {}) {
	return serveChatAttachments(
		new Request(`http://host${CHAT_ATTACHMENTS_ROUTE}${encodeURIComponent(name)}${query}`, {
			method: "PUT",
			headers: {
				[CHAT_ATTACHMENT_UPLOAD_HEADER.name]: CHAT_ATTACHMENT_UPLOAD_HEADER.value,
				...headers,
			},
			body,
		}),
		new URL(`http://host${CHAT_ATTACHMENTS_ROUTE}${encodeURIComponent(name)}${query}`),
	);
}

const attachments = () => join(worktree, ATTACHMENTS_DIR);

test("names stay flat, portable and suffixed on collision", () => {
	expect(attachmentFileName("design.pdf")).toBe("design.pdf");
	expect(attachmentFileName("../../etc/passwd")).toBe("passwd");
	expect(attachmentFileName("C:\\Users\\me\\a:b?.txt")).toBe("a_b_.txt");
	expect(attachmentFileName("..")).toBeNull();
	expect(attachmentFileName("  ")).toBeNull();
	expect(attachmentFileName("bad\u0007name")).toBeNull();
	expect(attachmentFileName(`${"x".repeat(300)}.pdf`)).toBe(`${"x".repeat(246)}.pdf`);
	expect(attachmentCandidate("design.pdf", 0)).toBe("design.pdf");
	expect(attachmentCandidate("design.pdf", 1)).toBe("design-2.pdf");
	expect(attachmentCandidate("archive.tar.gz", 2)).toBe("archive.tar-3.gz");
	expect(attachmentCandidate(".env", 1)).toBe(".env-2");
	expect(attachmentCandidate("Makefile", 1)).toBe("Makefile-2");
});

test("long names are cut by UTF-8 bytes at a code point, leaving room for the largest suffix", () => {
	const cjk = attachmentFileName(`${"界".repeat(300)}.pdf`) ?? "";
	expect(cjk.endsWith(".pdf")).toBe(true);
	expect(Buffer.byteLength(cjk)).toBeLessThanOrEqual(250);
	expect(Buffer.byteLength(cjk)).toBeGreaterThan(245);
	expect(cjk).toMatch(/^界+\.pdf$/u);
	expect(Buffer.byteLength(attachmentCandidate(cjk, 999))).toBeLessThanOrEqual(255);
	const emoji = attachmentFileName(`${"😀".repeat(100)}.png`) ?? "";
	expect(emoji).toMatch(/^(?:😀)+\.png$/u);
	expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(250);
	expect(attachmentFileName(`a.${"e".repeat(300)}`)).toBe(`a.${"e".repeat(31)}`);
});

test("a long non-Latin name is written, not refused by the file system", async () => {
	const name = `${"界".repeat(150)}.pdf`;
	const result = await saveAttachment("w1", name, new Response("pdf").body);
	expect(result.ok).toBe(true);
	const [written] = readdirSync(attachments());
	expect(written?.endsWith(".pdf")).toBe(true);
	expect(readFileSync(join(attachments(), written ?? ""), "utf8")).toBe("pdf");
});

test("an upload lands in the worktree's attachments folder and answers its relative path", async () => {
	const response = await upload("design.pdf", "%PDF-1.7");
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true, path: `${ATTACHMENTS_DIR}/design.pdf` });
	expect(readFileSync(join(attachments(), "design.pdf"), "utf8")).toBe("%PDF-1.7");
	expect(readFileSync(join(worktree, ".thinkrail/context/.gitignore"), "utf8")).toBe("*\n");
});

test("a repeated name gets the next free suffix and never overwrites", async () => {
	await upload("design.pdf", "one");
	const second = await upload("design.pdf", "two");
	const third = await upload("design.pdf", "three");
	expect(await second.json()).toEqual({ ok: true, path: `${ATTACHMENTS_DIR}/design-2.pdf` });
	expect(await third.json()).toEqual({ ok: true, path: `${ATTACHMENTS_DIR}/design-3.pdf` });
	expect(readFileSync(join(attachments(), "design.pdf"), "utf8")).toBe("one");
	expect(readFileSync(join(attachments(), "design-2.pdf"), "utf8")).toBe("two");
});

test("a traversal name is flattened into the folder", async () => {
	const response = await upload("../../outside.txt", "x");
	expect(await response.json()).toEqual({ ok: true, path: `${ATTACHMENTS_DIR}/outside.txt` });
	expect(existsSync(join(worktree, "outside.txt"))).toBe(false);
	expect(existsSync(join(dataDir, "outside.txt"))).toBe(false);
});

test("a symlinked .thinkrail or attachments folder is refused, nothing written outside", async () => {
	const outside = join(dataDir, "outside");
	mkdirSync(outside);
	symlinkSync(outside, join(worktree, ".thinkrail"));
	const response = await upload("a.txt", "x");
	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({ ok: false, error: "unwritable" });
	expect(readdirSync(outside)).toEqual([]);

	rmSync(join(worktree, ".thinkrail"));
	mkdirSync(join(worktree, ".thinkrail/context"), { recursive: true });
	symlinkSync(outside, attachments());
	expect(await (await upload("a.txt", "x")).json()).toEqual({ ok: false, error: "unwritable" });
	expect(readdirSync(outside)).toEqual([]);
});

test("a symlink already holding the name is skipped, not followed", async () => {
	const outside = join(dataDir, "secret.txt");
	writeFileSync(outside, "keep");
	mkdirSync(attachments(), { recursive: true });
	symlinkSync(outside, join(attachments(), "a.txt"));
	expect(await (await upload("a.txt", "new")).json()).toEqual({
		ok: true,
		path: `${ATTACHMENTS_DIR}/a-2.txt`,
	});
	expect(readFileSync(outside, "utf8")).toBe("keep");
});

test("over the size limit is refused before reading and while streaming", async () => {
	const declared = await upload("big.bin", "x", "?workspace=w1", {
		"Content-Length": String(CHAT_ATTACHMENT_MAX_BYTES + 1),
	});
	expect(declared.status).toBe(413);
	expect(await declared.json()).toEqual({ ok: false, error: "too-large" });

	const chunk = new Uint8Array(4 * 1024 * 1024);
	async function* stream() {
		for (let sent = 0; sent <= CHAT_ATTACHMENT_MAX_BYTES; sent += chunk.byteLength) yield chunk;
	}
	expect(await saveAttachment("w1", "big.bin", stream())).toEqual({
		ok: false,
		error: "too-large",
	});
	expect(readdirSync(attachments())).toEqual([]);
});

test("without a workspace the file goes under the data dir with its absolute path", async () => {
	const response = await upload("notes.txt", "hi", "");
	const expected = join(dataDir, "attachments", "notes.txt");
	expect(await response.json()).toEqual({ ok: true, path: expected });
	expect(readFileSync(expected, "utf8")).toBe("hi");
});

test("an unknown workspace, a missing guard header and other methods are refused", async () => {
	const unknown = await upload("a.txt", "x", "?workspace=nope");
	expect(unknown.status).toBe(404);
	expect(await unknown.json()).toEqual({ ok: false, error: "unknown-workspace" });
	const unguarded = await serveChatAttachments(
		new Request(`http://host${CHAT_ATTACHMENTS_ROUTE}a.txt`, { method: "PUT", body: "x" }),
		new URL(`http://host${CHAT_ATTACHMENTS_ROUTE}a.txt`),
	);
	expect(unguarded.status).toBe(403);
	const get = await serveChatAttachments(
		new Request(`http://host${CHAT_ATTACHMENTS_ROUTE}a.txt`),
		new URL(`http://host${CHAT_ATTACHMENTS_ROUTE}a.txt`),
	);
	expect(get.status).toBe(405);
	expect((await upload("..", "x")).status).toBe(400);
});

test("copyLocal copies a regular local file and refuses everything else", async () => {
	const source = join(dataDir, "From Files.pdf");
	writeFileSync(source, "%PDF");
	expect(await copyLocalAttachment("w1", source)).toEqual({
		ok: true,
		path: `${ATTACHMENTS_DIR}/From Files.pdf`,
	});
	expect(readFileSync(join(attachments(), "From Files.pdf"), "utf8")).toBe("%PDF");
	expect(await copyLocalAttachment("w1", source)).toEqual({
		ok: true,
		path: `${ATTACHMENTS_DIR}/From Files-2.pdf`,
	});
	expect(await copyLocalAttachment(undefined, source)).toEqual({
		ok: true,
		path: join(dataDir, "attachments", "From Files.pdf"),
	});

	expect(await copyLocalAttachment("w1", "From Files.pdf")).toEqual({
		ok: false,
		error: "not-a-file",
	});
	expect(await copyLocalAttachment("w1", worktree)).toEqual({ ok: false, error: "not-a-file" });
	expect(await copyLocalAttachment("w1", join(dataDir, "missing.pdf"))).toEqual({
		ok: false,
		error: "not-a-file",
	});
	const sparse = join(dataDir, "huge.bin");
	writeFileSync(sparse, "");
	truncateSync(sparse, CHAT_ATTACHMENT_MAX_BYTES + 1);
	expect(await copyLocalAttachment("w1", sparse)).toEqual({ ok: false, error: "too-large" });
	expect(await copyLocalAttachment("nope", source)).toEqual({
		ok: false,
		error: "unknown-workspace",
	});
});

test("copyLocal refuses a FIFO without blocking on it", async () => {
	if (process.platform === "win32") return;
	const fifo = join(dataDir, "pipe");
	expect(Bun.spawnSync(["mkfifo", fifo]).success).toBe(true);
	expect(await copyLocalAttachment("w1", fifo)).toEqual({ ok: false, error: "not-a-file" });
});
