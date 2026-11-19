import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { SHARED_MODULE_EXPORTS } from "@thinkrail/extension-api/installed";
import { apiMajor, EXTENSION_API_VERSION } from "../src/shared";
import {
	currentSnapshot,
	driftMessage,
	firstDifference,
	lostSince,
	SNAPSHOT_DIR,
	snapshotDeclarations,
	snapshotExports,
	snapshotFile,
} from "./apiSnapshot";

let current = "";

beforeAll(async () => {
	current = await currentSnapshot();
}, 60_000);

describe(`extension API ${EXTENSION_API_VERSION} is frozen`, () => {
	it("matches its committed snapshot exactly", () => {
		const file = snapshotFile(EXTENSION_API_VERSION);
		if (!existsSync(file)) {
			throw new Error(
				`extension API ${EXTENSION_API_VERSION} has no snapshot: write packages/extension-sdk/api/${EXTENSION_API_VERSION}.api.md with \`bun run api:snapshot\` in packages/extension-sdk.`,
			);
		}
		const committed = readFileSync(file, "utf8");
		if (committed !== current)
			throw new Error(driftMessage(EXTENSION_API_VERSION, firstDifference(committed, current)));
	});

	it("keeps every name an earlier minor of the same major promised", () => {
		const major = apiMajor(EXTENSION_API_VERSION);
		const earlier = readdirSync(SNAPSHOT_DIR)
			.map((name) => /^(\d+)\.(\d+)\.api\.md$/.exec(name))
			.filter((match) => match !== null && match[1] === major)
			.map((match) => `${match?.[1]}.${match?.[2]}`)
			.filter((api) => api !== EXTENSION_API_VERSION);
		for (const api of earlier) {
			const lost = lostSince(readFileSync(snapshotFile(api), "utf8"), current);
			if (lost.length > 0) {
				throw new Error(
					`extension API ${EXTENSION_API_VERSION} dropped what ${api} promised — ${lost.join("; ")}: removing a name needs extension API ${Number(major) + 1}.0.`,
				);
			}
		}
	});

	it("records the allow-list as its runtime exports", () => {
		expect(snapshotExports(current)).toEqual(
			JSON.parse(JSON.stringify(SHARED_MODULE_EXPORTS)) as Record<string, string[]>,
		);
	});

	it("declares no built-in-only part of the web contract", () => {
		const web = /### `types\/web\.d\.ts`\n\n```ts\n([\s\S]*?)\n```/.exec(current)?.[1] ?? "";
		expect(web).toContain("export interface WebExtension");
		for (const name of [
			"globalOverlay",
			"GlobalOverlayProps",
			"commands",
			"shortcuts",
			"ExtensionCommand",
			"ExtensionChord",
			"ExtensionShortcut",
			"MessageKey",
			"title?",
			"description?",
			"languageFromPath",
			"parseToolResultContent",
			"toolValueText",
		]) {
			expect(web).not.toContain(name);
		}
	});
});

describe("the snapshot's declared names", () => {
	it("cover every public declaration of each entry", () => {
		const declared = snapshotDeclarations(current);
		expect(declared["types/web.d.ts"]).toEqual(
			expect.arrayContaining(["WebExtension", "ToolRenderProps", "defineWebExtension", "strArg"]),
		);
		expect(declared["types/ui/button.d.ts"]).toEqual(
			expect.arrayContaining(["Button", "ButtonProps", "IconButton", "withIconClass"]),
		);
		expect(declared["server.d.ts"]).toContain("defineServerExtension");
	});
});

describe("comparing with an earlier minor", () => {
	const snapshot = (exports: Record<string, string[]>, web: string) =>
		`## Runtime exports\n\n\`\`\`json\n${JSON.stringify(exports)}\n\`\`\`\n\n### \`types/web.d.ts\`\n\n\`\`\`ts\n${web}\n\`\`\`\n`;

	it("accepts additions", () => {
		const earlier = snapshot({ web: ["a"] }, "export declare function a(): void;");
		const later = snapshot(
			{ web: ["a", "b"] },
			"export declare function a(): void;\nexport interface B {}",
		);
		expect(lostSince(earlier, later)).toEqual([]);
	});

	it("names a dropped runtime export and a dropped declaration", () => {
		const earlier = snapshot(
			{ web: ["a", "b"] },
			"interface C {}\nexport declare function a(): void;\nexport type { C };",
		);
		const later = snapshot({ web: ["a"] }, "export declare function a(): void;");
		expect(lostSince(earlier, later)).toEqual(["web: b", "types/web.d.ts: C"]);
	});
});

describe("the snapshot failure explains the versioning rule", () => {
	it("names the major for a removal and the minor for an addition", () => {
		const message = driftMessage("1.0", "first difference at line 3");
		expect(message).toContain("packages/extension-sdk/api/1.0.api.md");
		expect(message).toContain("make it extension API 2.0");
		expect(message).toContain('set EXTENSION_API_VERSION to "1.1"');
		expect(message).toContain("api/1.1.api.md");
		expect(message).toEndWith("first difference at line 3");
	});

	it("points at the first differing line", () => {
		expect(firstDifference("a\nb\nc", "a\nx\nc")).toBe(
			"first difference at line 2:\n  snapshot: b\n  current:  x",
		);
	});
});
