import {
	accessSync,
	constants,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	isModelContextWindow,
	isSharedModelContextTarget,
	MODEL_CONTEXT_WINDOW_LIMITS,
	type ModelContextSetting,
	type ModelContextTarget,
} from "@thinkrail/contracts";
import {
	applyEdits,
	findNodeAtLocation,
	modify,
	type Node,
	type ParseError,
	parseTree,
} from "jsonc-parser";
import { usePiRuntime } from "./agentSessionManager";
import { type AvailableModelsRuntime, settledAvailableModels } from "./piRuntime";

const OPENAI_RESPONSES_APIS = new Set(["openai-responses", "openai-codex-responses"]);
const PARSE = { allowTrailingComma: true };
const FORMATTING = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } };
const EMPTY_CONFIG = '{\n  "providers": {}\n}\n';

let publishContextChange: (() => void) | null = null;

export function setModelContextPublisher(publisher: (() => void) | null): void {
	publishContextChange = publisher;
}

function modelsPath(): string {
	return join(getAgentDir(), "models.json");
}

function readSource(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw new Error("Couldn't read pi's models.json. Fix the file and retry.");
	}
}

function parseConfig(source: string | undefined): Node | undefined {
	if (source === undefined) return undefined;
	const errors: ParseError[] = [];
	const root = parseTree(source.replace(/^\uFEFF/, ""), errors, PARSE);
	if (errors.length > 0)
		throw new Error("Pi's models.json isn't valid JSON. Fix the file and retry.");
	return root;
}

function overridePath(model: Pick<ModelContextSetting, "provider" | "id">): string[] {
	return ["providers", model.provider, "modelOverrides", model.id, "contextWindow"];
}

function listSettings(
	runtime: AvailableModelsRuntime,
	config: Node | undefined,
): ModelContextSetting[] {
	return settledAvailableModels(runtime).flatMap((model) => {
		if (!OPENAI_RESPONSES_APIS.has(model.api)) return [];
		const node = config && findNodeAtLocation(config, overridePath(model));
		const override: number | null = node?.type === "number" ? node.value : null;
		if (override === null && model.contextWindow !== MODEL_CONTEXT_WINDOW_LIMITS.min) return [];
		return [
			{
				provider: model.provider,
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				override,
			},
		];
	});
}

function patch(source: string, path: string[], contextWindow: number | null): string {
	if (contextWindow !== null)
		return applyEdits(source, modify(source, path, contextWindow, FORMATTING));
	let current = path;
	while (current.length > 1) {
		source = applyEdits(source, modify(source, current, undefined, FORMATTING));
		const parent = current.slice(0, -1);
		const root = parseTree(source, [], PARSE);
		const node = root && findNodeAtLocation(root, parent);
		if (node?.type !== "object" || node.children?.length) break;
		current = parent;
	}
	return source;
}

function writeModelsFile(path: string, source: string): void {
	let target: string | undefined;
	try {
		target = realpathSync(path);
	} catch {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	}
	const mode = target === undefined ? 0o600 : statSync(target).mode & 0o777;
	const temp = join(dirname(target ?? path), `.models.json.${process.pid}.tmp`);
	try {
		if (target !== undefined) accessSync(target, constants.W_OK);
		writeFileSync(temp, source, { mode });
		renameSync(temp, target ?? path);
	} catch {
		rmSync(temp, { force: true });
		throw new Error("Couldn't save pi's models.json. Check file permissions and retry.");
	}
}

export function listModelContextSettings(): Promise<ModelContextSetting[]> {
	return usePiRuntime(async (runtime) => {
		await runtime.refresh({ allowNetwork: false });
		return listSettings(runtime, parseConfig(readSource(modelsPath())));
	});
}

let saving: Promise<unknown> = Promise.resolve();

export function setModelContextWindow(
	target: ModelContextTarget,
	contextWindow: number | null,
): Promise<ModelContextSetting[]> {
	if (contextWindow !== null && !isModelContextWindow(contextWindow)) {
		return Promise.reject(
			new Error(
				`Context window must be a whole number between ${MODEL_CONTEXT_WINDOW_LIMITS.min.toLocaleString("en-US")} and ${MODEL_CONTEXT_WINDOW_LIMITS.max.toLocaleString("en-US")} tokens`,
			),
		);
	}
	const run = saving.catch(() => undefined).then(() => save(target, contextWindow));
	saving = run;
	return run;
}

function save(
	target: ModelContextTarget,
	contextWindow: number | null,
): Promise<ModelContextSetting[]> {
	return usePiRuntime(async (runtime) => {
		await runtime.refresh({ allowNetwork: false });
		const path = modelsPath();
		const source = readSource(path);
		const settings = listSettings(runtime, parseConfig(source));
		const targets =
			target === "available"
				? settings.filter(isSharedModelContextTarget)
				: settings.filter((model) => model.provider === target.provider && model.id === target.id);
		if (targets.length === 0) throw new Error("Unknown, unavailable or ineligible context target");
		const bom = source?.startsWith("\uFEFF") ? "\uFEFF" : "";
		let next = source === undefined ? EMPTY_CONFIG : source.slice(bom.length);
		for (const model of targets) next = patch(next, overridePath(model), contextWindow);
		if (bom + next !== source) {
			writeModelsFile(path, bom + next);
			await runtime.refresh({ allowNetwork: false });
			publishContextChange?.();
		}
		return listSettings(runtime, parseConfig(bom + next));
	});
}
