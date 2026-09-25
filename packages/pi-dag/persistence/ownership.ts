import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { canonicalJson, fail } from "../domain/index.ts";
import { directory, hasCode, json, publishExclusive, readRegular } from "./files.ts";

interface Owner {
	schemaVersion: 1;
	host: string;
	pid: number;
	token: string;
}

export interface Ownership {
	directory: string;
	generation: number;
	owner: Owner;
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeOwner(value: unknown): Owner {
	if (
		!object(value) ||
		Object.keys(value).sort().join(",") !== "host,pid,schemaVersion,token" ||
		value.schemaVersion !== 1 ||
		typeof value.host !== "string" ||
		value.host.length === 0 ||
		typeof value.pid !== "number" ||
		!Number.isSafeInteger(value.pid) ||
		value.pid <= 0 ||
		value.pid > 2147483647 ||
		typeof value.token !== "string" ||
		value.token.length !== 64 ||
		!/^[a-f0-9]{64}$/.test(value.token)
	) {
		return fail("resource-in-use", "Malformed ownership record");
	}
	return { schemaVersion: 1, host: value.host, pid: value.pid, token: value.token };
}

async function record(path: string): Promise<unknown> {
	try {
		const bytes = await readRegular(path, 4096);
		if (bytes === undefined) return undefined;
		const value = json(bytes);
		if (Buffer.from(bytes).toString("utf8") !== canonicalJson(value))
			fail("resource-in-use", "Noncanonical or ambiguous ownership record");
		return value;
	} catch {
		return fail("resource-in-use", "Unreadable or ambiguous ownership record");
	}
}

async function head(dir: string): Promise<Ownership | undefined> {
	if (!(await directory(dir))) fail("resource-in-use", "Missing ownership directory");
	const names = await readdir(dir);
	const generations: number[] = [];
	const releases: number[] = [];
	for (const name of names) {
		if (name.length === 41 && /^\.tmp-[a-f0-9-]{36}$/.test(name)) continue;
		const match = /^([1-9][0-9]*)\.(json|released)$/.exec(name);
		if (!match || match[0] !== name) fail("resource-in-use", "Unknown ownership file");
		const generation = Number(match[1]);
		if (!Number.isSafeInteger(generation)) fail("resource-in-use", "Invalid ownership generation");
		(match[2] === "json" ? generations : releases).push(generation);
	}
	generations.sort((a, b) => a - b);
	if (
		generations.some((generation, index) => generation !== index + 1) ||
		releases.some((generation) => generation > generations.length)
	) {
		fail("resource-in-use", "Discontinuous ownership records");
	}
	const generation = generations.at(-1);
	if (generation === undefined) return undefined;
	const owner = decodeOwner(await record(join(dir, `${generation}.json`)));
	return { directory: dir, generation, owner };
}

async function released(ownership: Ownership): Promise<boolean> {
	const value = await record(join(ownership.directory, `${ownership.generation}.released`));
	if (value === undefined) return false;
	if (
		!object(value) ||
		Object.keys(value).sort().join(",") !== "schemaVersion,token" ||
		value.schemaVersion !== 1 ||
		value.token !== ownership.owner.token
	) {
		fail("resource-in-use", "Malformed ownership release");
	}
	return true;
}

function provenDead(owner: Owner): boolean {
	if (owner.host !== hostname()) return false;
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		return hasCode(error, "ESRCH");
	}
	return false;
}

export async function ownerStatus(dir: string): Promise<"held" | "inactive"> {
	if (!(await directory(dir))) return "inactive";
	const current = await head(dir);
	return !current || (await released(current)) || provenDead(current.owner) ? "inactive" : "held";
}

export async function acquire(dir: string): Promise<Ownership> {
	await directory(dir, true);
	const owner: Owner = {
		schemaVersion: 1,
		host: hostname(),
		pid: process.pid,
		token: randomBytes(32).toString("hex"),
	};
	for (;;) {
		const previous = await head(dir);
		if (previous && !(await released(previous)) && !provenDead(previous.owner))
			fail("resource-in-use", "Owner is live or its death cannot be proven");
		const generation = (previous?.generation ?? 0) + 1;
		if (!Number.isSafeInteger(generation))
			fail("resource-in-use", "Ownership generation exhausted");
		if (await publishExclusive(join(dir, `${generation}.json`), canonicalJson(owner))) {
			return { directory: dir, generation, owner };
		}
	}
}

export async function assertOwner(ownership: Ownership): Promise<void> {
	const current = await head(ownership.directory);
	if (
		!current ||
		current.generation !== ownership.generation ||
		canonicalJson(current.owner) !== canonicalJson(ownership.owner) ||
		(await released(current))
	) {
		fail("resource-in-use", "DAG ownership was lost or released");
	}
}

export async function relinquish(ownership: Ownership): Promise<void> {
	await assertOwner(ownership);
	const path = join(ownership.directory, `${ownership.generation}.released`);
	if (
		!(await publishExclusive(
			path,
			canonicalJson({ schemaVersion: 1, token: ownership.owner.token }),
		))
	) {
		fail("resource-in-use", "Ownership release already exists");
	}
}
