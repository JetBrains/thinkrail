import { afterEach, beforeEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXT_THEME_TOKENS, extThemeTokensErrors } from "@thinkrail/contracts";
import {
	draftFromTokens,
	parseDraft,
	radiusTokens,
	themeSnippet,
	toHex6,
	withColor,
} from "../../../../.thinkrail/extensions/themes/model";
import { createExtHost } from "./index";

const REPO = resolve(import.meta.dir, "../../../..");
const SOURCE = join(REPO, ".thinkrail/extensions/themes");

let base: string;

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "themes-ext-"));
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

const makeHost = () =>
	createExtHost({
		userDir: join(base, "user"),
		storeDir: join(base, "store"),
		sessions: {
			list: () => [],
			get: () => undefined,
			stats: () => {
				throw new Error("no sessions");
			},
		},
	});

const copyToUser = () => {
	const target = join(base, "user", "themes");
	cpSync(SOURCE, target, {
		recursive: true,
		filter: (path) => !path.includes("node_modules"),
	});
	return target;
};

const editManifest = (dir: string, edit: (manifest: Record<string, unknown>) => void) => {
	const path = join(dir, "extension.json");
	const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	edit(manifest);
	writeFileSync(path, JSON.stringify(manifest));
};

test("the example loads three themes and serves the ember stylesheet", async () => {
	const host = makeHost();
	await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
	const info = host.get("themes");
	expect(info).toMatchObject({ status: "active", surfaces: [{ id: "studio", slot: "panel" }] });
	expect(info?.themes.map(({ id, mode, css }) => ({ id, mode, css }))).toEqual([
		{ id: "ember", mode: "light", css: true },
		{ id: "night-contrast", mode: "dark", css: false },
		{ id: "soft", mode: "dark", css: false },
	]);
	expect(info?.themes.find((theme) => theme.id === "soft")?.tokens["--radius-lg"]).toBe("16px");
	expect(JSON.stringify(info)).not.toContain("ember.css");
	const build = info?.build ?? "";
	const css = host.asset("themes", build, "ember.theme.css");
	expect(css?.contentType).toStartWith("text/css");
	expect(css?.body).toContain('[data-theme-overlay="themes/ember"]');
	expect(host.asset("themes", build, "soft.theme.css")).toBeUndefined();
	expect(host.asset("themes", build, "studio.js")?.body).toContain("theme-studio");
	await host.dispose();
});

test("a typo in a token fails validation with a suggestion and keeps the old generation", async () => {
	const dir = copyToUser();
	const host = makeHost();
	await host.rescan();
	const before = host.get("themes");
	expect(before?.status).toBe("active");

	editManifest(dir, (manifest) => {
		const [first] = manifest.themes as { tokens: Record<string, string> }[];
		if (first) first.tokens["--color-backgrund"] = "#ffffff";
	});
	const validation = await host.validate("themes");
	expect(validation.ok).toBe(false);
	if (validation.ok) return;
	expect(validation.errors).toEqual([
		expect.stringContaining(
			'themes[0].tokens["--color-backgrund"] unknown token; did you mean "--background"?',
		),
	]);

	const reloaded = await host.reload("themes");
	expect(reloaded.status).toBe("error");
	expect(reloaded.generation).toBe(before?.generation ?? -1);
	expect(reloaded.themes).toHaveLength(3);
	await host.dispose();
});

test("a theme css path outside the extension or missing is refused", async () => {
	const dir = copyToUser();
	editManifest(dir, (manifest) => {
		const themes = manifest.themes as { css?: string }[];
		if (themes[1]) themes[1].css = "../../escape.css";
		if (themes[2]) themes[2].css = "missing.css";
	});
	const host = makeHost();
	await host.rescan();
	const validation = await host.validate("themes");
	expect(validation.ok ? [] : validation.errors).toEqual([
		'themes[1].css "../../escape.css" must be a relative .css path inside the extension',
	]);
	editManifest(dir, (manifest) => {
		const themes = manifest.themes as { css?: string }[];
		if (themes[1]) delete themes[1].css;
	});
	const missing = await host.validate("themes");
	expect(missing.ok ? [] : missing.errors).toEqual(["themes[2]: css file missing.css is missing"]);
	await host.dispose();
});

test("the studio draft is validated, stored, and published", async () => {
	copyToUser();
	const host = makeHost();
	await host.rescan();
	const draft = { title: "Dusk", mode: "dark", colors: { "--accent": "#FF8800" }, radius: 99 };
	expect(await host.invokeAction({ ext: "themes", id: "saveDraft", payload: draft })).toEqual({
		ok: true,
	});
	expect(host.snapshot(["themes:draft"])["themes:draft"]).toEqual({
		title: "Dusk",
		mode: "dark",
		colors: { "--accent": "#ff8800" },
		radius: 16,
	});
	expect(await host.invokeAction({ ext: "themes", id: "saveDraft", payload: { mode: 1 } })).toEqual(
		{ ok: false, error: "Not a theme draft." },
	);
	await host.dispose();

	const next = makeHost();
	await next.rescan();
	expect(next.snapshot(["themes:draft"])["themes:draft"]).toMatchObject({ title: "Dusk" });
	await next.dispose();
});

test("the studio exports a snippet the manifest validator accepts", () => {
	expect(toHex6("#ABC")).toBe("#aabbcc");
	expect(toHex6(" #11223380 ")).toBe("#112233");
	expect(toHex6("rgb(1, 2, 3)")).toBeUndefined();
	expect(radiusTokens(40)).toEqual({
		"--radius-xs": "8px",
		"--radius-sm": "16px",
		"--radius-md": "24px",
		"--radius-lg": "32px",
	});
	const draft = draftFromTokens({
		title: "9 Lives!",
		mode: "light",
		tokens: {
			"--background": "#FFF",
			"--selection": "#b4461a33",
			"--radius-sm": "6px",
			"--x": "1",
		},
	});
	const snippet = JSON.parse(themeSnippet(draft)) as {
		id: string;
		mode: string;
		tokens: Record<string, string>;
	};
	expect(snippet.id).toBe("t-9-lives");
	expect(snippet.mode).toBe("light");
	expect(snippet.tokens["--background"]).toBe("#fff");
	expect(snippet.tokens["--selection"]).toBe("#b4461a33");
	expect(snippet.tokens["--x"]).toBeUndefined();
	expect(extThemeTokensErrors(snippet.tokens)).toEqual([]);
	expect(
		Object.keys(snippet.tokens).every((token) => EXT_THEME_TOKENS.some((t) => t === token)),
	).toBe(true);
	expect(parseDraft({ ...draft, colors: { "--nope": "#fff", "--text": "red" } })?.colors).toEqual(
		{},
	);
});

test("editing the accent moves its whole family", () => {
	const draft = { title: "x", mode: "light" as const, colors: {}, radius: 4 };
	expect(withColor(draft, "--accent", "#0F766E").colors).toEqual({
		"--accent": "#0f766e",
		"--accent-solid": "#0f766e",
		"--bubble-accent": "#0f766e",
		"--accent-hover": "#0d655f",
		"--selection": "#0f766e33",
		"--editor-selection": "#0f766e33",
	});
	expect(
		withColor({ ...draft, mode: "dark" }, "--accent", "#000000").colors["--accent-hover"],
	).toBe("#242424");
	expect(withColor(draft, "--text", "nope")).toBe(draft);
});
