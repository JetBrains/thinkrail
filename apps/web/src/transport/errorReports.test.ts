import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { CLIENT_ERROR_REPORT_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import {
	chunkIdsForStack,
	clientErrorReport,
	installClientErrorReporting,
	reportClientError,
	resetClientErrorReportsForTests,
	supportsClientErrorReports,
} from "./errorReports";
import type { WsTransport } from "./transport";
import * as wireTransport from "./wireTransport";

const requests: Array<{ method: string; params: unknown }> = [];
let spy: ReturnType<typeof spyOn> | null = null;

beforeEach(() => {
	requests.length = 0;
	resetClientErrorReportsForTests();
	useAppStore.setState({ protocolVersion: null });
	spy = spyOn(wireTransport, "getTransport").mockReturnValue({
		request: (method: string, params: unknown) => {
			requests.push({ method, params });
			return Promise.resolve({ ok: true });
		},
	} as unknown as WsTransport);
});

afterEach(() => {
	spy?.mockRestore();
	resetClientErrorReportsForTests();
	useAppStore.setState({ protocolVersion: null });
});

test("reports are offered only to a host at or beyond the v86 capability", () => {
	expect(supportsClientErrorReports(CLIENT_ERROR_REPORT_PROTOCOL_VERSION)).toBe(true);
	expect(supportsClientErrorReports(CLIENT_ERROR_REPORT_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsClientErrorReports(null)).toBe(false);
});

test("a report carries the error's class, message, stack and boundary label", () => {
	const error = new TypeError("bad");
	expect(clientErrorReport("render", error, "chat")).toEqual({
		kind: "render",
		type: "TypeError",
		message: "bad",
		stack: error.stack as string,
		boundary: "chat",
	});
	expect(clientErrorReport("rejection", { secret: true })).toEqual({
		kind: "rejection",
		type: "UnhandledRejection",
		message: "",
	});
});

test("reports before the welcome wait for the protocol and are dropped by older hosts", () => {
	reportClientError(clientErrorReport("window", new Error("early")));
	expect(requests).toEqual([]);
	useAppStore.setState({ protocolVersion: CLIENT_ERROR_REPORT_PROTOCOL_VERSION });
	expect(requests.map((request) => request.method)).toEqual(["client.reportError"]);

	requests.length = 0;
	useAppStore.setState({ protocolVersion: CLIENT_ERROR_REPORT_PROTOCOL_VERSION - 1 });
	reportClientError(clientErrorReport("window", new Error("old host")));
	expect(requests).toEqual([]);
});

test("a page sends at most 50 reports", () => {
	useAppStore.setState({ protocolVersion: CLIENT_ERROR_REPORT_PROTOCOL_VERSION });
	for (let i = 0; i < 60; i++) reportClientError(clientErrorReport("window", new Error(`e${i}`)));
	expect(requests).toHaveLength(50);
});

test("window errors and unhandled rejections are forwarded until uninstalled", () => {
	useAppStore.setState({ protocolVersion: CLIENT_ERROR_REPORT_PROTOCOL_VERSION });
	const target = new EventTarget() as unknown as Window;
	const uninstall = installClientErrorReporting(target);
	const error = Object.assign(new Event("error"), {
		error: new RangeError("boom"),
		message: "boom",
	});
	target.dispatchEvent(error);
	const rejection = Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") });
	target.dispatchEvent(rejection);
	uninstall();
	target.dispatchEvent(error);
	expect(requests.map((request) => request.params)).toMatchObject([
		{ kind: "window", type: "RangeError", message: "boom" },
		{ kind: "rejection", type: "Error", message: "nope" },
	]);
});

test("chunk ids are matched from PostHog's registry only for urls in the error's stack", () => {
	const app = "http://127.0.0.1:4317/assets/index-abc.js";
	const lazy = "http://127.0.0.1:4317/assets/Pane-def.js";
	const registry = {
		[`Error\n    at ${app}:1:120`]: "ab8fcdab-5c22-55ed-bec8-0f9acb6a407e",
		[`@${lazy}:1:64`]: "11111111-2222-5333-8444-555555555555",
		"Error\n    at http://127.0.0.1:4317/assets/other.js:1:1":
			"22222222-2222-5333-8444-555555555555",
	};
	expect(chunkIdsForStack(`TypeError: x\n    at f (${app}:10:5)\ng@${lazy}:3:9`, registry)).toEqual(
		{
			[app]: "ab8fcdab-5c22-55ed-bec8-0f9acb6a407e",
			[lazy]: "11111111-2222-5333-8444-555555555555",
		},
	);
	expect(chunkIdsForStack(`at f (${app}:1:1)`, undefined)).toBeUndefined();
	expect(chunkIdsForStack("no urls here", registry)).toBeUndefined();
});
