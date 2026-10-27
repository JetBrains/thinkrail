import { expect, test } from "bun:test";
import { t } from "@thinkrail/locales/react";
import { loginOptionParts, loginPromptMessage, loginSelectMessage } from "./loginOptions";

test("loginSelectMessage drops pi's terminal-style trailing colon", () => {
	expect(loginSelectMessage("Select Anthropic login method:")).toBe(
		"Select Anthropic login method",
	);
	expect(loginSelectMessage("Pick one")).toBe("Pick one");
});

test("loginOptionParts turns a trailing parenthetical into a detail or the recommended mark", () => {
	expect(loginOptionParts("Browser login (default)", t)).toEqual({
		title: "Browser login",
		detail: "Recommended",
		recommended: true,
	});
	expect(loginOptionParts("Copy code login (headless)", t)).toEqual({
		title: "Copy code login",
		detail: "If the browser can't reach this computer — paste a code instead.",
		recommended: false,
	});
	expect(loginOptionParts("Sign in (beta)", t)).toEqual({
		title: "Sign in",
		detail: "Beta",
		recommended: false,
	});
	expect(loginOptionParts("GitHub.com", t)).toEqual({ title: "GitHub.com", recommended: false });
	expect(loginOptionParts("(default)", t)).toEqual({ title: "(default)", recommended: false });
});

test("loginPromptMessage turns pi's terminal hints into dialog copy", () => {
	expect(loginPromptMessage("GitHub Enterprise URL/domain (blank for github.com)", t)).toBe(
		"GitHub Enterprise URL/domain. Leave empty for github.com.",
	);
	expect(loginPromptMessage("Configure AWS credentials, then press Enter to continue", t)).toBe(
		"Configure AWS credentials, then choose Continue",
	);
	expect(loginPromptMessage("Enter Groq API key", t)).toBe("Enter Groq API key");
});
