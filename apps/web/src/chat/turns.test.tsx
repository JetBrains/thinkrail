import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatRow } from "./rows";
import { ChatTurnView } from "./turns";

function renderRow(row: ChatRow, isFinalAnswer: boolean): string {
	return renderToStaticMarkup(
		<ChatTurnView row={row} agentResponded isFinalAnswer={isFinalAnswer} />,
	);
}

describe("message copy layout", () => {
	test("places an assistant copy action inside the bottom-left content band", () => {
		const html = renderRow({ kind: "markdown", id: "answer", text: "100. Final answer" }, true);

		expect(html).toContain("pl-24");
		expect(html).toContain("list-inside");
		expect(html).toContain("bottom-0 left-0");
		expect(html).not.toContain("pb-24");
	});

	test("places a user copy action inside the bottom-right content band", () => {
		const html = renderRow(
			{
				kind: "user",
				id: "prompt",
				message: { role: "user", content: "User prompt", timestamp: 0 },
			},
			false,
		);

		expect(html).toContain("pr-24");
		expect(html).toContain("right-0 bottom-8");
		expect(html).not.toContain("pb-24");
	});
});
