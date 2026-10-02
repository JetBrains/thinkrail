import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOB_SIZE_LIMIT, serveBlob, serveWorktreeFile } from "./fileRoutes";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x7f]);

let dataDir: string;
let repo: string;
let head: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	return new TextDecoder().decode(result.stdout).trim();
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-routes-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(join(repo, "docs"), { recursive: true });
	git("init", "-b", "main");
	git("config", "user.email", "t@thinkrail.test");
	git("config", "user.name", "test");
	git("config", "commit.gpgsign", "false");
	writeFileSync(join(repo, "docs", "shot.png"), PNG);
	writeFileSync(join(repo, "notes.md"), "# notes\n");
	writeFileSync(join(repo, "page.html"), "<script>globalThis.pwned = true</script>\n");
	writeFileSync(
		join(repo, "page.xhtml"),
		"<html><script>globalThis.pwned = true</script></html>\n",
	);
	writeFileSync(join(repo, "vector.svg"), "<svg><script>globalThis.pwned = true</script></svg>\n");
	git("add", "-A");
	git("commit", "-m", "init");
	head = git("rev-parse", "HEAD");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "w1",
				branch: "main",
				worktreePath: repo,
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

test("/blob serves a commit's bytes with the shared type, cacheable forever", async () => {
	const response = await serveBlob(`/blob/w1/${head}/docs%2Fshot.png`);
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("image/png");
	expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(response.headers.get("Content-Security-Policy")).toBeNull();
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
});

test("/files and /blob use the same extension fallback as ResourceMeta", async () => {
	const worktree = await serveWorktreeFile("/files/w1/notes.md");
	const blob = await serveBlob(`/blob/w1/${head}/notes.md`);
	for (const response of [worktree, blob]) {
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/markdown");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	}
});

test("active resource types are sandboxed on both raw routes", async () => {
	for (const [path, mime] of [
		["page.html", "text/html"],
		["page.xhtml", "application/xhtml+xml"],
		["vector.svg", "image/svg+xml"],
	] as const) {
		const worktree = await serveWorktreeFile(`/files/w1/${path}`);
		const blob = await serveBlob(`/blob/w1/${head}/${path}`);
		for (const response of [worktree, blob]) {
			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe(mime);
			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(response.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'");
		}
	}
});

test("/blob 404s on malformed locations, absent blobs, and tree paths", async () => {
	expect((await serveBlob("/blob/w1/not-an-oid/notes.md")).status).toBe(404);
	expect((await serveBlob(`/blob/w1/${head.slice(0, 12)}/notes.md`)).status).toBe(404);
	expect((await serveBlob(`/blob/nope/${head}/notes.md`)).status).toBe(404);
	expect((await serveBlob(`/blob/w1/${head}/..%2F..%2Fescaped.txt`)).status).toBe(404);
	expect((await serveBlob(`/blob/w1/${head}/gone.txt`)).status).toBe(404);
	expect((await serveBlob(`/blob/w1/${head}/docs`)).status).toBe(404);
	expect((await serveBlob(`/blob/w1/${head}/`)).status).toBe(404);
	expect((await serveBlob("/blob/w1/")).status).toBe(404);
});

test("/files streams the worktree's current bytes with sniffed headers and never caches them", async () => {
	writeFileSync(join(repo, "notes.md"), "# edited\n");
	const response = await serveWorktreeFile("/files/w1/notes.md");
	expect(response.status).toBe(200);
	expect(response.headers.get("Cache-Control")).toBe("no-store");
	expect(response.headers.get("Content-Type")).toBe("text/markdown");
	expect(response.headers.get("Content-Length")).toBe("9");
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(await response.text()).toBe("# edited\n");

	const missing = await serveWorktreeFile("/files/w1/gone.md");
	expect(missing.status).toBe(404);
	expect(missing.headers.get("Cache-Control")).toBe("no-store");
	expect((await serveWorktreeFile("/files/w1/..%2Fescaped.txt")).status).toBe(404);
	expect((await serveWorktreeFile("/files/w1/docs")).status).toBe(404);
	expect((await serveWorktreeFile("/files/w1")).status).toBe(404);
});

test("/blob refuses objects above the response cap before reading their content", async () => {
	const large = join(repo, "large.bin");
	writeFileSync(large, "");
	truncateSync(large, BLOB_SIZE_LIMIT + 1);
	git("add", "large.bin");
	git("commit", "-m", "large blob");
	const oid = git("rev-parse", "HEAD");

	const response = await serveBlob(`/blob/w1/${oid}/large.bin`);
	expect(response.status).toBe(413);
	expect(await response.text()).toBe("blob too large");
});

test("file routes refuse .git and symlinks escaping the worktree", async () => {
	symlinkSync(dataDir, join(repo, "outside"));
	symlinkSync(join(repo, ".git"), join(repo, "metadata"));

	expect((await serveWorktreeFile("/files/w1/.git%2Fconfig")).status).toBe(404);
	expect((await serveWorktreeFile("/files/w1/metadata%2Fconfig")).status).toBe(404);
	expect((await serveWorktreeFile("/files/w1/outside%2Fworkspaces.json")).status).toBe(404);
	expect((await serveBlob(`/blob/w1/${head}/.git%2Fconfig`)).status).toBe(404);
});

test("/blob streams a multi-megabyte blob through a live server", async () => {
	const big = new Uint8Array(3 * 1024 * 1024);
	for (let index = 0; index < big.byteLength; index++) big[index] = (index * 31 + 7) & 0xff;
	writeFileSync(join(repo, "docs", "big.bin"), big);
	git("add", "-A");
	git("commit", "-m", "big");
	const commit = git("rev-parse", "HEAD");
	const server = Bun.serve({
		port: 0,
		fetch: (request) => serveBlob(new URL(request.url).pathname),
	});
	try {
		const response = await fetch(
			`http://127.0.0.1:${server.port}/blob/w1/${commit}/docs%2Fbig.bin`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
		expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(big);
	} finally {
		server.stop(true);
	}
});
