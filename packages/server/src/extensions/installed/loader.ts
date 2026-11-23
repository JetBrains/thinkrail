import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentSession, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import { Type } from "typebox";

const SINK = Symbol.for("thinkrail.extensionDescriptors");
const FORCED_JITI_ENV = {
	JITI_TRY_NATIVE: "false",
	JITI_REBUILD_FS_CACHE: "1",
	JITI_FS_CACHE: "false",
} as const;

interface Loaded {
	descriptor: unknown;
	createAgentSession: unknown;
	Type: unknown;
}

type Sink = Map<string, Loaded>;

function sink(): Sink {
	const global = globalThis as Record<symbol, Sink | undefined>;
	let map = global[SINK];
	if (!map) {
		map = new Map();
		global[SINK] = map;
	}
	return map;
}

/** How long extension code may take to load: an installed server half here, a user's pi extensions in `agent`. */
export const EXTENSION_LOAD_TIMEOUT_MS = 10_000;

function loadTimeoutError(timeoutMs: number): Error {
	return new Error(`the server entry did not finish loading within ${timeoutMs / 1000} s`);
}

/** Settles like `task`, or rejects with the load timeout; a late settle of `task` is observed, never thrown. */
function settleWithin<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(loadTimeoutError(timeoutMs)), timeoutMs);
		task.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

let jitiChain: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` with pi's jiti transform forced; the env is process-wide, so callers are serialized. With
 * `timeoutMs`, a task still running then is abandoned: the env is restored, the next caller runs and this
 * one rejects; the abandoned task's own settle changes nothing.
 */
export function withForcedJitiTransform<T>(task: () => Promise<T>, timeoutMs?: number): Promise<T> {
	const run = jitiChain.then(async () => {
		const prior = Object.fromEntries(
			Object.keys(FORCED_JITI_ENV).map((key) => [key, process.env[key]]),
		);
		Object.assign(process.env, FORCED_JITI_ENV);
		let restored = false;
		const restore = () => {
			if (restored) return;
			restored = true;
			for (const [key, value] of Object.entries(prior)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		};
		const work = (async () => {
			try {
				return await task();
			} finally {
				restore();
			}
		})();
		try {
			return await (timeoutMs === undefined ? work : settleWithin(work, timeoutMs));
		} finally {
			restore();
		}
	});
	jitiChain = run.catch(() => undefined);
	return run;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFunctionList = (value: unknown): boolean =>
	Array.isArray(value) && value.every((entry) => typeof entry === "function");

const BUILT_IN_ONLY_FIELDS = [
	"queries",
	"apiVersion",
	"supersedesPackages",
] as const satisfies readonly (keyof ServerExtension)[];

function shapeError(value: unknown): string | undefined {
	const notADescriptor = "its default export is not a defineServerExtension descriptor";
	if (!isRecord(value)) return notADescriptor;
	if (typeof value.name !== "string") return `${notADescriptor}: it has no "name"`;
	if (!isFunctionList(value.extensions)) {
		return `${notADescriptor}: "extensions" must be a list of factories`;
	}
	if (value.childExtensions !== undefined && !isFunctionList(value.childExtensions)) {
		return '"childExtensions" must be a list of factories';
	}
	if (value.sessionExtensions !== undefined && typeof value.sessionExtensions !== "function") {
		return '"sessionExtensions" must be a function';
	}
	for (const key of ["title", "description"] as const) {
		if (value[key] !== undefined && typeof value[key] !== "string") return `"${key}" must be text`;
	}
	for (const key of BUILT_IN_ONLY_FIELDS) {
		if (value[key] !== undefined) {
			return `"${key}" is not part of extension API 1.0: only a built-in extension declares it`;
		}
	}
	if (
		value.skillPackages !== undefined &&
		!(Array.isArray(value.skillPackages) && value.skillPackages.every((s) => typeof s === "string"))
	) {
		return '"skillPackages" must be a list of package names';
	}
	if (value.interactiveTools !== undefined) {
		if (!isRecord(value.interactiveTools)) return '"interactiveTools" must be an object';
		for (const tool of Object.values(value.interactiveTools)) {
			if (!isRecord(tool)) return '"interactiveTools" entries must be objects';
			if (tool.describeResponse !== undefined && typeof tool.describeResponse !== "function") {
				return '"describeResponse" must be a function';
			}
		}
	}
	if (value.settings !== undefined) {
		if (!isRecord(value.settings)) return '"settings" must be an object';
		for (const [key, setting] of Object.entries(value.settings)) {
			if (
				!isRecord(setting) ||
				setting.type !== "boolean" ||
				typeof setting.default !== "boolean"
			) {
				return `setting "${key}" must be { type: "boolean", default: true | false }`;
			}
			for (const copy of ["title", "description"] as const) {
				if (setting[copy] !== undefined && typeof setting[copy] !== "string") {
					return `setting "${key}" has a non-text ${copy}`;
				}
			}
		}
	}
	return undefined;
}

function shim(entry: string, key: string): string {
	return `import { readFileSync } from "node:fs";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
const entry = ${JSON.stringify(entry)};
const loaded = await require.evalModule(readFileSync(entry, "utf8"), { filename: entry, async: true, forceTranspile: true });
const descriptor = loaded?.default ?? loaded;
export default function thinkrailDescriptorShim() {
	const key = Symbol.for("thinkrail.extensionDescriptors");
	(globalThis[key] ??= new Map()).set(${JSON.stringify(key)}, { descriptor, createAgentSession, Type });
}
`;
}

let loads = 0;

export interface LoadServerDescriptorOptions {
	/** The pi the extension must resolve; the host's own unless a test says otherwise. */
	host?: { createAgentSession: unknown; Type: unknown };
	timeoutMs?: number;
}

/** Imports an installed server entry through pi's public loader, so its pi imports are the host's instance. */
export async function loadServerDescriptor(
	entry: string,
	hostDir: string,
	{
		host = { createAgentSession, Type },
		timeoutMs = EXTENSION_LOAD_TIMEOUT_MS,
	}: LoadServerDescriptorOptions = {},
): Promise<ServerExtension> {
	const sequence = ++loads;
	const key = `${entry}#${sequence}`;
	const empty = join(hostDir, "empty");
	const shimPath = join(hostDir, "shims", `${process.pid}-${sequence}.ts`);
	mkdirSync(empty, { recursive: true });
	mkdirSync(join(hostDir, "shims"), { recursive: true });
	writeFileSync(shimPath, shim(entry, key));
	let loaded: Loaded | undefined;
	let loading: Promise<unknown> | undefined;
	try {
		const { errors } = await withForcedJitiTransform(() => {
			const pending = discoverAndLoadExtensions([shimPath], empty, empty);
			loading = pending;
			return pending;
		}, timeoutMs);
		loaded = sink().get(key);
		if (errors.length > 0) throw new Error(errors.map((error) => error.error).join("\n"));
	} finally {
		sink().delete(key);
		rmSync(shimPath, { force: true });
		loading?.then(
			() => sink().delete(key),
			() => undefined,
		);
	}
	if (!loaded) throw new Error("the server entry did not finish loading");
	if (loaded.createAgentSession !== host.createAgentSession || loaded.Type !== host.Type) {
		throw new Error("the extension loader did not resolve pi to the host's own copy");
	}
	const problem = shapeError(loaded.descriptor);
	if (problem) throw new Error(problem);
	return loaded.descriptor as ServerExtension;
}
