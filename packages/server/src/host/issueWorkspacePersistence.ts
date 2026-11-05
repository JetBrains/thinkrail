import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	openSync,
	readSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { type IssueReference, isIssueReference } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueWorkspaceRecord } from "../issues";

const maxBytes = 16384;
function stop(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue workspace requires reconciliation.");
}
function object(value: unknown): value is Record<string, unknown> {
	return (
		value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
	);
}
function shape(value: Record<string, unknown>, required: string[], optional: string[] = []) {
	return (
		required.every((k) => Object.hasOwn(value, k)) &&
		Reflect.ownKeys(value).every(
			(k) => typeof k === "string" && [...required, ...optional].includes(k),
		)
	);
}
function id(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(value) &&
		value !== "." &&
		value !== ".."
	);
}
function reference(value: unknown): IssueReference {
	if (
		!object(value) ||
		!shape(value, ["provider", "instanceUrl", "projectId", "number"]) ||
		!isIssueReference(value) ||
		value.instanceUrl.length > 2048 ||
		/[\s\\?#@]/.test(value.instanceUrl) ||
		!/^[1-9][0-9]{0,15}$/.test(value.projectId) ||
		!Number.isSafeInteger(Number(value.projectId))
	)
		stop();
	// Require the coordinator's key to describe exactly the canonical binding.
	if (new URL(value.instanceUrl).href.replace(/\/$/, "") !== value.instanceUrl) stop();
	return {
		provider: value.provider,
		instanceUrl: value.instanceUrl,
		projectId: value.projectId,
		number: value.number,
	};
}
function keyFor(projectId: string, ref: IssueReference) {
	return JSON.stringify([projectId, ref.provider, ref.instanceUrl, ref.projectId, ref.number]);
}
function record(value: unknown, expected: string): IssueWorkspaceRecord {
	if (
		!object(value) ||
		!shape(value, ["projectId", "reference"], ["design", "implementation", "sessionPending"]) ||
		!id(value.projectId) ||
		keyFor(value.projectId, reference(value.reference)) !== expected
	)
		stop();
	if (Object.hasOwn(value, "design")) {
		const d = value.design;
		if (
			!object(d) ||
			!shape(d, ["workspaceId"], ["sessionId"]) ||
			!id(d.workspaceId) ||
			(Object.hasOwn(d, "sessionId") && !id(d.sessionId))
		)
			stop();
	}
	if (Object.hasOwn(value, "implementation")) {
		const i = value.implementation;
		if (
			!object(i) ||
			!["pending", "completed"].includes(String(i.state)) ||
			!shape(
				i,
				["state", "worktreePath", "branch", ...(i.state === "completed" ? ["workspaceId"] : [])],
				i.state === "completed" ? ["session"] : [],
			)
		)
			stop();
		if (
			typeof i.worktreePath !== "string" ||
			i.worktreePath.length > 4096 ||
			[...i.worktreePath].some((character) => {
				const code = character.charCodeAt(0);
				return code < 32 || code === 127;
			}) ||
			!isAbsolute(i.worktreePath) ||
			resolve(i.worktreePath) !== i.worktreePath ||
			typeof i.branch !== "string" ||
			i.branch.length > 255 ||
			!/^issue-[1-9][0-9]*-[A-Za-z0-9-]+$/.test(i.branch) ||
			!i.branch.startsWith(`issue-${reference(value.reference).number}-`)
		)
			stop();
		if (i.state === "completed" && !id(i.workspaceId)) stop();
		if (Object.hasOwn(i, "session")) {
			const s = i.session;
			if (!object(s) || !shape(s, ["id"]) || !id(s.id)) stop();
		}
	}
	if (Object.hasOwn(value, "sessionPending")) {
		const p = value.sessionPending;
		if (!object(p) || !shape(p, ["stage", "workspaceId"]) || !id(p.workspaceId)) stop();
		if (p.stage === "design") {
			if (!object(value.design) || p.workspaceId !== value.design.workspaceId) stop();
		} else if (p.stage === "implementation") {
			if (
				!object(value.implementation) ||
				value.implementation.state !== "completed" ||
				p.workspaceId !== value.implementation.workspaceId
			)
				stop();
		} else stop();
	}
	return value as unknown as IssueWorkspaceRecord;
}
function syncDirectory(path: string) {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		fsyncSync(fd);
	} catch (error) {
		if (
			process.platform !== "win32" ||
			!["EISDIR", "EPERM", "EACCES", "EINVAL", "ENOTSUP"].includes(
				(error as NodeJS.ErrnoException).code ?? "",
			)
		)
			throw error;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
function hash(key: string) {
	return createHash("sha256").update(key).digest("hex");
}

export interface IssueWorkspacePersistencePorts {
	load(key: string): Promise<IssueWorkspaceRecord | null>;
	save(key: string, record: IssueWorkspaceRecord): Promise<void>;
}

/** The callback wraps the entire coordinator operation, including its first load and every side effect. */
export function createIssueWorkspacePersistence(root: string) {
	const dir = resolve(root);
	function directory() {
		const stat = lstatSync(dir);
		if (!stat.isDirectory() || stat.isSymbolicLink()) stop();
	}
	return {
		async withLaunch<T>(
			projectId: string,
			input: IssueReference,
			operation: (ports: IssueWorkspacePersistencePorts) => Promise<T>,
			beforeRelease?: () => void,
		): Promise<T> {
			let active = true;
			let poisoned = false;
			try {
				if (!id(projectId)) stop();
				const ref = reference(input);
				const expected = keyFor(projectId, ref);
				directory();
				const lock = join(dir, `${hash(JSON.stringify([projectId, ref.number]))}.lock`);
				const fd = openSync(lock, "wx", 0o600);
				try {
					writeFileSync(fd, JSON.stringify({ projectId, number: ref.number }));
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				syncDirectory(dir);
				const path = join(dir, `${hash(expected)}.json`);
				function check(key: string) {
					if (!active || poisoned || key !== expected) stop();
					directory();
				}
				function load(): IssueWorkspaceRecord | null {
					let stat: ReturnType<typeof lstatSync>;
					try {
						stat = lstatSync(path);
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
						throw error;
					}
					if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > maxBytes)
						stop();
					const fd = openSync(path, "r");
					try {
						const opened = fstatSync(fd);
						if (!opened.isFile() || opened.size !== stat.size) stop();
						const bytes = Buffer.alloc(maxBytes + 1);
						let length = 0;
						while (length < bytes.length) {
							const count = readSync(fd, bytes, length, bytes.length - length, null);
							if (!count) break;
							length += count;
						}
						if (length !== opened.size || length > maxBytes) stop();
						return record(
							JSON.parse(
								new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
							),
							expected,
						);
					} finally {
						closeSync(fd);
					}
				}
				function guarded<R>(key: string, action: () => R): R {
					try {
						check(key);
						return action();
					} catch {
						poisoned = true;
						return stop();
					}
				}
				// Refuse a torn/foreign record even if a callback tries to overwrite it without loading.
				load();
				const result = await operation({
					async load(key) {
						return guarded(key, load);
					},
					async save(key, next) {
						guarded(key, () => {
							const text = JSON.stringify(record(next, expected));
							if (Buffer.byteLength(text) > maxBytes) stop();
							// Snapshot and validate the serialized form as well as the caller's shape.
							record(JSON.parse(text), expected);
							load();
							const temp = join(dir, `${hash(expected)}.${randomUUID()}.tmp`);
							let owned = false;
							try {
								const fd = openSync(temp, "wx", 0o600);
								owned = true;
								try {
									writeFileSync(fd, text);
									fsyncSync(fd);
								} finally {
									closeSync(fd);
								}
								renameSync(temp, path);
								owned = false;
								syncDirectory(dir);
							} finally {
								if (owned) unlinkSync(temp);
							}
						});
					},
				});
				if (poisoned) stop();
				active = false;
				// Flush all successful callback writes before releasing the reservation.
				syncDirectory(dir);
				// Point-in-time authorization after all awaits/flushes, before the release commit.
				beforeRelease?.();
				// Successful unlink commits release: no fallible work may follow it.
				// A crash may retain/reintroduce the unflushed fence (a safe false block).
				unlinkSync(lock);
				return result;
			} catch {
				return stop();
			} finally {
				active = false;
			}
		},
	};
}
