import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkWorkspaceFile, MOCKUP_DIR, workspaceFiles } from "./workspaceFiles";

describe("workspace file checks shared by extension server halves", () => {
	test("accepts workspace files and rejects missing, directory, and escaping paths", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "workspace-files-"));
		mkdirSync(join(cwd, MOCKUP_DIR), { recursive: true });
		writeFileSync(join(cwd, MOCKUP_DIR, "after.html"), "<p>after</p>");
		writeFileSync(join(cwd, "before.html"), "<p>before</p>");
		await expect(checkWorkspaceFile(`${MOCKUP_DIR}after.html`, cwd)).resolves.toBeUndefined();
		await expect(checkWorkspaceFile("before.html", cwd)).resolves.toBeUndefined();
		await expect(checkWorkspaceFile("missing.html", cwd)).rejects.toThrow("no such file");
		await expect(checkWorkspaceFile(".thinkrail", cwd)).rejects.toThrow("not a regular file");
		await expect(checkWorkspaceFile("../outside.html", cwd)).rejects.toThrow("inside it");
		await expect(checkWorkspaceFile(join(cwd, "before.html"), cwd)).rejects.toThrow(
			"relative to the workspace",
		);
	});

	test("follows the host's read guard: dot-dot names pass, .git and escaping links do not", async () => {
		const root = mkdtempSync(join(tmpdir(), "workspace-guard-"));
		const cwd = join(root, "workspace");
		const outside = join(root, "outside");
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(outside);
		writeFileSync(join(cwd, "..draft.html"), "<p>draft</p>");
		writeFileSync(join(cwd, ".git", "config"), "[core]");
		writeFileSync(join(outside, "secret.html"), "<p>secret</p>");
		symlinkSync(outside, join(cwd, "linked"), "junction");
		await expect(checkWorkspaceFile("..draft.html", cwd)).resolves.toBeUndefined();
		await expect(checkWorkspaceFile(".git/config", cwd)).rejects.toThrow(
			".git directory is not shown",
		);
		await expect(checkWorkspaceFile("linked/secret.html", cwd)).rejects.toThrow(
			"a link points outside it",
		);
	});

	test("a mockup path cannot link to a file outside the mockup directory", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "workspace-mockup-link-"));
		mkdirSync(join(cwd, MOCKUP_DIR), { recursive: true });
		writeFileSync(join(cwd, "index.html"), "<script>repo()</script>");
		writeFileSync(join(cwd, MOCKUP_DIR, "own.html"), "<p>own</p>");
		symlinkSync(join(cwd, "index.html"), join(cwd, MOCKUP_DIR, "linked.html"));
		symlinkSync(join(cwd, MOCKUP_DIR, "own.html"), join(cwd, MOCKUP_DIR, "alias.html"));
		await expect(checkWorkspaceFile(`${MOCKUP_DIR}linked.html`, cwd)).rejects.toThrow(
			"inside the mockup directory",
		);
		await expect(checkWorkspaceFile(`${MOCKUP_DIR}alias.html`, cwd)).resolves.toBeUndefined();
		await expect(
			checkWorkspaceFile(`${MOCKUP_DIR}../../../index.html`, cwd),
		).resolves.toBeUndefined();
	});

	test("names the gitignored scratch directory for mockups", () => {
		expect(workspaceFiles.scratchDir).toBe(".thinkrail/context/mockups/");
		expect(workspaceFiles.check).toBe(checkWorkspaceFile);
	});
});
