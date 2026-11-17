import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentSession, discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import { Type } from "typebox";

const SINK = Symbol.for("thinkrail.extensionDescriptors");
const FORCED_JITI_ENV = { JITI_TRY_NATIVE: "false", JITI_REBUILD_FS_CACHE: "1" } as const;

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

let jitiChain: Promise<unknown> = Promise.resolve();

/** Runs `task` with pi's jiti transform forced; the env is process-wide, so callers are serialized. */
export function withForcedJitiTransform<T>(task: () => Promise<T>): Promise<T> {
	const run = jitiChain.then(async () => {
		const prior = Object.fromEntries(
			Object.keys(FORCED_JITI_ENV).map((key) => [key, process.env[key]]),
		);
		Object.assign(process.env, FORCED_JITI_ENV);
		try {
			return await task();
		} finally {
			for (const [key, value] of Object.entries(prior)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
	jitiChain = run.catch(() => undefined);
	return run;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFunctionList = (value: unknown): boolean =>
	Array.isArray(value) && value.every((entry) => typeof entry === "function");

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
	return `import descriptor from ${JSON.stringify(entry)};
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export default function thinkrailDescriptorShim() {
	const key = Symbol.for("thinkrail.extensionDescriptors");
	(globalThis[key] ??= new Map()).set(${JSON.stringify(key)}, { descriptor, createAgentSession, Type });
}
`;
}

let loads = 0;

/** Imports an installed server entry through pi's public loader, so its pi imports are the host's instance. */
export async function loadServerDescriptor(
	entry: string,
	hostDir: string,
	host: { createAgentSession: unknown; Type: unknown } = { createAgentSession, Type },
): Promise<ServerExtension> {
	const sequence = ++loads;
	const key = `${entry}#${sequence}`;
	const empty = join(hostDir, "empty");
	const shimPath = join(hostDir, "shims", `${process.pid}-${sequence}.ts`);
	mkdirSync(empty, { recursive: true });
	mkdirSync(join(hostDir, "shims"), { recursive: true });
	writeFileSync(shimPath, shim(entry, key));
	let loaded: Loaded | undefined;
	try {
		const { errors } = await withForcedJitiTransform(() =>
			discoverAndLoadExtensions([shimPath], empty, empty),
		);
		loaded = sink().get(key);
		if (errors.length > 0) throw new Error(errors.map((error) => error.error).join("\n"));
	} finally {
		sink().delete(key);
		rmSync(shimPath, { force: true });
	}
	if (!loaded) throw new Error("the server entry did not finish loading");
	if (loaded.createAgentSession !== host.createAgentSession || loaded.Type !== host.Type) {
		throw new Error("the extension loader did not resolve pi to the host's own copy");
	}
	const problem = shapeError(loaded.descriptor);
	if (problem) throw new Error(problem);
	return loaded.descriptor as ServerExtension;
}
