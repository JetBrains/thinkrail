import { afterEach, expect, spyOn, test } from "bun:test";
import { desktopError, setDesktopErrorReporter } from "./errorReporting";

afterEach(() => setDesktopErrorReporter(null));

test("desktop errors with a cause reach the host reporter once it is installed", () => {
	const consoleError = spyOn(console, "error").mockImplementation(() => {});
	const seen: Array<[unknown, string]> = [];
	try {
		const boom = new Error("boom");
		desktopError("updates", "before the host booted", boom);
		setDesktopErrorReporter((error, scope) => {
			seen.push([error, scope]);
			throw new Error("reporter failure must not escape");
		});
		desktopError("updates", "update lifecycle failed", boom);
		desktopError("preferences", "could not save a local preference");
		expect(seen).toEqual([[boom, "updates"]]);
		expect(consoleError).toHaveBeenCalledTimes(3);
	} finally {
		consoleError.mockRestore();
	}
});
