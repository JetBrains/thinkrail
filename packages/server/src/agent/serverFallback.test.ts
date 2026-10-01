import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withServerFallbackOptOut, writeServerFallbackOptOut } from "./serverFallback";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "trpi-server-fallback-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

test("merges the opt-out into an existing provider without touching its other fields", () => {
	const text = JSON.stringify(
		{
			providers: {
				anthropic: {
					baseUrl: "http://proxy",
					apiKey: "secret",
					compat: { supportsEagerToolInputStreaming: false },
				},
				openai: { baseUrl: "http://other" },
			},
			other: true,
		},
		null,
		"\t",
	);

	expect(JSON.parse(withServerFallbackOptOut(text, "anthropic"))).toEqual({
		providers: {
			anthropic: {
				baseUrl: "http://proxy",
				apiKey: "secret",
				compat: { supportsEagerToolInputStreaming: false, allowedFallbackModels: [] },
			},
			openai: { baseUrl: "http://other" },
		},
		other: true,
	});
	expect(withServerFallbackOptOut(text, "anthropic")).toContain('\n\t"providers"');
});

test("creates the provider entry, and the file content, when absent", () => {
	expect(JSON.parse(withServerFallbackOptOut(undefined, "anthropic"))).toEqual({
		providers: { anthropic: { compat: { allowedFallbackModels: [] } } },
	});
});

test("is idempotent", () => {
	const once = withServerFallbackOptOut(undefined, "anthropic");
	expect(withServerFallbackOptOut(once, "anthropic")).toBe(once);
});

test("refuses a file that is not a JSON object instead of overwriting it", async () => {
	const path = join(dir, "models.json");
	writeFileSync(path, "{ not json");
	await expect(writeServerFallbackOptOut(path, "anthropic")).rejects.toThrow("Fix the file");
	expect(readFileSync(path, "utf8")).toBe("{ not json");

	writeFileSync(path, "[]");
	await expect(writeServerFallbackOptOut(path, "anthropic")).rejects.toThrow("not a JSON object");
	expect(readFileSync(path, "utf8")).toBe("[]");
});

test("writes atomically and keeps the file's mode", async () => {
	const path = join(dir, "models.json");
	writeFileSync(path, JSON.stringify({ providers: { anthropic: { apiKey: "k" } } }), {
		mode: 0o600,
	});

	await writeServerFallbackOptOut(path, "anthropic");

	expect(statSync(path).mode & 0o777).toBe(0o600);
	expect(JSON.parse(readFileSync(path, "utf8")).providers.anthropic).toEqual({
		apiKey: "k",
		compat: { allowedFallbackModels: [] },
	});
});
