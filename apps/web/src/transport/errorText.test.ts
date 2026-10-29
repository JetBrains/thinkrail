import { afterEach, expect, test } from "bun:test";
import type { WsErrorCode, WsErrorParams } from "@thinkrail/contracts";
import { BUNDLED_LOCALES, bundledCatalog, EN } from "@thinkrail/locales";
import { applyLocale } from "@thinkrail/locales/react";
import { errorText } from "./errorText";
import { RequestError, wsErrorCode } from "./requestError";

afterEach(() => applyLocale("en", {}));

test.each([
	["en", "Not a git repository: /tmp/repo"],
	["zh-CN", "不是 Git 仓库：/tmp/repo"],
])("formats a host error in %s without changing its message or classifier", (locale, expected) => {
	applyLocale(locale, {});
	const error = new RequestError("NOT_GIT", "original host message", { path: "/tmp/repo" });
	expect(errorText(error)).toBe(expected);
	expect(error.message).toBe("original host message");
	expect(wsErrorCode(error)).toBe("NOT_GIT");
});

test("every error catalog entry is reachable through the code mapping", () => {
	for (const [key, template] of Object.entries(EN)) {
		if (!key.startsWith("errors.")) continue;
		const params = Object.fromEntries(
			[...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => [match[1], "literal"]),
		);
		const error = new RequestError(key.slice("errors.".length) as WsErrorCode, "unmapped", params);
		expect(errorText(error)).toBe(template.replace(/\{\{\w+\}\}/g, "literal"));
	}
});

test("all bundled languages cover every host error with the same placeholders", () => {
	const keys = Object.keys(EN).filter((key) => key.startsWith("errors."));
	expect(keys.length).toBeGreaterThan(50);
	for (const locale of BUNDLED_LOCALES) {
		const catalog = bundledCatalog(locale);
		for (const key of keys) expect(catalog?.[key]).toBeDefined();
	}
});

test("uses the current language and local overrides each time it presents an error", () => {
	const error = new RequestError("NOT_GIT", "English host message", { path: "/tmp/repo" });
	applyLocale("de", { de: { "errors.NOT_GIT": "Kein Git-Repository: {{path}}" } });
	expect(errorText(error)).toBe("Kein Git-Repository: /tmp/repo");
	applyLocale("de", { de: { "errors.NOT_GIT": "Repository fehlt: {{path}}" } });
	expect(errorText(error)).toBe("Repository fehlt: /tmp/repo");
	applyLocale("de", {});
	expect(errorText(error)).toBe("Not a git repository: /tmp/repo");
});

test("unknown, external and legacy broad errors preserve their original diagnostics", () => {
	applyLocale("zh-CN", {});
	for (const code of [
		"FUTURE_HOST_ERROR",
		"PUSH_AUTH_FAILED",
		"PROJECT_CLONE_FAILED",
		"PROJECT_CLONE_INVALID",
		"MCP_CONFIG_INVALID",
		"RANGE_INVALID",
	]) {
		expect(errorText(new RequestError(code as WsErrorCode, "raw diagnostic"))).toBe(
			"raw diagnostic",
		);
	}
	expect(errorText(new Error("external error"))).toBe("external error");
	expect(errorText("raw rejection")).toBe("raw rejection");
	expect(errorText(null, "fallback")).toBe("fallback");
	expect(errorText(new Error(""), "fallback")).toBe("fallback");
});

test.each([
	undefined,
	null,
	[[]],
	"bad",
	{},
	{ path: null },
	{ path: {} },
	{ path: true },
	{ path: Number.NaN },
	{ path: Infinity },
	Object.create({ path: "inherited" }),
])("missing or malformed parameters fall back without unresolved placeholders (%j)", (params) => {
	const error = new RequestError(
		"NOT_GIT",
		"legacy host message",
		params as WsErrorParams | undefined,
	);
	expect(errorText(error)).toBe("legacy host message");
});

test("only required scalar parameters are interpolated, never treated as i18next options", () => {
	const path = '<script>{{name}} $t(settings.nav.language) & "folder"</script>';
	applyLocale("de", { de: { "errors.NOT_GIT": "Fehler: {{path}}" } });
	const error = new RequestError("NOT_GIT", "host", {
		path,
		lng: "en",
		context: "other",
		defaultValue: "injected",
		count: 4,
	});
	expect(errorText(error)).toBe(`Fehler: ${path}`);
});

test("numeric parameters interpolate and parameterless legacy codes still localize", () => {
	const error = new RequestError("RANGE_ORIGINAL_OUT_OF_BOUNDS", "host", {
		path: "file.ts",
		start: 5,
		span: 2,
		lineCount: 3,
	});
	expect(errorText(error)).toBe("Lines 5+2 lie outside the original side of file.ts (3 line(s)).");
	applyLocale("de", { de: { "errors.STALE_VIEW": "Die Datei wurde geändert." } });
	expect(errorText(new RequestError("STALE_VIEW", "old host wording"))).toBe(
		"Die Datei wurde geändert.",
	);
});
