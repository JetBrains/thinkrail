import { expect, test } from "bun:test";
import { CodedError, errorCodeOf, errorParamsOf } from "./codedError";

test("coded errors retain English fallback and structured display parameters", () => {
	const error = new CodedError("NOT_GIT", "Not a git repository: /tmp/repo", { path: "/tmp/repo" });
	expect(error.message).toBe("Not a git repository: /tmp/repo");
	expect(errorCodeOf(error)).toBe("NOT_GIT");
	expect(errorParamsOf(error)).toEqual({ path: "/tmp/repo" });
});

test("metadata is optional and only read from host-owned coded errors", () => {
	expect(errorParamsOf(new CodedError("NOT_GIT", "legacy"))).toBeUndefined();
	for (const error of [
		new Error("external"),
		{ code: "NOT_GIT", errorParams: { path: "secret" } },
		null,
	]) {
		expect(errorCodeOf(error)).toBeUndefined();
		expect(errorParamsOf(error)).toBeUndefined();
	}
});
