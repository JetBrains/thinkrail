import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOCKUP_FILE_CSP, mockupFileHtml, mockupFileUrl, writeMockupFile } from "./mockupFile.ts";

const doc = (html: string) => ({ location: "html", label: "Login <form>", html });
let previousTmp: string | undefined;
let sandbox: string;

beforeAll(() => {
	previousTmp = process.env.TMPDIR;
	sandbox = mkdtempSync(join(tmpdir(), "pi-visualize-test-"));
	process.env.TMPDIR = sandbox;
});

afterAll(() => {
	process.env.TMPDIR = previousTmp;
	rmSync(sandbox, { recursive: true, force: true });
});

describe("mockupFileHtml", () => {
	test("wraps a fragment with the workspace base, a no-script CSP and an escaped title", () => {
		const html = mockupFileHtml(doc("<p>Hi</p>"), "/work/my app");
		expect(html.startsWith("<!doctype html><html><head>")).toBe(true);
		expect(html).toContain('<base href="file:///work/my%20app/">');
		expect(html).toContain(MOCKUP_FILE_CSP);
		expect(MOCKUP_FILE_CSP).toContain("default-src 'none'");
		expect(html).toContain("<title>Login &lt;form&gt;</title>");
		expect(html).toContain("<body><p>Hi</p></body>");
	});

	test("injects into an existing head and keeps the document's own title", () => {
		const html = mockupFileHtml(
			doc("<!doctype html><html><head><title>Own</title></head><body>x</body></html>"),
			"/w",
		);
		expect(html.indexOf("<base")).toBeGreaterThan(html.indexOf("<head>"));
		expect(html.indexOf("<base")).toBeLessThan(html.indexOf("<title>Own"));
		expect(html).not.toContain("Login");
	});

	test("adds a head to a document that has <html> but no <head>", () => {
		const html = mockupFileHtml(doc("<html lang='en'><body>x</body></html>"), "/w");
		expect(html.startsWith("<html lang='en'><head><meta charset")).toBe(true);
	});
});

describe("writeMockupFile", () => {
	test("writes once per content under the tmp dir and returns a file URL-able path", () => {
		const first = writeMockupFile(doc("<p>A</p>"), "/w");
		expect(first.startsWith(join(sandbox, "pi-visualize"))).toBe(true);
		expect(readFileSync(first, "utf8")).toContain("<p>A</p>");
		expect(writeMockupFile(doc("<p>A</p>"), "/w")).toBe(first);
		expect(writeMockupFile(doc("<p>B</p>"), "/w")).not.toBe(first);
		expect(mockupFileUrl(first).startsWith("file://")).toBe(true);
	});
});
