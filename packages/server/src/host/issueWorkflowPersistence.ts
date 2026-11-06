import { createHash } from "node:crypto";
import {
	closeSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { type IssueReference, isIssueReference } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	approvalPublication,
	implementationVersion,
	type WorkflowPersistence,
	type WorkflowRecord,
} from "../issues";

const maxBytes = 16384;
const maxRevisions = 10000;
function stop(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue workflow requires reconciliation.");
}
function object(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}
function shape(
	value: Record<string, unknown>,
	required: string[],
	optional: string[] = [],
): boolean {
	return (
		required.every((k) => Object.hasOwn(value, k)) &&
		Reflect.ownKeys(value).every(
			(k) => typeof k === "string" && [...required, ...optional].includes(k),
		)
	);
}
function integer(value: unknown, min: number): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}
function reference(value: unknown): IssueReference {
	if (
		!object(value) ||
		!shape(value, ["provider", "instanceUrl", "projectId", "number"]) ||
		!isIssueReference(value) ||
		value.instanceUrl.length > 2048 ||
		!/^[1-9][0-9]{0,15}$/.test(value.projectId) ||
		!Number.isSafeInteger(Number(value.projectId)) ||
		/[\s\\]/.test(value.instanceUrl)
	)
		stop();
	const url = new URL(value.instanceUrl);
	// URL parsing can discard empty credential/query/fragment delimiters; reject those too.
	if (/[?#@]/.test(value.instanceUrl)) stop();
	return {
		provider: value.provider,
		instanceUrl: url.href.replace(/\/$/, ""),
		projectId: value.projectId,
		number: value.number,
	};
}
function version(value: unknown, stage: "design" | "implementation"): value is string {
	return typeof value === "string" && new RegExp(`^${stage}:[a-f0-9]{64}$`).test(value);
}
const pendingStages = {
	"publish-design": "design",
	"approve-design": "design",
	"publish-implementation": "implementation",
	"approve-implementation": "implementation",
} as const;
type PendingOperation = keyof typeof pendingStages;
function pendingOperation(value: unknown): value is PendingOperation {
	return typeof value === "string" && Object.hasOwn(pendingStages, value);
}
function receipt(value: unknown, stage: "design" | "implementation"): void {
	if (
		!object(value) ||
		!shape(
			value,
			["publication", "resetConfirmedAbsent", "approved"],
			stage === "implementation" ? ["designVersion", "commit"] : [],
		) ||
		value.resetConfirmedAbsent !== true ||
		typeof value.approved !== "boolean"
	)
		stop();
	const p = value.publication;
	if (
		!object(p) ||
		!shape(p, ["stage", "version", "noteId", "resetEventId", "body"]) ||
		p.stage !== stage ||
		!version(p.version, stage) ||
		!integer(p.noteId, 1) ||
		!integer(p.resetEventId, 0)
	)
		stop();
	if (
		p.body !==
		approvalPublication({
			stage,
			version: p.version,
			noteId: p.noteId,
			resetEventId: p.resetEventId,
		}).body
	)
		stop();
	if (stage === "implementation") {
		if (
			!version(value.designVersion, "design") ||
			typeof value.commit !== "string" ||
			!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit) ||
			implementationVersion(value.commit, value.designVersion) !== p.version
		)
			stop();
	}
}
function record(value: unknown): WorkflowRecord {
	if (
		!object(value) ||
		!shape(value, ["revision"], ["design", "implementation", "pending"]) ||
		!integer(value.revision, 1) ||
		value.revision > maxRevisions
	)
		stop();
	if (Object.hasOwn(value, "design")) receipt(value.design, "design");
	if (Object.hasOwn(value, "implementation")) {
		receipt(value.implementation, "implementation");
		if (
			!object(value.design) ||
			!object(value.design.publication) ||
			!object(value.implementation) ||
			value.implementation.designVersion !== value.design.publication.version
		)
			stop();
	}
	if (Object.hasOwn(value, "pending")) {
		const p = value.pending;
		if (
			!object(p) ||
			!shape(p, ["operation", "version"]) ||
			!pendingOperation(p.operation) ||
			!version(p.version, pendingStages[p.operation])
		)
			stop();
	}
	return value as unknown as WorkflowRecord;
}
function syncDirectory(path: string): void {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		fsyncSync(fd);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (
			process.platform !== "win32" ||
			!["EISDIR", "EPERM", "EACCES", "EINVAL", "ENOTSUP"].includes(code ?? "")
		)
			throw error;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
function absent(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** Root must already exist on trusted local storage. No recovery, deletion or replay. */
export function createIssueWorkflowPersistence(root: string): WorkflowPersistence {
	const dir = resolve(root);
	function identity(input: unknown) {
		const ref = reference(input);
		const tuple = JSON.stringify([ref.provider, ref.instanceUrl, ref.projectId, ref.number]);
		return { ref, folder: join(dir, createHash("sha256").update(tuple).digest("hex")) };
	}
	function load(ref: IssueReference, folder: string): WorkflowRecord | null {
		if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) stop();
		let entries: string[];
		try {
			const stat = lstatSync(folder);
			if (!stat.isDirectory() || stat.isSymbolicLink()) stop();
			entries = readdirSync(folder);
		} catch (error) {
			if (absent(error)) return null;
			throw error;
		}
		if (entries.length > maxRevisions || entries.some((name) => !/^[1-9][0-9]*\.json$/.test(name)))
			stop();
		entries.sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
		let latest: WorkflowRecord | null = null;
		for (let i = 0; i < entries.length; i++) {
			if (entries[i] !== `${i + 1}.json`) stop();
			const path = join(folder, `${i + 1}.json`);
			if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) stop();
			const fd = openSync(path, "r+");
			try {
				const stat = fstatSync(fd);
				if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) stop();
				const bytes = Buffer.alloc(maxBytes + 1);
				let length = 0;
				while (length < bytes.length) {
					const count = readSync(fd, bytes, length, bytes.length - length, null);
					if (!count) break;
					length += count;
				}
				if (length !== stat.size || length > maxBytes) stop();
				const envelope: unknown = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
				);
				if (
					!object(envelope) ||
					!shape(envelope, ["reference", "record"]) ||
					JSON.stringify(reference(envelope.reference)) !== JSON.stringify(ref)
				)
					stop();
				latest = record(envelope.record);
				if (latest.revision !== i + 1) stop();
				// A reader can observe complete bytes before the reserving writer flushes them.
				// Flush independently before treating that revision as durable/trusted.
				fsyncSync(fd);
			} finally {
				closeSync(fd);
			}
		}
		syncDirectory(folder);
		syncDirectory(dir);
		return latest;
	}
	return {
		async load(input) {
			try {
				const { ref, folder } = identity(input);
				return load(ref, folder);
			} catch {
				return stop();
			}
		},
		async compareAndSet(input, expected, next) {
			try {
				const { ref, folder } = identity(input);
				if (!integer(expected, 0) || expected >= maxRevisions) stop();
				const validated = record(next);
				if (validated.revision !== expected + 1) stop();
				const text = JSON.stringify({ reference: ref, record: validated });
				if (Buffer.byteLength(text) > maxBytes) stop();
				if ((load(ref, folder)?.revision ?? 0) !== expected) return false;
				try {
					mkdirSync(folder, { mode: 0o700 });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
				let fd: number;
				try {
					fd = openSync(join(folder, `${next.revision}.json`), "wx", 0o600);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					// Never turn a torn/reserved revision into an ordinary CAS miss.
					load(ref, folder);
					return false;
				}
				try {
					writeFileSync(fd, text);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				syncDirectory(folder);
				syncDirectory(dir);
				return true;
			} catch {
				return stop();
			}
		},
	};
}
