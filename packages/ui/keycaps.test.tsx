import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Keycaps } from "./keycaps";

test("renders one cap per key in order, a repeated key included", () => {
	const markup = renderToStaticMarkup(<Keycaps keys={["⇧", "⇧", "K"]} />);
	expect([...markup.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g)].map((match) => match[1])).toEqual([
		"⇧",
		"⇧",
		"K",
	]);
});
