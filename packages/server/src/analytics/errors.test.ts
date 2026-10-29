import { expect, test } from "bun:test";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	detectAppRoot,
	EXTERNAL_FRAME,
	type FrameRoots,
	messageFreeStack,
	normalizeFrameFilename,
	reportableError,
	sanitizeExceptionProperties,
	toV8Stack,
} from "./errors";

const ROOTS: FrameRoots = { appRoot: "/opt/thinkrail", caseInsensitive: false };

function rootValue(properties: Record<string, unknown>): unknown {
	return sanitizeExceptionProperties(
		{ ...properties, $exception_list: [{ type: "Error", value: "Confidential: jane@acme.com" }] },
		ROOTS,
	).$exception_list;
}

test.each([
	[
		{ source: "request", request_method: "pr.open", code: "PUSH_AUTH_FAILED" },
		"request pr.open PUSH_AUTH_FAILED",
	],
	[{ source: "ui", scope: "render:chat" }, "ui render:chat"],
	[{ source: "host_logged", scope: "agent" }, "host_logged agent"],
	[{ source: "request", request_method: "project.open", scope: "ignored" }, "request project.open"],
	[{ source: "request", scope: "has spaces /and/paths" }, "request"],
	[{}, ""],
])("the exception value is a classifier of %j, never the message", (properties, value) => {
	expect(rootValue(properties)).toEqual([{ type: "Error", value }]);
});

test.each([
	["/opt/thinkrail/packages/server/src/host/server.ts", "packages/server/src/host/server.ts", true],
	["../../packages/server/src/log/logging.ts", EXTERNAL_FRAME, false],
	["packages/billing/index.ts", EXTERNAL_FRAME, false],
	["file:///opt/thinkrail/apps/cli/src/main.ts", "apps/cli/src/main.ts", true],
	[
		"/opt/thinkrail/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
		"node_modules/@earendil-works/pi-coding-agent/dist/index.js",
		false,
	],
	["/Users/jdoe/.pi/agent/extensions/payroll.ts", EXTERNAL_FRAME, false],
	["/Users/jdoe/acme/packages/billing/index.ts", EXTERNAL_FRAME, false],
	["node:internal/fs/promises", "node:internal/fs/promises", false],
	["http://127.0.0.1:4317/assets/index-abc123.js", "web/assets/index-abc123.js", true],
	["views://web/assets/index.js", "views/web/assets/index.js", true],
	["https://cdn.example.com/lib.js", EXTERNAL_FRAME, false],
	["chrome-extension://abcdef/content.js", EXTERNAL_FRAME, false],
	["<anonymous>", EXTERNAL_FRAME, false],
	[undefined, EXTERNAL_FRAME, false],
])("normalizeFrameFilename(%j)", (input, filename, inApp) => {
	const result = normalizeFrameFilename(input, ROOTS);
	expect(result.filename).toBe(filename);
	expect(result.inApp).toBe(inApp);
});

test.each([
	["../../packages/server/src/log/logging.ts", "packages/server/src/log/logging.ts", true],
	["src/compiled-entry.ts", "apps/cli/src/compiled-entry.ts", true],
	[
		"../../node_modules/.bun/pi@1/node_modules/pi/dist/x.js",
		"node_modules/.bun/pi@1/node_modules/pi/dist/x.js",
		false,
	],
	["../../../escape/payroll.ts", EXTERNAL_FRAME, false],
	["native", "native", false],
	["<anonymous>", EXTERNAL_FRAME, false],
	["/Users/jdoe/.pi/agent/extensions/payroll.ts", EXTERNAL_FRAME, false],
])("source-mapped binary frame %j resolves only through the remap base", (input, filename, inApp) => {
	const result = normalizeFrameFilename(input, { ...ROOTS, remapBase: "apps/cli" });
	expect(result.filename).toBe(filename);
	expect(result.inApp).toBe(inApp);
});

test("chunk ids pass only as UUIDs, from the SDK frame or the browser's url map", () => {
	const id = "ab8fcdab-5c22-55ed-bec8-0f9acb6a407e";
	const url = "http://127.0.0.1:4317/assets/index-abc.js";
	const frame = (extra: Record<string, unknown>) => ({
		platform: "node:javascript",
		function: "f",
		lineno: 1,
		colno: 2,
		...extra,
	});
	const properties = sanitizeExceptionProperties(
		{
			$exception_list: [
				{
					type: "Error",
					value: "x",
					stacktrace: {
						type: "raw",
						frames: [
							frame({ filename: "/opt/thinkrail/runtime/server-runtime.ts", chunk_id: id }),
							frame({ filename: url }),
							frame({ filename: "/opt/thinkrail/a.js", chunk_id: "not a uuid /Users/jdoe" }),
							frame({ filename: "/Users/jdoe/x.js", chunk_id: id }),
						],
					},
				},
			],
			$thinkrail_chunk_ids: { [url]: id },
		},
		ROOTS,
	);
	const [list] = properties.$exception_list as Array<{ stacktrace: { frames: unknown[] } }>;
	expect(list?.stacktrace.frames.map((f) => (f as { chunk_id?: string }).chunk_id)).toEqual([
		id,
		id,
		undefined,
		undefined,
	]);
	expect(properties).not.toHaveProperty("$thinkrail_chunk_ids");
});

test("Windows frame roots compare case-insensitively with either separator", () => {
	const roots: FrameRoots = {
		appRoot: "C:/Program Files/ThinkRail/resources/app",
		caseInsensitive: true,
	};
	expect(
		normalizeFrameFilename(
			"c:\\program files\\thinkrail\\resources\\app\\runtime\\server-runtime.ts",
			roots,
		).filename,
	).toBe("runtime/server-runtime.ts");
});

test("detectAppRoot resolves the repository in source and the bundle directory when packaged", () => {
	expect(detectAppRoot("file:///work/repo/packages/server/src/analytics/errors.ts")).toBe(
		"/work/repo",
	);
	expect(detectAppRoot("file:///$bunfs/root/thinkrail")).toBe("/$bunfs/root");
	expect(
		detectAppRoot(
			"file:///Applications/ThinkRail.app/Contents/Resources/app/runtime/server-runtime.ts",
		),
	).toBe("/Applications/ThinkRail.app/Contents/Resources/app/runtime");
});

test("sanitizeExceptionProperties rebuilds the event from an allow-list", () => {
	const properties = sanitizeExceptionProperties(
		{
			$exception_list: [
				{
					type: "TypeError",
					value: "bad /Users/jdoe/acme/x.ts",
					module: "acme.secret:x",
					mechanism: { handled: false, synthetic: false, type: "generic", source: "jdoe" },
					stacktrace: {
						type: "raw",
						frames: [
							{
								platform: "node:javascript",
								filename: "/opt/thinkrail/packages/server/src/host/server.ts",
								function: "handleRequest",
								lineno: 12,
								colno: 3,
								in_app: true,
								abs_path: "/opt/thinkrail/packages/server/src/host/server.ts",
								context_line: "const password = 'hunter2'",
								pre_context: ["// jdoe"],
								post_context: ["}"],
								vars: { email: "jane@example.com" },
								module: "host:server",
								chunk_id: "abc",
							},
							{
								platform: "node:javascript",
								filename: "/Users/jdoe/.pi/agent/extensions/payroll.ts",
								function: "computeJanesSalary",
								lineno: 4,
								colno: 9,
								in_app: true,
							},
						],
					},
				},
				{ type: "Some Weird Type!", value: 42 },
			],
			$exception_level: "fatal",
			source: "request",
			handled: true,
			code: "ALREADY_OPEN",
			request_method: "project.open",
			scope: "has spaces /and/paths",
			app_version: "1.2.3",
			$session_id: "leak",
			workspace_path: "/Users/jdoe/acme",
		},
		ROOTS,
	);
	expect(properties).toEqual({
		$exception_list: [
			{
				type: "TypeError",
				value: "request project.open ALREADY_OPEN",
				mechanism: { handled: true, synthetic: false, type: "generic" },
				stacktrace: {
					type: "raw",
					frames: [
						{
							platform: "node:javascript",
							filename: "packages/server/src/host/server.ts",
							function: "handleRequest",
							lineno: 12,
							colno: 3,
							in_app: true,
						},
						{ platform: "node:javascript", filename: EXTERNAL_FRAME, function: "?", in_app: false },
					],
				},
			},
			{ type: "Error", value: "" },
		],
		$exception_level: "fatal",
		$process_person_profile: false,
		source: "request",
		handled: true,
		code: "ALREADY_OPEN",
		request_method: "project.open",
		app_version: "1.2.3",
	});
});

test("toV8Stack rewrites WebKit/Gecko frames so the node parser reads them", () => {
	expect(
		toV8Stack("render@http://127.0.0.1:1/assets/a.js:10:5\n@http://127.0.0.1:1/assets/b.js:1:2"),
	).toBe(
		"    at render (http://127.0.0.1:1/assets/a.js:10:5)\n    at ? (http://127.0.0.1:1/assets/b.js:1:2)",
	);
	expect(toV8Stack("    at f (x.js:1:1)")).toBe("    at f (x.js:1:1)");
});

test("messageFreeStack cuts the message out of the stack and drops a stack it cannot separate", () => {
	const message = "push rejected\n    at payroll (src/payroll.ts:1:1)";
	expect(messageFreeStack(`Error: ${message}\n    at real (x.ts:2:3)`, message)).toBe(
		"Error: \n    at real (x.ts:2:3)",
	);
	expect(messageFreeStack("    at real (x.ts:2:3)", "")).toBe("    at real (x.ts:2:3)");
	expect(messageFreeStack("    at real (x.ts:2:3)", "rewritten message")).toBeUndefined();
	expect(messageFreeStack(undefined, "x")).toBeUndefined();
});

test("coded display parameters never enter reportable errors or exception properties", () => {
	const secret = "/Users/private/project";
	const error = new CodedError("NOT_GIT", `Not a git repository: ${secret}`, { path: secret });
	const reportable = reportableError(error);
	expect(reportable.name).toBe("CodedError");
	expect(reportable.message).toBe("");
	expect(reportable).not.toHaveProperty("errorParams");
	expect(reportable.stack).not.toContain(secret);
	const properties = sanitizeExceptionProperties(
		{
			code: error.code,
			errorParams: error.errorParams,
			$exception_list: [{ type: error.name, value: error.message, errorParams: error.errorParams }],
		},
		ROOTS,
	);
	expect(JSON.stringify(properties)).not.toContain(secret);
	expect(JSON.stringify(properties)).not.toContain("errorParams");
});

test("reportableError keeps the class and the message-free stacks of the cause chain, nothing else", () => {
	const message =
		"Confidential client Jane Doe\n    at salary (http://127.0.0.1:1/src/payroll.js:7:2)";
	const error = Object.assign(new TypeError(message, { cause: new Error(message) }), {
		code: "EACCES",
		path: "/Users/jane/acme",
	});
	const reportable = reportableError(error);
	expect(reportable.name).toBe("TypeError");
	expect(reportable.message).toBe("");
	expect(Object.keys(reportable).sort()).toEqual(["cause", "name"]);
	const stacks = `${reportable.stack}\n${(reportable.cause as Error).stack}`;
	expect(stacks).not.toContain("Jane");
	expect(stacks).not.toContain("payroll");
	expect(stacks).toContain("errors.test.ts");
	expect(reportableError("a string reason").stack).toBe("");
	expect(reportableError({ error: error }).stack).toBe("");
});
