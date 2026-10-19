import { expect, test } from "bun:test";
import {
	detectAppRoot,
	EXTERNAL_FRAME,
	type FrameRoots,
	normalizeFrameFilename,
	type ScrubContext,
	sanitizeExceptionProperties,
	scrubMessage,
	toV8Stack,
} from "./errors";

const SCRUB: ScrubContext = {
	home: "/Users/jdoe",
	username: "jdoe",
	hostname: "Janes-MacBook-Pro",
};
const ROOTS: FrameRoots = {
	appRoot: "/opt/thinkrail",
	cwd: "/Users/jdoe/acme",
	caseInsensitive: false,
};

test.each([
	[
		"ENOENT: no such file or directory, open '/Users/jdoe/acme/secret-plan.md'",
		"ENOENT: no such file or directory, open <str>",
	],
	["Workspace not found: /Users/jdoe/acme", "Workspace not found: <path>"],
	[
		"Can't pin the base side of this diff: origin/feature-x names no commit.",
		"Can't pin the base side of this diff: <path> names no commit.",
	],
	[
		"The base (main) has no src/payroll.ts to comment on.",
		"The base (main) has no <path> to comment on.",
	],
	["C:\\Users\\jdoe\\AppData\\Local\\x.json is locked", "<path> is locked"],
	["fetch https://api.example.com/v1?key=sk-abc failed", "fetch <url> failed"],
	["invite jane.doe@example.com rejected", "invite <email> rejected"],
	['branch "jane/hotfix" already exists', "branch <str> already exists"],
	["unknown comment 3f2a1b9c-1d2e-4f5a-9b8c-7d6e5f4a3b2c", "unknown comment <id>"],
	["commit 9fceb02a1 is missing", "commit <hex> is missing"],
	["connect ECONNREFUSED 10.0.0.12:8443", "connect ECONNREFUSED <ip>:<n>"],
	['400 {"error":{"message":"prompt contained jane"}}', "400 <json>"],
	["token ghp_abcdefghijklmnopqrstuvwxyz0123 expired", "token <token> expired"],
	["jdoe cannot write on Janes-MacBook-Pro", "<user> cannot write on <host>"],
	["first line\nsecond line with /Users/jdoe/secret", "first line"],
	["ran `rm -rf build` for jdoe", "ran <str> for <user>"],
	[
		"Cannot read properties of undefined (reading 'title')",
		"Cannot read properties of undefined (reading <str>)",
	],
])("scrubMessage(%j)", (input, expected) => {
	expect(scrubMessage(input, SCRUB)).toBe(expected);
});

test("scrubMessage caps length and ignores non-strings", () => {
	expect(scrubMessage("a ".repeat(400), SCRUB).length).toBeLessThanOrEqual(300);
	expect(scrubMessage({ secret: "x" }, SCRUB)).toBe("");
	expect(scrubMessage(undefined, SCRUB)).toBe("");
});

test.each([
	["/opt/thinkrail/packages/server/src/host/server.ts", "packages/server/src/host/server.ts", true],
	[
		"../../../opt/thinkrail/packages/server/src/log/logging.ts",
		"packages/server/src/log/logging.ts",
		true,
	],
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

test("Windows frame roots compare case-insensitively with either separator", () => {
	const roots: FrameRoots = {
		appRoot: "C:/Program Files/ThinkRail/resources/app",
		cwd: "C:/Users/jdoe",
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
		SCRUB,
	);
	expect(properties).toEqual({
		$exception_list: [
			{
				type: "TypeError",
				value: "bad <path>",
				mechanism: { handled: false, synthetic: false, type: "generic" },
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
