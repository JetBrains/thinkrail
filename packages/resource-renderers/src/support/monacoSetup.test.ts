import { beforeAll, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { i18n } from "@thinkrail/locales/react";
import { editorWrappingOptions } from "./editorWrapping";

let source: string;
beforeAll(async () => {
	const build = await Bun.build({
		entrypoints: [new URL("./monacoSetup.ts", import.meta.url).pathname],
		target: "node",
		format: "cjs",
		external: ["*"],
	});
	expect(build.success).toBe(true);
	const output = build.outputs[0];
	if (!output) throw new Error("Monaco fixture did not build");
	source = await output.text();
});

function setup() {
	const tokens: Record<string, string> = {
		"--tr-font-family-code": "Initial Code",
		"--tr-font-size-s11": "11",
		"--tr-line-height-default": "1.3",
		"--space-8": "8",
	};
	let notify = () => {};
	let dispose = () => {};
	let watching = false;
	let remeasures = 0;
	let creates = 0;
	const updates: unknown[] = [];
	const models: unknown[] = [];
	const editor = {
		model: undefined as unknown,
		options: undefined as unknown,
		updateOptions: (options: unknown) => updates.push(options),
		onDidDispose: (callback: () => void) => {
			dispose = callback;
		},
		getModel: () => editor.model,
		dispose: () => dispose(),
	};
	const modules: Record<string, unknown> = {
		"@thinkrail/ui/theme": {},
		"@thinkrail/ui/typography": {
			onFontChange(callback: () => void) {
				notify = callback;
				watching = true;
				return () => {
					watching = false;
				};
			},
		},
		"monaco-editor/esm/vs/editor/editor.api.js": {
			Uri: { parse: (uri: string) => ({ toString: () => uri }) },
			editor: {
				getModel: () => null,
				createModel: () => {
					const model = { getLanguageId: () => "plaintext", dispose() {} };
					models.push(model);
					return model;
				},
				create: (_container: unknown, options: { model: unknown }) => {
					creates += 1;
					editor.model = options.model;
					editor.options = options;
					return editor;
				},
				remeasureFonts: () => {
					remeasures += 1;
				},
			},
		},
		"./editorWrapping": { editorWrappingOptions },
		"./shikiTokens": {},
	};
	const module = { exports: {} as typeof import("./monacoSetup") };
	runInNewContext(source, {
		module,
		exports: module.exports,
		require: (name: string) => {
			if (name in modules) return modules[name];
			if (name.startsWith("monaco-editor/") || name.startsWith("shiki/")) return {};
			throw new Error(`Unexpected import: ${name}`);
		},
		window: {},
		document: { documentElement: {} },
		getComputedStyle: () => ({ getPropertyValue: (name: string) => tokens[name] ?? "" }),
	});
	return {
		api: module.exports,
		tokens,
		editor,
		models,
		updates,
		get creates() {
			return creates;
		},
		get remeasures() {
			return remeasures;
		},
		get watching() {
			return watching;
		},
		change(family: string) {
			tokens["--tr-font-family-code"] = family;
			if (watching) notify();
		},
	};
}

test("Monaco shares font derivation and refreshes only options and metrics without replacing its model", () => {
	const fixture = setup();
	const { api } = fixture;
	const options = api.fileEditorOptions(i18n.t, 120, true, "file.txt");
	expect(options.fontFamily).toBe("Initial Code");
	fixture.tokens["--tr-font-family-code"] = "Before Mount";
	const editor = api.createFileEditor({} as HTMLElement, {
		scope: "file-test",
		path: "file.txt",
		text: "keep this text",
		options,
	});
	const model = editor.getModel();
	const modelCount = fixture.models.length;
	expect(fixture.editor.options).toMatchObject({ fontFamily: "Before Mount" });
	fixture.change("System Mono");
	fixture.change("Latest Mono");
	expect(fixture.updates).toEqual([
		{ fontFamily: "System Mono", fontSize: 11, lineHeight: 1.3 },
		{ fontFamily: "Latest Mono", fontSize: 11, lineHeight: 1.3 },
	]);
	expect(fixture.remeasures).toBe(2);
	expect(editor.getModel()).toBe(model);
	expect(fixture.models).toHaveLength(modelCount);
	expect(fixture.creates).toBe(1);
	api.disposeFileEditor(editor);
	expect(fixture.watching).toBe(false);
	fixture.change("Disposed Mono");
	expect(fixture.updates).toHaveLength(2);
	expect(fixture.remeasures).toBe(2);
});

test("missing code tokens use the same fallback at construction and font change", () => {
	const fixture = setup();
	fixture.tokens["--tr-font-family-code"] = "";
	fixture.tokens["--tr-font-size-s11"] = "";
	fixture.tokens["--tr-line-height-default"] = "";
	const options = fixture.api.fileEditorOptions(i18n.t, 80, false, "fallback.txt");
	expect(options.fontFamily).toBe("monospace");
	expect(options.fontSize).toBe(11);
	const editor = fixture.api.createFileEditor({} as HTMLElement, {
		scope: "fallback-test",
		path: "fallback.txt",
		text: "",
		options,
	});
	fixture.change("");
	expect(fixture.updates).toEqual([{ fontFamily: "monospace", fontSize: 11 }]);
	editor.dispose();
	expect(fixture.watching).toBe(false);
});
