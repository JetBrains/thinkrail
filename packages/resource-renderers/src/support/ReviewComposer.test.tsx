import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewComposer } from "./ReviewComposer";

test("a remounted review composer restores unsaved text rather than its Ask agent seed", () => {
	let saves = 0;
	const markup = renderToStaticMarkup(
		<ReviewComposer
			draft={{ selectors: [{ kind: "lineRange", startLine: 2, endLine: 3 }], label: "L2–3" }}
			label="Lines 2–3"
			initialText="Please review this hunk"
			input={{
				value: {
					text: "Unsaved review text",
					start: 2,
					end: 8,
					direction: "backward",
					busy: false,
				},
				onChange: () => {},
			}}
			commenting={{
				onSave: async () => {
					saves += 1;
				},
				onSend: async () => {
					saves += 1;
				},
			}}
			onClose={() => {}}
		/>,
	);
	expect(markup).toContain(">Unsaved review text</textarea>");
	expect(markup).not.toContain("Please review this hunk");
	expect(saves).toBe(0);
});
