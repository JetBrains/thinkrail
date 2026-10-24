import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBlobAt, readBlobSizeAtAsync } from "./git";

let repo: string;

function git(...args: string[]): void {
	execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
}

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "trpi-git-object-name-"));
	git("init", "-b", "main");
	git("config", "user.email", "t@thinkrail.test");
	git("config", "user.name", "test");
	git("config", "commit.gpgsign", "false");
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

function commit(path: string[], content: string): void {
	mkdirSync(join(repo, ...path.slice(0, -1)), { recursive: true });
	writeFileSync(join(repo, ...path), content);
	git("add", "-A");
	git("commit", "-m", "add");
}

test.skipIf(process.platform !== "win32")(
	"on Windows a blob path written with backslashes names the same git object",
	async () => {
		commit(["src", "a.ts"], "export const a = 1;\n");
		expect(readBlobAt(repo, "HEAD", "src\\a.ts")).toBe("export const a = 1;\n");
		expect(await readBlobSizeAtAsync(repo, "HEAD", "src\\a.ts")).toBe(20);
	},
);

test.skipIf(process.platform === "win32")(
	"on POSIX a backslash stays part of the file name",
	async () => {
		commit(["a\\b.ts"], "literal\n");
		expect(readBlobAt(repo, "HEAD", "a\\b.ts")).toBe("literal\n");
		expect(await readBlobSizeAtAsync(repo, "HEAD", "a\\b.ts")).toBe(8);
	},
);
