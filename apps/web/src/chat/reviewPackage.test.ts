import { expect, test } from "bun:test";
import { parseReviewPackage, reviewPackageLabel } from "./reviewPackage";

const REAL_PACKAGE =
	'The user left the following review comment. It is a structured review item anchored to the workspace\'s files.\n\n<review id="rev_ab12cd34" branch="feature" base="main@deadbeefcafe" comments="1">\n\n<comment id="rc_11aa22bb" kind="inline" path="src/a.ts" side="worktree" lines="2-2" anchor="anchored">\n<fragment>\nconst two = 2;\n</fragment>\n<context lines="1-4">\nconst one = 1;\nconst two = 2;\nconst three = 3;\n\n</context>\n<text>\nRename this.\n</text>\n</comment>\n\n<instructions>\nAddress each review comment above.\n- Edit the worktree files directly with your normal tools; read any file you need — the fragments above are excerpts, not the whole picture.\n- After you have addressed a comment (by an edit, or by an answer when no change is needed), call resolve_comment with its id and a one-line note of what you did.\n- If a comment is unclear or you disagree, reply in the conversation instead of editing, and do NOT resolve it.\n- A comment marked outdated includes the fragment as it was when the comment was written — verify against the current file first.\n- A comment with side="base" points at the PRE-change version of the file: its lines and fragment index base-ref, not the worktree. It is a remark about what the change removed or replaced — find the corresponding place in the current file before editing.\n</instructions>\n</review>';

test("parses the renderer's verbatim output — the real thing, not a lookalike", () => {
	expect(parseReviewPackage(REAL_PACKAGE)).toEqual({
		count: 1,
		files: ["src/a.ts"],
		items: [{ path: "src/a.ts", lineRef: "L2", fragment: "const two = 2;", body: "Rename this." }],
	});
	expect(reviewPackageLabel({ count: 1, files: ["src/a.ts"] })).toBe(
		"Sent 1 review comment on src/a.ts",
	);
});

const pkg = (comments: string[]) =>
	[
		"The user reviewed the current changes and left 2 comments.",
		"",
		'<review id="rev_abc123" branch="feature" base="main@deadbeef" comments="2">',
		"",
		...comments,
		"",
		"<instructions>\n…\n</instructions>",
		"</review>",
	].join("\n");

const comment = (id: string, path?: string) =>
	`<comment id="${id}"${path ? ` kind="inline" path="${path}" side="worktree"` : ' kind="review"'} anchor="anchored">\n<text>\nhm\n</text>\n</comment>`;

test("parses count, distinct files, and per-comment items from a package", () => {
	const s = parseReviewPackage(
		pkg([comment("rc_1", "a.ts"), comment("rc_2", "a.ts"), comment("rc_3", "b.md")]),
	);
	expect(s?.count).toBe(3);
	expect(s?.files).toEqual(["a.ts", "b.md"]);
	expect(s?.items).toEqual([
		{ path: "a.ts", lineRef: "", fragment: null, body: "hm" },
		{ path: "a.ts", lineRef: "", fragment: null, body: "hm" },
		{ path: "b.md", lineRef: "", fragment: null, body: "hm" },
	]);
});

test("review-level (anchorless) comments yield no files", () => {
	expect(parseReviewPackage(pkg([comment("rc_9")]))).toEqual({
		count: 1,
		files: [],
		items: [{ path: null, lineRef: "", fragment: null, body: "hm" }],
	});
});

test("a multi-line body and a line range survive into the item (L2–4), fragment verbatim", () => {
	const s = parseReviewPackage(
		pkg([
			'<comment id="rc_5" kind="inline" path="a.ts" side="worktree" lines="2-4" anchor="anchored">\n<fragment>\nconst two = 2;\nconst three = 3;\n</fragment>\n<text>\nfirst line\nsecond line\n</text>\n</comment>',
		]),
	);
	expect(s?.items).toEqual([
		{
			path: "a.ts",
			lineRef: "L2–4",
			fragment: "const two = 2;\nconst three = 3;",
			body: "first line\nsecond line",
		},
	]);
});

test("ordinary user text — even text QUOTING a review tag mid-line — is not a package", () => {
	expect(parseReviewPackage("please fix the tests")).toBeNull();
	expect(parseReviewPackage('see `<review id="rev_x" comments="1">` in the docs')).toBeNull();
	expect(parseReviewPackage(pkg([]))).toBeNull();
});

test("labels read naturally for one/many comments and one/many files", () => {
	expect(reviewPackageLabel({ count: 1, files: ["a.ts"] })).toBe("Sent 1 review comment on a.ts");
	expect(reviewPackageLabel({ count: 3, files: ["a.ts", "b.md"] })).toBe(
		"Sent 3 review comments on 2 files",
	);
	expect(reviewPackageLabel({ count: 2, files: [] })).toBe(
		"Sent 2 review comments on the change set",
	);
});
