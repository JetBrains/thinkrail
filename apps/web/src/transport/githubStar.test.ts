import { expect, test } from "bun:test";
import { formatStarCount, githubStarToast } from "./githubStar";

test("star counts read like the website's", () => {
	expect(formatStarCount(999)).toBe("999");
	expect(formatStarCount(7124)).toBe("7.1k");
});

test("the button shows the host's star count, or plain text without one", () => {
	expect(githubStarToast({ stars: 7124 }).action?.label).toBe("View on GitHub | ☆ 7.1k");
	for (const data of [{ stars: null }, { stars: -1 }, { stars: "7k" }, {}, null]) {
		expect(githubStarToast(data).action?.label).toBe("View on GitHub");
	}
});
