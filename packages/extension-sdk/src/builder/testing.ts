import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const ASSETS = new URL("../../assets/", import.meta.url);

export interface Fixture {
	root: string;
	write(path: string, content: string): void;
	dispose(): void;
}

export function fixture(packageJson: Record<string, unknown>, files: Record<string, string> = {}) {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-extension-sdk-"));
	const write = (path: string, content: string) => {
		const target = join(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	};
	write("package.json", JSON.stringify(packageJson, null, 2));
	for (const [path, content] of Object.entries(files)) write(path, content);
	return { root, write, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

export const WEB_PACKAGE = {
	name: "thinkrail-ext-fixture",
	version: "1.0.0",
	keywords: ["thinkrail-extension"],
	thinkrail: { api: "1.0", web: "./dist/web.js", styles: "./dist/web.css" },
};
