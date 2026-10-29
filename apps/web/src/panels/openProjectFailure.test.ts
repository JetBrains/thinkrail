import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import { RequestError } from "../transport";
import * as wireTransport from "../transport/wireTransport";
import { explainOpenFailure } from "./openProjectFailure";

const t = currentTranslator();
const requests: [string, unknown][] = [];
let restore: () => void = () => {};

beforeEach(() => {
	requests.length = 0;
	const transport = {
		request: (method: string, params: unknown) => {
			requests.push([method, params]);
			return Promise.resolve({ kind: "initable" });
		},
	} as unknown as ReturnType<typeof wireTransport.getTransport>;
	const spy = spyOn(wireTransport, "getTransport").mockReturnValue(transport);
	restore = () => spy.mockRestore();
});

afterEach(() => restore());

test("a timed-out open shows its error without asking the host to inspect the same path", async () => {
	const message = "Could not read the repository root: timed out after 10s — git did not exit";
	const failure = await explainOpenFailure(new RequestError("GIT_TIMEOUT", message), "/repo", t);

	expect(failure).toEqual({ kind: "notice", text: message });
	expect(requests).toEqual([]);
});

test("any other open failure inspects the path and offers init for a plain folder", async () => {
	const failure = await explainOpenFailure(
		new RequestError("NOT_GIT", "Not a git repository"),
		"/folder",
		t,
	);

	expect(failure).toEqual({ kind: "initable" });
	expect(requests).toEqual([["project.inspect", { path: "/folder" }]]);
});
