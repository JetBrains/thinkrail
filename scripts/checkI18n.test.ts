import { afterAll, expect, test } from "bun:test";
import { API } from "typescript/async";
import { catalogProblems, sourceViolations } from "./check-i18n";

const api = new API({ cwd: import.meta.dir });

afterAll(() => api.close());

const texts = async (source: string, path = "a.tsx") =>
	(await sourceViolations(api, path, source)).map((violation) => violation.text);

test("flags JSX text and text-bearing attributes, not structural ones", async () => {
	expect(
		await texts(
			'const A = () => <div className="flex gap-4" data-testid="x" aria-label="Close panel" title={open ? "Hide" : "Show"}>Hello world</div>;',
		),
	).toEqual(["Close panel", "Hide", "Show", "Hello world"]);
	expect(await texts('const A = () => <Row confirmLabel="Delete it" variant="ghost" />;')).toEqual([
		"Delete it",
	]);
});

test("flags literals rendered as children through conditionals and templates", async () => {
	const source = ['const A = () => <p>{count === 1 ? "file" : `$', "{count} files`}</p>;"].join("");
	expect(await texts(source)).toEqual(["file", "files"]);
});

test("flags prose in text-named properties, toasts, and errorText fallbacks", async () => {
	expect(
		await texts(
			'const L = { label: "Oldest first", id: "oldest-first", reason: "The pane is gone." }; toast.error("Couldn\'t save"); errorText(e, "Failed to load");',
			"a.ts",
		),
	).toEqual(["Oldest first", "The pane is gone.", "Couldn't save", "Failed to load"]);
	expect(await texts('const L = { label: "oldest-first", title: "x" };', "a.ts")).toEqual([]);
});

test("ignores symbols, the bare brand, and translated calls", async () => {
	expect(await texts('const A = () => <span title="⌘K">{t("a.b")} · ThinkRail</span>;')).toEqual(
		[],
	);
});

test("flags hardcoded text through transparent type wrappers", async () => {
	for (const expression of ['"Close panel" satisfies string', '"Close panel"!']) {
		expect(await texts(`const A = () => <button title={${expression}} />;`)).toEqual([
			"Close panel",
		]);
		expect(await texts(`const A = () => <span>{${expression}}</span>;`)).toEqual(["Close panel"]);
		expect(await texts(`toast.error(${expression});`, "a.ts")).toEqual(["Close panel"]);
	}
	expect(await texts('toast.error(<string>"Close panel");', "a.ts")).toEqual(["Close panel"]);
	expect(await texts('const A = () => <span>{t("a.b") satisfies string}</span>;')).toEqual([]);
	expect(await texts("const A = () => <span>{count!}</span>;")).toEqual([]);
});

test("the catalog must be sorted, non-empty, and referenced", () => {
	const catalog = JSON.stringify({ "a.b": "A", "c.d_one": "one", "c.d_other": "many", "z.y": "" });
	expect(catalogProblems(catalog, ['t("a.b"); t("c.d", { count })'])).toEqual([
		"z.y: not a non-empty string",
		"z.y: not referenced by any source",
	]);
	expect(catalogProblems(JSON.stringify({ b: "1", a: "2" }), ['"a" "b"'])).toEqual([
		"en.json keys are not sorted",
	]);
});

test("descends into JSX passed through props and handlers inside attributes", async () => {
	expect(
		await texts(
			'const A = () => <Row description={<p>Never translated</p>} control={<button aria-label="Delete everything" onClick={() => toast.error("Gone")}>Delete it</button>} />;',
		),
	).toEqual(["Never translated", "Delete everything", "Gone", "Delete it"]);
	expect(await texts('const A = () => <Row label="Name" />;')).toEqual(["Name"]);
});
