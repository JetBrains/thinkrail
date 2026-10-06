import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { designSourceFiles, designSourceLabel } from "./designSources";

test("token adoption scans app, shared UI, and every extension web half only", () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-design-sources-"));
	const included = [
		"apps/web/src/index.css",
		"apps/web/src/chat/Markdown.tsx",
		"packages/ui/dialog.tsx",
		"packages/ui/menu-styles.ts",
		"thinkrail-extensions/visualize/web/MermaidView.tsx",
		"thinkrail-extensions/future/web/nested/view.tsx",
	];
	const excluded = [
		"apps/web/src/styles/generated/colors.css",
		"apps/web/src/styles/colors.test.ts",
		"packages/ui/tooltip.test.tsx",
		"packages/ui/node_modules/example/index.ts",
		"packages/ui/dist/index.ts",
		"thinkrail-extensions/future/server/index.ts",
		"thinkrail-extensions/future/web/args.test.ts",
		"pi-extensions/visualize/index.ts",
	];
	try {
		for (const path of [...included, ...excluded]) {
			const file = join(root, path);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, "");
		}
		expect(
			designSourceFiles(root).map((path) => relative(root, path).replaceAll("\\", "/")),
		).toEqual(included.sort());
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Tailwind scans the same external roots as the adoption guards", () => {
	const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
	expect(css).toContain('@source "../../../packages/ui";');
	expect(css).toContain('@source "../../../thinkrail-extensions/*/web/**/*.{ts,tsx}";');
	const labels = designSourceFiles().map(designSourceLabel);
	expect(labels).toContain("index.css");
	expect(labels).toContain("packages/ui/dialog.tsx");
});
