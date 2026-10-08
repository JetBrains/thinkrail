import { expect, test } from "bun:test";
import { settledNoticeMessage, settledNoticeTitle } from "./settledShelfNotice";

test("the first-move notice counts what moved and names the rules that moved it", () => {
	expect(settledNoticeTitle(1)).toBe("Moved 1 quiet workspace to Settled");
	expect(settledNoticeTitle(42)).toBe("Moved 42 quiet workspaces to Settled");
	expect(settledNoticeMessage(7)).toBe(
		"Their pull request merged or closed, or they sat idle for 7 days. Any work in one, or Keep active, brings it back.",
	);
	expect(settledNoticeMessage(1)).toContain("sat idle for a day.");
	expect(settledNoticeMessage(null)).toBe(
		"Their pull request merged or closed. Any work in one, or Keep active, brings it back.",
	);
});
