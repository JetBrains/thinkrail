import { describe, expect, test } from "bun:test";
import {
	MAX_MOCKUP_BYTES,
	mockupDocuments,
	mockupNotes,
	mockupSummary,
	validateMockupDocument,
	validateMockupShape,
} from "./mockup.ts";

describe("mockupDocuments", () => {
	test("a single mockup is one titled document", () => {
		expect(mockupDocuments({ type: "mockup", title: "Login", html: "<p>x</p>" })).toEqual([
			{ location: "html", label: "Login", html: "<p>x</p>" },
		]);
	});

	test("a pair is before then after", () => {
		expect(
			mockupDocuments({ type: "mockup", before: "<p>a</p>", after: "<p>b</p>" }).map(
				(d) => d.location,
			),
		).toEqual(["before", "after"]);
	});

	test("comparison options contribute only the ones carrying html", () => {
		expect(
			mockupDocuments({
				type: "comparison",
				options: [{ name: "A" }, { name: "B", html: "<p>b</p>" }],
			}),
		).toEqual([{ location: "options[1].html", label: "B", html: "<p>b</p>" }]);
	});

	test("a diagram has no documents", () => {
		expect(mockupDocuments({ type: "diagram", mermaid: "graph LR; A-->B" })).toEqual([]);
	});
});

describe("validateMockupShape", () => {
	test("accepts html alone or a full pair", () => {
		expect(() => validateMockupShape({ type: "mockup", html: "<p/>" })).not.toThrow();
		expect(() =>
			validateMockupShape({ type: "mockup", before: "<p/>", after: "<p/>" }),
		).not.toThrow();
	});

	test("rejects nothing, half a pair, and html mixed with a pair", () => {
		expect(() => validateMockupShape({ type: "mockup" })).toThrow(/needs `html`/);
		expect(() => validateMockupShape({ type: "mockup", before: "<p/>" })).toThrow(/needs `html`/);
		expect(() => validateMockupShape({ type: "mockup", html: "<p/>", after: "<p/>" })).toThrow(
			/not both/,
		);
	});
});

describe("validateMockupDocument", () => {
	test("rejects a blank document with its location", () => {
		expect(() => validateMockupDocument({ location: "after", label: "After", html: "  " })).toThrow(
			/`after` is empty/,
		);
	});

	test("rejects a document over the byte cap", () => {
		const html = "x".repeat(MAX_MOCKUP_BYTES + 1);
		expect(() => validateMockupDocument({ location: "html", label: "M", html })).toThrow(
			/limit is 256 KB/,
		);
	});
});

describe("mockupNotes", () => {
	const notes = (html: string) => mockupNotes({ location: "html", label: "M", html });

	test("a clean static document has no notes", () => {
		expect(
			notes('<style>.a{background:url(data:image/png;base64,AA)}</style><img src="logo.svg">'),
		).toEqual([]);
	});

	test("flags scripts, event handlers and remote resources", () => {
		expect(notes("<script>alert(1)</script>")[0]).toMatch(/<script> is removed/);
		expect(notes('<button onclick="x()">Go</button>')[0]).toMatch(/event handlers/);
		expect(notes('<img src="https://example.com/a.png">')[0]).toMatch(/http\(s\) resources/);
		expect(notes("<style>@import url('//fonts.example/x.css');</style>")[0]).toMatch(/http/);
	});
});

describe("mockupSummary", () => {
	test("names the kind, the title and the viewport without the HTML", () => {
		expect(
			mockupSummary({
				type: "mockup",
				title: "Header",
				before: "<b>",
				after: "<i>",
				viewport: "phone",
			}),
		).toBe('Rendered before/after mockup "Header" (phone) for the user.');
		expect(mockupSummary({ type: "mockup", html: "<p>secret</p>" })).not.toContain("secret");
	});
});
