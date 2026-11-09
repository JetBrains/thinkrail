import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewPackageComments } from "./ReviewPackageComments";

const item = (path: string | null, body: string) => ({
	path,
	lineRef: "L1",
	fragment: null,
	locator: null,
	body,
});

test("a package spanning several files names each row's file; a single-file package does not", () => {
	const multi = renderToStaticMarkup(
		<ReviewPackageComments
			foldPrefix="p"
			items={[
				item(".thinkrail/context/mockups/before.html", "old button"),
				item(".thinkrail/context/mockups/after.html", "new button"),
			]}
		/>,
	);
	expect(multi).toContain('data-testid="review-package-item-file"');
	expect(multi).toContain(">before.html</span>");
	expect(multi).toContain(">after.html</span>");

	const single = renderToStaticMarkup(
		<ReviewPackageComments foldPrefix="p" items={[item("a.ts", "one"), item("a.ts", "two")]} />,
	);
	expect(single).not.toContain("review-package-item-file");
});
