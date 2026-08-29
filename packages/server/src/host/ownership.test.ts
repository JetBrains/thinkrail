import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquireHostOwnership,
	HostAlreadyRunningError,
	HostOwnershipUnavailableError,
	hostOwnershipCandidates,
} from "./ownership";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.close();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const path = mkdtempSync(join(tmpdir(), "thinkrail-ownership-"));
	roots.push(path);
	return path;
}

function listen(server: Server, port: number): Promise<void> {
	servers.push(server);
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
	});
}

test("refuses a second owner and releases on close", async () => {
	const path = join(root(), "data");
	const first = await acquireHostOwnership(path);
	await expect(acquireHostOwnership(path)).rejects.toBeInstanceOf(HostAlreadyRunningError);
	await first.release();
	const second = await acquireHostOwnership(path);
	await second.release();
});

test("canonical aliases identify the same data directory", async () => {
	const base = root();
	const target = join(base, "target");
	const alias = join(base, "alias");
	mkdirSync(target);
	symlinkSync(target, alias, "dir");
	const first = await acquireHostOwnership(target);
	await expect(acquireHostOwnership(alias)).rejects.toBeInstanceOf(HostAlreadyRunningError);
	await first.release();
});

test("different owners advance after a deterministic candidate collision", async () => {
	const base = root();
	const byPort = new Map<number, string>();
	let collision: [string, string] | undefined;
	for (let index = 0; index < 20_000 && !collision; index += 1) {
		const path = join(base, `data-${index}`);
		const port = hostOwnershipCandidates(path).ports[0];
		if (port === undefined) throw new Error("ownership candidate is missing");
		const prior = byPort.get(port);
		if (prior) collision = [prior, path];
		else byPort.set(port, path);
	}
	if (!collision) throw new Error("could not find an ownership collision");
	const first = await acquireHostOwnership(collision[0]);
	const second = await acquireHostOwnership(collision[1]);
	expect(second.port).not.toBe(first.port);
	await second.release();
	await first.release();
});

test("fails closed when the first candidate is unresponsive", async () => {
	const path = join(root(), "data");
	const port = hostOwnershipCandidates(path).ports[0];
	if (port === undefined) throw new Error("ownership candidate is missing");
	await listen(
		createServer(() => {}),
		port,
	);
	await expect(acquireHostOwnership(path)).rejects.toBeInstanceOf(HostOwnershipUnavailableError);
});
