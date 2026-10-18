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
	if (previousTmp === undefined) delete process.env.TMPDIR;
	else process.env.TMPDIR = previousTmp;
	rmSync(sandbox, { recursive: true, force: true });
});

describe("mockupFileHtml", () => {
	test("prefixes the workspace base, a no-script CSP and an escaped title before the user markup", () => {
		const html = mockupFileHtml(doc("<p>Hi</p>"), "/work/my app");
		expect(html.startsWith("<!doctype html><html><head><meta charset")).toBe(true);
		expect(html).toContain('<base href="file:///work/my%20app/">');
		expect(html).toContain(MOCKUP_FILE_CSP);
		expect(MOCKUP_FILE_CSP).toContain("default-src 'none'");
		expect(html).toContain("<title>Login &lt;form&gt;</title></head><p>Hi</p>");
	});

	test("a full user document follows the prelude unchanged, for the browser to merge", () => {
		const source =
			"<!doctype html><html lang='en'><head><style>p{}</style></head><body>x</body></html>";
		expect(mockupFileHtml(doc(source), "/w").endsWith(source)).toBe(true);
	});
});

describe("mockupFileHtml policy ordering", () => {
	const firstUserMarkup = (html: string, marker: string) => html.indexOf(marker);
	test("the CSP precedes active content placed before <head>, and before every user tag", () => {
		for (const source of [
			"<script>fetch('https://x.invalid')</script><head><title>T</title></head><body>x</body>",
			'<html><body onload="go()"><head></head>x</body></html>',
			"<!--c--><svg onload=go()></svg><head></head>",
			"<p>plain fragment</p>",
		]) {
			const html = mockupFileHtml(doc(source), "/w");
			const csp = html.indexOf("Content-Security-Policy");
			expect(csp).toBeGreaterThan(-1);
			expect(csp).toBeLessThan(firstUserMarkup(html, source.slice(0, 8)));
			expect(html.indexOf("<base")).toBeLessThan(firstUserMarkup(html, source.slice(0, 8)));
		}
	});

	test("user meta refreshes and other http-equiv tags are dropped", () => {
		const html = mockupFileHtml(
			doc('<meta http-equiv="refresh" content="0;url=https://x.invalid"><p>x</p>'),
			"/w",
		);
		expect(html).not.toContain("refresh");
		expect(html.match(/http-equiv/gi)).toHaveLength(1);
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
