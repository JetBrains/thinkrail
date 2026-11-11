import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PairActions } from "./PairForm";

test("a failed pairing is translated where it shows, from what failed rather than a frozen string", () => {
	const html = renderToStaticMarkup(
		<PairActions
			pair={{ kind: "failed", failure: { kind: "network" } }}
			onPair={() => Promise.resolve(false)}
		/>,
	);
	expect(html).toContain("Couldn&#x27;t reach the computer");
});
