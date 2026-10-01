import { expect, test } from "bun:test";
import { assistantFailureRecovery } from "./assistantFailure";

test("a proxy rejecting pi's fallbacks field offers the server-side-fallback opt-out", () => {
	expect(
		assistantFailureRecovery({
			stopReason: "error",
			errorMessage: "400 Anthropic proxy does not support fallback field",
		}),
	).toBe("disable-server-fallback");
});

test("every other failure keeps plain Try again", () => {
	expect(assistantFailureRecovery({ stopReason: "error", errorMessage: "529 overloaded" })).toBe(
		"try-again",
	);
	expect(assistantFailureRecovery({ stopReason: "error" })).toBe("try-again");
	expect(assistantFailureRecovery({ stopReason: "length" })).toBe("try-again");
});
