#!/usr/bin/env bun
// Vanilla-parity gate for pi-extensions/*; the bar and its rationale live in pi-extensions/SPEC.md.
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { packPiPackage, publishablePiPackages, repoRoot } from "./pi-packages.ts";

interface ScriptedUi {
	mode: "tui" | "rpc";
	replies?: (string | number | null)[];
	keys?: string[];
}

interface ParityCase {
	tool: string;
	name: string;
	args: Record<string, unknown>;
	ui?: ScriptedUi;
	expectError?: string;
	expectText?: string[];
	expectTerminate?: boolean;
	expectRender?: { width?: number; contains?: string[] };
}

interface Expectation {
	tools: string[];
	skills: string[];
	cases: ParityCase[];
}

const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
	workspaces: { catalog: Record<string, string> };
};
const piVersion = rootManifest.workspaces.catalog["@earendil-works/pi-coding-agent"];
if (!piVersion) throw new Error("check-pi-packages: pi version missing from the root catalog");

const ASK_LIBRARY = {
	question: "Which library?",
	header: "Lib",
	options: [
		{ label: "date-fns", description: "small" },
		{ label: "luxon", description: "rich" },
	],
};
const ASK_TARGETS = {
	question: "Which targets?",
	header: "Targets",
	multiSelect: true,
	options: [
		{ label: "web", description: "browser" },
		{ label: "cli", description: "terminal" },
	],
};
const KEY = { up: "\x1b[A", down: "\x1b[B", enter: "\r", escape: "\x1b", space: " " };

const EXPECTATIONS: Record<string, Expectation> = {
	"@thinkrail/pi-ask-user-question": {
		tools: ["ask_user_question"],
		skills: [],
		cases: [
			{
				tool: "ask_user_question",
				name: "no-ui-reports-unavailable",
				args: { questions: [ASK_LIBRARY] },
				expectText: ["UI not available"],
			},
			{
				tool: "ask_user_question",
				name: "invalid-questionnaire-rejected",
				args: { questions: [] },
				ui: { mode: "rpc" },
				expectText: ["At least one question is required"],
			},
			{
				tool: "ask_user_question",
				name: "terminal-answer",
				args: { questions: [ASK_LIBRARY] },
				ui: { mode: "tui", keys: [KEY.down, KEY.enter] },
				expectText: ['"Which library?"="luxon"'],
				expectRender: { width: 80, contains: ["✓ Lib: luxon"] },
			},
			{
				tool: "ask_user_question",
				name: "terminal-multi-with-own-answer",
				args: { questions: [ASK_TARGETS] },
				ui: {
					mode: "tui",
					keys: [KEY.space, KEY.down, KEY.down, "t", "r", "a", "y", KEY.enter],
				},
				expectText: ['"Which targets?"="web"', 'user\'s own answer: "tray"'],
				expectRender: { width: 80, contains: ["✓ Targets: web, “tray”"] },
			},
			{
				tool: "ask_user_question",
				name: "terminal-skip",
				args: { questions: [ASK_LIBRARY] },
				ui: { mode: "tui", keys: [KEY.escape] },
				expectText: ["User declined to answer questions"],
				expectRender: { width: 80, contains: ["Skipped"] },
			},
			{
				tool: "ask_user_question",
				name: "terminal-chat-ends-the-turn",
				args: { questions: [ASK_LIBRARY, ASK_TARGETS] },
				ui: { mode: "tui", keys: [KEY.up, KEY.enter] },
				expectText: ["discuss these questions in chat"],
				expectTerminate: true,
				expectRender: { width: 80, contains: ["Continuing in chat"] },
			},
			{
				tool: "ask_user_question",
				name: "dialog-answer",
				args: { questions: [ASK_LIBRARY] },
				ui: { mode: "rpc", replies: [1] },
				expectText: ['"Which library?"="luxon"'],
			},
			{
				tool: "ask_user_question",
				name: "dialog-own-answer",
				args: { questions: [ASK_LIBRARY] },
				ui: { mode: "rpc", replies: [2, "dayjs"] },
				expectText: ['"Which library?"="dayjs"'],
			},
			{
				tool: "ask_user_question",
				name: "dialog-multi-numbers",
				args: { questions: [ASK_TARGETS] },
				ui: { mode: "rpc", replies: ["1,2"] },
				expectText: ['"Which targets?"="web, cli"'],
			},
			{
				tool: "ask_user_question",
				name: "dialog-dismiss-declines",
				args: { questions: [ASK_LIBRARY] },
				ui: { mode: "rpc", replies: [null] },
				expectText: ["User declined to answer questions"],
			},
		],
	},
	"@thinkrail/pi-visualize": {
		tools: ["visualize"],
		skills: [],
		cases: [
			{
				tool: "visualize",
				name: "flowchart",
				args: {
					type: "diagram",
					title: "Flow",
					mermaid: "flowchart LR\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]",
				},
				expectText: ["```mermaid", "A[Start] --> B{Ok?}"],
				expectRender: { width: 100, contains: ["┌", "Start", "Done"] },
			},
			{
				tool: "visualize",
				name: "sequence",
				args: {
					type: "diagram",
					mermaid: "sequenceDiagram\n  participant A as Alice\n  A->>B: hi\n  B-->>A: hello",
				},
				expectRender: { width: 100, contains: ["Alice", "hi", "hello"] },
			},
			{
				tool: "visualize",
				name: "unsupported-family-passes-through",
				args: {
					type: "diagram",
					mermaid: "gantt\n  title X\n  section S\n  task :a1, 2024-01-01, 3d",
				},
				expectText: ["gantt"],
				expectRender: { width: 100, contains: ["gantt"] },
			},
			{
				tool: "visualize",
				name: "back-and-forth-labels",
				args: {
					type: "diagram",
					mermaid: "flowchart LR\n  U[User] -->|request| A[App]\n  A -->|response| U",
				},
				expectRender: { width: 100, contains: ["request", "response"] },
			},
			{
				tool: "visualize",
				name: "bad-direction-rejected",
				args: { type: "diagram", mermaid: "flowchart XX\n  A --> B" },
				expectError: "invalid Mermaid syntax in `mermaid`: unknown flowchart direction",
			},
			{
				tool: "visualize",
				name: "dropped-fragment-rejected",
				args: {
					type: "comparison",
					options: [{ name: "Broken", mermaid: "flowchart LR\n  A --> B\n  C -->" }],
				},
				expectError:
					"invalid Mermaid syntax in `options\\[0\\]\\.mermaid`: part of the diagram could not be read",
			},
			{
				tool: "visualize",
				name: "comparison",
				args: {
					type: "comparison",
					options: [
						{ name: "A", pros: ["fast"], recommended: true },
						{ name: "B", cons: ["slow"] },
					],
				},
				expectText: ["✅ Recommended", "- fast", "- slow"],
				expectRender: { width: 100, contains: ["A", "fast", "slow"] },
			},
		],
	},
};

const BUN_ONLY = [
	/\bBun\./,
	/from\s+["']bun(?::|["'])/,
	/import\s*\(\s*["']bun:/,
	/import\.meta\.(?:dir|require)\b/,
];

function fail(message: string): never {
	console.error(`check-pi-packages: FAIL — ${message}`);
	process.exit(1);
}

function run(
	command: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const result = spawnSync(command, args, {
		cwd,
		env,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) {
		fail(
			`${command} ${args.join(" ")} (in ${cwd}) exited ${result.status}\n${result.stdout}\n${result.stderr}`,
		);
	}
	return result.stdout;
}

function assertDualRuntime(tarball: string, scratch: string): void {
	const extracted = mkdtempSync(join(scratch, "extract-"));
	run("tar", ["-xzf", tarball, "-C", extracted], scratch);
	const visit = (path: string): void => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) visit(child);
			else if (/\.(?:[cm]?[jt]s)$/.test(entry.name)) {
				const source = readFileSync(child, "utf8");
				for (const pattern of BUN_ONLY) {
					if (pattern.test(source))
						fail(
							`${basename(tarball)}: ${child.slice(extracted.length + 1)} uses a Bun-only API (${pattern})`,
						);
				}
			}
		}
	};
	visit(extracted);
}

const packages = publishablePiPackages();
if (packages.length === 0) {
	console.log("check-pi-packages: no publishable packages under pi-extensions/");
	process.exit(0);
}

const nodeVersion = run("node", ["--version"], repoRoot).trim();
const npmVersion = run("npm", ["--version"], repoRoot).trim();
console.log(`check-pi-packages: node ${nodeVersion}, npm ${npmVersion}, pi ${piVersion}`);

const scratch = mkdtempSync(join(tmpdir(), "thinkrail-pi-parity-"));
try {
	const tarballs = new Map<string, string>();
	for (const pkg of packages) {
		const tarball = packPiPackage(pkg, scratch);
		tarballs.set(pkg.dir, tarball);
		assertDualRuntime(tarball, scratch);
	}

	for (const pkg of packages) {
		const { dir } = pkg;
		const expectation = EXPECTATIONS[pkg.name];
		if (!expectation)
			fail(`${pkg.name} has no parity expectations in scripts/check-pi-packages.ts`);
		if (pkg.piExtensions.length === 0) fail(`${pkg.name} declares no pi.extensions`);

		const agentDir = mkdtempSync(join(scratch, "agent-"));
		const npmDir = join(agentDir, "npm");
		const cwd = mkdtempSync(join(scratch, "project-"));
		mkdirSync(npmDir, { recursive: true });
		writeFileSync(
			join(npmDir, "package.json"),
			JSON.stringify({ name: "pi-parity-fixture", private: true }),
		);

		const workspaceDeps = packages
			.filter((candidate) => pkg.dependencies[candidate.name] !== undefined)
			.map((candidate) => tarballs.get(candidate.dir) as string);
		run(
			"npm",
			[
				"install",
				"--prefix",
				npmDir,
				"--legacy-peer-deps",
				"--no-audit",
				"--no-fund",
				"--loglevel=error",
				`@earendil-works/pi-coding-agent@${piVersion}`,
				...workspaceDeps,
				tarballs.get(dir) as string,
			],
			npmDir,
		);
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: [`npm:${pkg.name}`] }, null, 2),
		);

		const spec = {
			name: pkg.name,
			packageDirName: `node_modules/${pkg.name}/`,
			agentDir,
			npmDir,
			cwd,
			tools: expectation.tools,
			skills: expectation.skills,
			cases: expectation.cases,
		};
		const specPath = join(agentDir, "parity-spec.json");
		writeFileSync(specPath, JSON.stringify(spec));
		const runner = join(npmDir, "pi-package-parity.node.mjs");
		copyFileSync(join(repoRoot, "scripts", "pi-package-parity.node.mjs"), runner);
		const result = spawnSync("node", [runner, specPath], {
			cwd,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		process.stdout.write(result.stdout);
		if (result.status !== 0) fail(`${pkg.name} failed vanilla parity under Node\n${result.stderr}`);

		const size = execFileSync("du", ["-sh", join(npmDir, "node_modules")], {
			encoding: "utf8",
		}).split("\t")[0];
		console.log(`  · ${pkg.name}: installed fixture (pi + package + deps) ${size}`);
	}
	console.log(
		`check-pi-packages: OK (${packages.length} package(s) verified under Node ${nodeVersion})`,
	);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
