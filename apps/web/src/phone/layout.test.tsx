import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadedList } from "./layout";

test("a failed read says why and offers Retry, so the screen is never stuck on the error", () => {
	const html = renderToStaticMarkup(
		<LoadedList loaded={{ kind: "failed", reason: "timeout", retry: () => {} }} empty="none">
			{() => null}
		</LoadedList>,
	);
	expect(html).toContain("timeout");
	expect(html).toContain("Retry");
});
