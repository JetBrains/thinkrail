import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXT_RUNTIME_GLOBAL } from "@thinkrail/contracts";
import { buildSurface, createExtHost } from "./index";

const VIEW = `
import { useState } from "react";
import { useChannel } from "@thinkrail/ext/view";
import dot from "./dot.svg";

export default function Main() {
	const [count] = useState(2);
	const label = useChannel<string>("demo:label");
	return (
		<div className="flex p-4 text-text-muted bg-[var(--probe)]">
			<img src={dot} alt="" />
			{label}:{count}
		</div>
	);
}
`;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

let base: string;
let bundles: string;

const writeExtension = (root: string, view = VIEW) => {
	const dir = join(root, "demo");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "extension.json"),
		JSON.stringify({ name: "demo", surfaces: [{ id: "main", slot: "panel" }] }),
	);
	writeFileSync(
		join(dir, "index.ts"),
		'import { defineExtension } from "@thinkrail/ext";\nexport default defineExtension(() => {});\n',
	);
	writeFileSync(join(dir, "main.tsx"), view);
	writeFileSync(join(dir, "dot.svg"), SVG);
	return dir;
};

beforeAll(() => {
	base = mkdtempSync(join(tmpdir(), "trpi-ext-build-"));
	bundles = mkdtempSync(join(tmpdir(), "trpi-ext-bundle-"));
});

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
	rmSync(bundles, { recursive: true, force: true });
	Reflect.deleteProperty(globalThis, EXT_RUNTIME_GLOBAL);
});

describe("buildSurface", () => {
	test("bundles one self-contained file whose runtime imports read the global", async () => {
		const dir = writeExtension(join(base, "shim"));
		const { js } = await buildSurface({ dir, surfaceId: "main" });

		expect(js).not.toMatch(/^\s*import\s/m);
		expect(js).toContain(`globalThis["${EXT_RUNTIME_GLOBAL}"]?.["react"]`);
		expect(js).toContain("data:image/svg+xml");
		expect(js).toContain("sourceMappingURL=data:");

		const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
		Reflect.set(globalThis, EXT_RUNTIME_GLOBAL, {
			react: { useState: (value: unknown) => [value, () => {}] },
			"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
			"@thinkrail/ext/view": { useChannel: (key: string) => `value of ${key}` },
		});
		const file = join(bundles, "main.mjs");
		writeFileSync(file, js);
		const loaded: { default: () => { props: { children: unknown[] } } } = await import(file);
		expect(loaded.default().props.children).toContain("value of demo:label");
		expect(loaded.default().props.children).toContain(2);
	});

	test("compiles extension classes against the app theme without preflight", async () => {
		const dir = writeExtension(join(base, "css"));
		const { css } = await buildSurface({ dir, surfaceId: "main" });

		expect(css).toContain(".flex");
		expect(css).toContain(".p-4");
		expect(css).toContain("padding: calc(1px * 4)");
		expect(css).toContain(".text-text-muted");
		expect(css).toContain("color: var(--text-muted)");
		expect(css).toContain("var(--probe)");
		expect(css).not.toContain("box-sizing: border-box");
	});

	test("a build error names the file and position", async () => {
		const dir = writeExtension(
			join(base, "broken"),
			'import x from "nope-missing";\nexport default x;\n',
		);
		await expect(buildSurface({ dir, surfaceId: "main" })).rejects.toThrow(
			/main\.tsx:1:\d+: .*nope-missing/,
		);
	});
});

describe("ext host assets", () => {
	const hostFor = (userDir: string) =>
		createExtHost({
			userDir,
			storeDir: join(userDir, "..", "store"),
			sessions: {
				list: () => [],
				get: () => undefined,
				stats: (sessionId) => ({
					sessionId,
					totalMessages: 0,
					tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					cost: 0,
				}),
			},
		});

	test("the build id is a content hash that survives restarts and changes with the code", async () => {
		const userDir = join(base, "hosts", "user");
		writeExtension(userDir);
		const first = hostFor(userDir);
		const second = hostFor(userDir);
		try {
			await first.rescan();
			await second.rescan();
			const build = first.get("demo")?.build;
			expect(build).toMatch(/^[0-9a-f]{16}$/);
			expect(second.get("demo")?.build).toBe(build ?? "");
			expect(first.asset("demo", build ?? "", "main.js")?.contentType).toContain("javascript");
			expect(first.asset("demo", build ?? "", "main.css")?.body).toContain(".flex");
			expect(first.asset("demo", build ?? "", "other.js")).toBeUndefined();

			writeExtension(userDir, VIEW.replace("p-4", "p-8"));
			const reloaded = await first.reload("demo");
			expect(reloaded.build).not.toBe(build ?? "");
			expect(first.asset("demo", build ?? "", "main.js")).toBeUndefined();
		} finally {
			await first.dispose();
			await second.dispose();
		}
	});

	test("a failed view build keeps the old generation and its assets", async () => {
		const userDir = join(base, "failing", "user");
		writeExtension(userDir);
		const host = hostFor(userDir);
		try {
			await host.rescan();
			const before = host.get("demo");
			writeExtension(userDir, 'import "nope-missing";\n');
			const after = await host.reload("demo");
			expect(after.status).toBe("error");
			expect(after.error).toContain("nope-missing");
			expect(after.generation).toBe(before?.generation ?? -1);
			expect(after.build).toBe(before?.build ?? "");
		} finally {
			await host.dispose();
		}
	});
});
