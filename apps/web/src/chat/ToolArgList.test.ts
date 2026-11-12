import { describe, expect, it } from "bun:test";
import { toolArgEntries } from "./ToolArgList";

describe("toolArgEntries", () => {
	it("shows string arguments raw and others as JSON", () => {
		expect(toolArgEntries({ query: "auth bug", limit: 5, filter: { state: "open" } })).toEqual([
			{ key: "query", value: "auth bug" },
			{ key: "limit", value: "5" },
			{ key: "filter", value: '{\n  "state": "open"\n}' },
		]);
	});
});
