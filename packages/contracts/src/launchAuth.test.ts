import { expect, test } from "bun:test";
import { launchPathFor, redactLaunchToken } from "./launchAuth";

test("redactLaunchToken strips the launch token from URLs in free text", () => {
	const text =
		"Failed to fetch http://127.0.0.1:4000/ext/a/0123/v.js?token=s3cr3t-x\n  at (http://h/x.js?a=1&token=abc:10:2)";
	const redacted = redactLaunchToken(text);
	expect(redacted).not.toContain("s3cr3t");
	expect(redacted).not.toContain("abc:10");
	expect(redacted).toContain("v.js?token=redacted");
	expect(redacted).toContain("a=1&token=redacted");
});

test("launchPathFor encodes the token as the one launch query param", () => {
	expect(launchPathFor("a+b/c")).toBe("/?token=a%2Bb%2Fc");
});
