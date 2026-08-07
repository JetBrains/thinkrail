import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GeneratedFile, isStale } from "./generatedFiles";

const committed = (content: string): GeneratedFile => {
	const path = join(mkdtempSync(join(tmpdir(), "thinkrail-generated-")), "generated.css");
	writeFileSync(path, content);
	return { path, content };
};

const CSS = ":root {\n\t--font-size-body: 14px;\n}\n";

describe("isStale", () => {
	it("is false when the committed copy matches what the generator renders", () => {
		expect(isStale(committed(CSS))).toBe(false);
	});

	// Regression pin: a CRLF checkout made every file read as stale, and the Windows nightly never
	// got past `typography:check`.
	it("treats CRLF line endings in the working tree as identical content", () => {
		const { path } = committed(CSS.replaceAll("\n", "\r\n"));
		expect(isStale({ path, content: CSS })).toBe(false);
	});

	it("is true when the content genuinely differs", () => {
		const { path } = committed(CSS);
		expect(isStale({ path, content: CSS.replace("14px", "15px") })).toBe(true);
	});

	it("is true when the file has never been generated", () => {
		const { path } = committed(CSS);
		expect(isStale({ path: `${path}.missing`, content: CSS })).toBe(true);
	});
});
