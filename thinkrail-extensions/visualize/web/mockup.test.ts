import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DOMParser as LinkedomParser } from "linkedom";
import {
	applyAssetUrls,
	buildMockupDocumentWithAssets,
	clampMockupHeight,
	collectAssetRefs,
	isWorkspaceAssetRef,
	MAX_MOCKUP_HEIGHT,
	MIN_MOCKUP_HEIGHT,
	mockupScale,
	normalizeAssetPath,
	parseMockupDocuments,
	parseViewport,
	resolveAssetUrls,
} from "./mockup";

const previous = Reflect.get(globalThis, "DOMParser");
beforeAll(() => Reflect.set(globalThis, "DOMParser", LinkedomParser));
afterAll(() => Reflect.set(globalThis, "DOMParser", previous));

const parse = (html: string) =>
	new LinkedomParser().parseFromString(html, "text/html") as unknown as Document;

describe("parseMockupDocuments / parseViewport", () => {
	test("a single html wins; a full pair becomes Before then After; anything else is empty", () => {
		expect(parseMockupDocuments({ html: "<p>x</p>", before: "<p>a</p>" })).toEqual([
			{ label: "Mockup", html: "<p>x</p>" },
		]);
		expect(parseMockupDocuments({ before: "<a>", after: "<b>" }).map((d) => d.label)).toEqual([
			"Before",
			"After",
		]);
		expect(parseMockupDocuments({ before: "<a>" })).toEqual([]);
		expect(parseMockupDocuments({ html: "   " })).toEqual([]);
		expect(parseMockupDocuments({ html: 3 })).toEqual([]);
	});

	test("viewport defaults to desktop", () => {
		expect(parseViewport("phone")).toBe("phone");
		expect(parseViewport("tablet")).toBe("tablet");
		expect(parseViewport("watch")).toBe("desktop");
		expect(parseViewport(undefined)).toBe("desktop");
	});
});

describe("geometry", () => {
	test("scales down to fit and never up", () => {
		expect(mockupScale(640, 1280)).toBe(0.5);
		expect(mockupScale(1600, 390)).toBe(1);
		expect(mockupScale(0, 1280)).toBe(1);
	});

	test("clamps heights", () => {
		expect(clampMockupHeight(10)).toBe(MIN_MOCKUP_HEIGHT);
		expect(clampMockupHeight(500.2)).toBe(501);
		expect(clampMockupHeight(1e6)).toBe(MAX_MOCKUP_HEIGHT);
	});
});

describe("workspace asset refs", () => {
	test("only relative paths are workspace assets", () => {
		for (const ref of ["logo.svg", "./img/a.png", "assets/My%20Font.woff2"]) {
			expect(isWorkspaceAssetRef(ref)).toBe(true);
		}
		for (const ref of [
			"https://cdn.example/a.png",
			"//cdn.example/a.png",
			"data:image/png;base64,AA",
			"/etc/passwd",
			"#frag",
			"",
			"javascript:x",
		]) {
			expect(isWorkspaceAssetRef(ref)).toBe(false);
		}
	});

	test("normalizes paths inside the workspace and refuses escapes", () => {
		expect(normalizeAssetPath("./img/../logo.svg?v=2#x")).toBe("logo.svg");
		expect(normalizeAssetPath("assets/My%20Font.woff2")).toBe("assets/My Font.woff2");
		expect(normalizeAssetPath("../secret.txt")).toBeNull();
		expect(normalizeAssetPath("a/../../b")).toBeNull();
	});

	test("collects src, srcset, poster, svg image href, inline and <style> url() refs", () => {
		const document =
			parse(`<html><head><style>@font-face{src:url('fonts/a.woff2')} .h{background:url("https://x/y.png")}</style></head>
			<body><img src="logo.svg" srcset="a.png 1x, b.png 2x"><video poster="p.jpg"></video>
			<div style="background-image: url(bg.png)"></div><a href="page.html" style="color:red">x</a>
			<svg><image href="i.svg"></image></svg><img src="https://cdn/x.png"></body></html>`);
		expect(collectAssetRefs(document).sort()).toEqual(
			["a.png", "b.png", "bg.png", "fonts/a.woff2", "i.svg", "logo.svg", "p.jpg"].sort(),
		);
	});

	test("rewrites resolved refs and leaves the rest", () => {
		const document = parse(
			`<html><head><style>.a{background:url('bg.png')}</style></head><body><img src="logo.svg" srcset="logo.svg 1x, big.png 2x"><img src="missing.png"></body></html>`,
		);
		applyAssetUrls(
			document,
			new Map([
				["logo.svg", "data:image/svg+xml,L"],
				["bg.png", "data:image/png,B"],
			]),
		);
		const html = document.documentElement.outerHTML;
		expect(html).toContain('src="data:image/svg+xml,L"');
		expect(html).toContain('srcset="data:image/svg+xml,L 1x, big.png 2x"');
		expect(html).toContain('url("data:image/png,B")');
		expect(html).toContain('src="missing.png"');
	});

	test("resolveAssetUrls keeps only data: answers and survives a failing resolver", async () => {
		const asked: string[] = [];
		const urls = await resolveAssetUrls(["./a.png", "b.png", "c.png", "../x.png"], async (path) => {
			asked.push(path);
			if (path === "a.png") return "data:image/png,A";
			if (path === "b.png") return "https://evil/b.png";
			throw new Error("boom");
		});
		expect(asked.sort()).toEqual(["a.png", "b.png", "c.png"]);
		expect([...urls]).toEqual([["./a.png", "data:image/png,A"]]);
	});
});

describe("buildMockupDocumentWithAssets", () => {
	test("inlines workspace assets, keeps form controls, and strips scripts and remote images", async () => {
		const html = await buildMockupDocumentWithAssets(
			`<html><head></head><body><form><input autofocus placeholder="Email"><button>Sign in</button></form><img src="logo.svg"><img src="https://x/y.png"><script>1</script></body></html>`,
			async () => "data:image/svg+xml,L",
		);
		expect(html).toContain("<input");
		expect(html).toContain("<button>Sign in</button>");
		expect(html).toContain('src="data:image/svg+xml,L"');
		expect(html).not.toContain("autofocus");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("https://x/y.png");
		expect(html).toContain("Content-Security-Policy");
	});

	test("without a resolver, relative assets are blocked like any non-data URL", async () => {
		const html = await buildMockupDocumentWithAssets(
			`<html><head></head><body><img src="logo.svg"></body></html>`,
			undefined,
		);
		expect(html).not.toContain("logo.svg");
	});
});
