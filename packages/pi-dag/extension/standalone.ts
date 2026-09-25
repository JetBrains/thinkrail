import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type ExtensionFactory, getAgentDir } from "@earendil-works/pi-coding-agent";
import { createDelegationService } from "pi-delegation";
import type { DagService } from "../domain/index.ts";
import { createDagService } from "../runtime/index.ts";
import { installDagAdapter } from "./adapter.ts";

const registryKey = Symbol.for("pi-dag.standalone-owners");
const registryVersion = 1;
interface Registry {
	version: typeof registryVersion;
	owners: Map<string, DagService>;
	closing?: Promise<void>;
}
const processState = globalThis as typeof globalThis & { [registryKey]?: unknown };

function registry(): Registry {
	const existing = processState[registryKey];
	if (existing === undefined) {
		const created: Registry = { version: registryVersion, owners: new Map() };
		processState[registryKey] = created;
		return created;
	}
	if (
		typeof existing !== "object" ||
		existing === null ||
		!("version" in existing) ||
		existing.version !== registryVersion ||
		!("owners" in existing) ||
		!(existing.owners instanceof Map) ||
		("closing" in existing && !(existing.closing instanceof Promise)) ||
		[...existing.owners].some(
			([key, service]) =>
				typeof key !== "string" ||
				!service ||
				typeof service.bind !== "function" ||
				typeof service.close !== "function",
		)
	)
		throw new Error("Incompatible pi-dag standalone owner registry; restart the process");
	return existing as Registry;
}

function canonical(path: string): string {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
		if (lstatSync(absolute, { throwIfNoEntry: false })) throw error;
		const parent = dirname(absolute);
		if (parent === absolute) throw error;
		return join(canonical(parent), basename(absolute));
	}
}

function standaloneService(cwd: string): DagService {
	const state = registry();
	if (state.closing) throw new Error("DAG standalone owners are closing");
	const agentRoot = canonical(getAgentDir());
	const workspace = canonical(cwd);
	const key = JSON.stringify([agentRoot, workspace]);
	const existing = state.owners.get(key);
	if (existing) return existing;
	const scope = createHash("sha256").update(workspace).digest("hex");
	const service = createDagService({
		storageRoot: join(agentRoot, "dags"),
		scope,
		delegation: createDelegationService({ delegationRoot: join(agentRoot, "delegation"), scope }),
	});
	state.owners.set(key, service);
	return service;
}

async function closeStandalone(): Promise<void> {
	if (processState[registryKey] === undefined) return;
	const state = registry();
	state.closing ??= Promise.resolve().then(async () => {
		const results = await Promise.allSettled(
			[...state.owners.values()].map((owner) => owner.close()),
		);
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				"DAG standalone shutdown failed",
			);
		state.owners.clear();
		delete processState[registryKey];
	});
	await state.closing;
}

const standalone: ExtensionFactory = (pi) =>
	installDagAdapter(pi, (ctx) => standaloneService(ctx.cwd), undefined, closeStandalone);

export default standalone;
