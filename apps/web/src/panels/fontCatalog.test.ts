import { expect, test } from "bun:test";
import type { UserFontsSnapshot } from "@thinkrail/contracts";
import {
	choiceKey,
	customFamilies,
	displayFamily,
	fallbackFontOptions,
	fontOptions,
	isRoleDefault,
	mainFontOptions,
} from "./fontCatalog";

const faces = { interface: "Geist Variable", code: "JetBrains Mono Variable" };

const userFonts: UserFontsSnapshot = {
	dir: "/data/fonts",
	files: [
		{
			fileName: "FiraCode-Regular.ttf",
			ok: true,
			url: "/fonts/FiraCode-Regular.ttf?v=1",
			face: {
				family: "Fira Code",
				style: "normal",
				weight: { min: 400, max: 400 },
				monospace: false,
			},
		},
		{
			fileName: "FiraCode-Bold.ttf",
			ok: true,
			url: "/fonts/FiraCode-Bold.ttf?v=1",
			face: {
				family: "Fira Code",
				style: "normal",
				weight: { min: 700, max: 700 },
				monospace: true,
			},
		},
		{ fileName: "broken.otf", ok: false, error: "invalid-font" },
	],
};

const probes: Record<string, { renders: boolean; monospace: boolean }> = {
	"DejaVu Sans Mono": { renders: true, monospace: true },
	"DejaVu Sans": { renders: true, monospace: false },
	"Noto Color Emoji": { renders: false, monospace: false },
	"Symbols Nerd Font": { renders: false, monospace: false },
};

const options = fontOptions({
	faces,
	custom: customFamilies(userFonts),
	installed: {
		status: "ready",
		families: [
			{ name: "DejaVu Sans Mono", monospaceHint: false },
			{ name: "DejaVu Sans", monospaceHint: false },
			{ name: "Noto Color Emoji", monospaceHint: true },
			{ name: "Fira Code", monospaceHint: true },
			{ name: "Symbols Nerd Font", monospaceHint: true },
		],
	},
	probe: (family) => probes[family] ?? { renders: false, monospace: false },
});

test("bundled, custom and installed fonts merge, a custom family shadowing an installed one", () => {
	expect(options.map((option) => [option.source, option.label])).toEqual([
		["builtin", "Geist"],
		["builtin", "JetBrains Mono"],
		["custom", "Fira Code"],
		["installed", "DejaVu Sans Mono"],
		["installed", "DejaVu Sans"],
		["installed", "Noto Color Emoji"],
		["installed", "Symbols Nerd Font"],
	]);
	expect(options.find((option) => option.label === "Fira Code")?.monospace).toBe(true);
});

test("measurement beats the OS hint for monospace, and the code list is monospace-only", () => {
	const code = mainFontOptions(options, "code", true).map((option) => option.label);
	expect(code).toEqual(["JetBrains Mono", "Fira Code", "DejaVu Sans Mono"]);
	const remote = mainFontOptions(options, "code", false).map((option) => option.label);
	expect(remote).toEqual([
		"JetBrains Mono",
		"Fira Code",
		"DejaVu Sans Mono",
		"Noto Color Emoji",
		"Symbols Nerd Font",
	]);
	expect(mainFontOptions(options, "interface", true)).toHaveLength(5);
});

test("fallback lists offer every font but the ones already in the stack", () => {
	const fallbacks = fallbackFontOptions(options, [
		{ builtin: "code" },
		{ name: "Symbols Nerd Font" },
	]);
	expect(fallbacks.map((option) => option.label)).toEqual([
		"Geist",
		"Fira Code",
		"DejaVu Sans Mono",
		"DejaVu Sans",
		"Noto Color Emoji",
	]);
});

test("custom files group by family, skipping broken files, monospace when any face is", () => {
	expect([...customFamilies(userFonts)]).toEqual([
		["Fira Code", { files: ["FiraCode-Regular.ttf", "FiraCode-Bold.ttf"], monospace: true }],
	]);
	expect(customFamilies(null).size).toBe(0);
});

test("refs resolve to display names, keys and role defaults", () => {
	expect(displayFamily("JetBrains Mono Variable")).toBe("JetBrains Mono");
	expect(choiceKey(null, "code")).toBe("builtin:code");
	expect(isRoleDefault({ builtin: "code" }, "code")).toBe(true);
	expect(isRoleDefault({ builtin: "code" }, "interface")).toBe(false);
});
