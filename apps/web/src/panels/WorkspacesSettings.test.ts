import { expect, test } from "bun:test";
import { toChoice } from "./WorkspacesSettings";

test("a valid non-preset settle window is not displayed as the 3-day preset", () => {
	expect(toChoice(null)).toBe("never");
	expect(toChoice(3)).toBe("3");
	expect(toChoice(30)).toBe("30");
});
