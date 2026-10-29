import {
	accessSync,
	constants,
	mkdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	type Stats,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type Node, type ParseError, parseTree } from "jsonc-parser";

export const MODELS_JSON_PARSE = { allowTrailingComma: true };
export const MODELS_JSON_FORMATTING = {
	formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
};
const EMPTY_MODELS_JSON = '{\n  "providers": {}\n}\n';
const SAVE_FAILURE =
	"Couldn't save pi's models.json. Check the file and its permissions, then retry.";

let publishChange: (() => void) | null = null;

export function setModelsFilePublisher(publisher: (() => void) | null): void {
	publishChange = publisher;
}

export function publishModelsFileChange(): void {
	publishChange?.();
}

export function modelsPath(): string {
	return join(getAgentDir(), "models.json");
}

export function readModelsSource(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw new Error("Couldn't read pi's models.json. Fix the file and retry.");
	}
}

export function parseModelsConfig(source: string | undefined): Node | undefined {
	if (source === undefined) return undefined;
	const errors: ParseError[] = [];
	const root = parseTree(source.replace(/^\uFEFF/, ""), errors, MODELS_JSON_PARSE);
	if (errors.length > 0)
		throw new Error("Pi's models.json isn't valid JSON. Fix the file and retry.");
	return root;
}

export function splitModelsSource(source: string | undefined): { bom: string; body: string } {
	if (source === undefined) return { bom: "", body: EMPTY_MODELS_JSON };
	const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
	return { bom, body: source.slice(bom.length) };
}

function resolveModelsFile(path: string): string {
	try {
		return realpathSync(path);
	} catch {}
	const seen = new Set<string>();
	let current = path;
	while (!seen.has(current)) {
		seen.add(current);
		try {
			current = resolve(dirname(current), readlinkSync(current));
		} catch {
			return current;
		}
	}
	throw new Error(SAVE_FAILURE);
}

export function writeModelsFile(path: string, source: string): void {
	const target = resolveModelsFile(path);
	let existing: Stats | undefined;
	try {
		existing = statSync(target);
	} catch {
		mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
	}
	const temp = join(dirname(target), `.models.json.${process.pid}.tmp`);
	try {
		if (existing) accessSync(target, constants.W_OK);
		writeFileSync(temp, source, { mode: existing ? existing.mode & 0o777 : 0o600 });
		renameSync(temp, target);
	} catch {
		rmSync(temp, { force: true });
		throw new Error(SAVE_FAILURE);
	}
}

let writes: Promise<unknown> = Promise.resolve();

export function serializeModelsWrite<T>(run: () => Promise<T>): Promise<T> {
	const next = writes.catch(() => undefined).then(run);
	writes = next;
	return next;
}
