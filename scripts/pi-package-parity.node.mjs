// Must run under Node from inside the fixture: the bare import resolves pi from there, never from the repo.
import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [, , specPath] = process.argv;
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const pi = await import("@earendil-works/pi-coding-agent");
const runnerDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
if (runnerDir !== realpathSync(spec.npmDir)) {
	console.error(`parity runner must execute from the fixture ${spec.npmDir}, got ${runnerDir}`);
	process.exit(1);
}

const failures = [];
const fail = (message) => failures.push(message);

const settingsManager = pi.SettingsManager.create(spec.cwd, spec.agentDir);
const loader = new pi.DefaultResourceLoader({
	cwd: spec.cwd,
	agentDir: spec.agentDir,
	settingsManager,
});
await loader.reload();

const { extensions, errors } = loader.getExtensions();
for (const error of errors) fail(`extension error at ${error.path}: ${error.error}`);
const extension = extensions.find((entry) => entry.path.includes(spec.packageDirName));
if (!extension) {
	fail(
		`package ${spec.name} did not load (loaded: ${extensions.map((e) => e.path).join(", ") || "none"})`,
	);
}

const tools = new Map(extension ? [...extension.tools.entries()] : []);
for (const name of spec.tools) {
	if (!tools.has(name))
		fail(`tool ${name} not registered (have: ${[...tools.keys()].join(", ") || "none"})`);
}

const skills = loader.getSkills().skills.map((skill) => skill.name);
for (const name of spec.skills) {
	if (!skills.includes(name))
		fail(`skill ${name} not discovered (have: ${skills.join(", ") || "none"})`);
}

pi.initTheme("dark", false);
const plainTheme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
const fakeTui = { requestRender: () => {}, terminal: { rows: 40, columns: 100 } };

function scriptedContext(script) {
	if (!script) return {};
	const replies = [...(script.replies ?? [])];
	const next = () => {
		if (replies.length === 0) throw new Error("the scripted UI ran out of replies");
		const reply = replies.shift();
		return reply === null ? undefined : reply;
	};
	const ui = {
		select: async (_title, choices) => {
			const reply = next();
			return typeof reply === "number" ? choices[reply] : reply;
		},
		input: async () => next(),
		custom: (factory) =>
			new Promise((resolve, reject) => {
				Promise.resolve(factory(fakeTui, plainTheme, {}, resolve))
					.then((component) => {
						for (const key of script.keys ?? []) component.handleInput(key);
					})
					.catch(reject);
			}),
		notify: () => {},
	};
	return { mode: script.mode, hasUI: true, cwd: spec.cwd, ui };
}

for (const testCase of spec.cases) {
	const tool = tools.get(testCase.tool)?.definition;
	if (!tool) continue;
	const label = `${testCase.tool} ${testCase.name}`;
	let result;
	try {
		result = await tool.execute(
			`parity-${testCase.name}`,
			testCase.args,
			undefined,
			undefined,
			scriptedContext(testCase.ui),
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (testCase.expectError) {
			if (!new RegExp(testCase.expectError).test(message)) {
				fail(`${label}: error did not match /${testCase.expectError}/: ${message}`);
			}
		} else {
			fail(`${label}: unexpected error: ${message}`);
		}
		continue;
	}
	if (testCase.expectError) {
		fail(`${label}: expected an error matching /${testCase.expectError}/ but the call succeeded`);
		continue;
	}
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	for (const needle of testCase.expectText ?? []) {
		if (!text.includes(needle)) fail(`${label}: result text lacks ${JSON.stringify(needle)}`);
	}
	if (testCase.expectTerminate !== undefined && result.terminate !== testCase.expectTerminate) {
		fail(`${label}: terminate was ${result.terminate}, expected ${testCase.expectTerminate}`);
	}
	if (testCase.expectRender && tool.renderResult) {
		const component = tool.renderResult(result, { expanded: false, isPartial: false }, plainTheme, {
			isError: false,
			args: testCase.args,
		});
		const lines = component.render(testCase.expectRender.width ?? 100);
		const rendered = lines.join("\n");
		for (const needle of testCase.expectRender.contains ?? []) {
			if (!rendered.includes(needle)) fail(`${label}: TUI render lacks ${JSON.stringify(needle)}`);
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`  ✗ ${failure}`);
	process.exit(1);
}
console.log(
	`  ✓ ${spec.name}: ${spec.tools.length} tool(s), ${spec.skills.length} skill(s), ${spec.cases.length} case(s) — loaded from ${extension.path}`,
);
