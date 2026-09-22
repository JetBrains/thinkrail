import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import {
	type CapturedFileRef,
	canonicalJson,
	DagError,
	type DagState,
	type DagSummary,
	decodeState,
	fail,
	LIMITS,
	type StoredFile,
} from "../domain/index.ts";
import {
	canonicalRoot,
	digest,
	directory,
	guarded,
	hasCode,
	json,
	publishExclusive,
	readRegular,
	regularHint,
	removeTemp,
	safeId,
	storageError,
	syncDirectory,
	writeTemp,
} from "./files.ts";
import { acquire, assertOwner, type Ownership, ownerStatus, relinquish } from "./ownership.ts";

export interface DagStore {
	claim(dagId: string): Promise<DagLease>;
	ownerStatus(dagId: string): Promise<"held" | "inactive">;
	read(dagId: string): Promise<DagState | undefined>;
	list(): Promise<DagSummary[]>;
	put(dagId: string, bytes: string | Uint8Array, maxBytes?: number): Promise<StoredFile>;
	load(dagId: string, file: StoredFile): Promise<Uint8Array>;
	reference(dagId: string, file: StoredFile): CapturedFileRef;
}

export interface DagLease {
	readonly dagId: string;
	save(
		state: DagState,
		expectedVersion: number | undefined,
		beforePublish?: () => void,
	): Promise<void>;
	release(): Promise<void>;
}

function storedFile(file: StoredFile): StoredFile {
	if (!file || typeof file.artifactId !== "string") fail("corrupt-state", "Invalid captured file");
	const { artifactId, sha256, sizeBytes } = file;
	if (
		artifactId.length !== 64 ||
		!/^[a-f0-9]{64}$/.test(artifactId) ||
		artifactId !== sha256 ||
		!Number.isSafeInteger(sizeBytes) ||
		sizeBytes < 0 ||
		sizeBytes > LIMITS.historyBytes
	) {
		fail("corrupt-state", "Invalid captured file identity or size");
	}
	return { artifactId, sha256, sizeBytes };
}

async function readPayload(path: string, file: StoredFile): Promise<Uint8Array> {
	const bytes = await readRegular(path, file.sizeBytes);
	if (bytes === undefined || bytes.byteLength !== file.sizeBytes || digest(bytes) !== file.sha256) {
		fail("corrupt-state", "Missing or corrupt captured payload");
	}
	return bytes;
}

async function readSnapshot(
	dir: string,
	scope: string,
	dagId: string,
): Promise<DagState | undefined> {
	if (!(await directory(dir))) return undefined;
	const bytes = await readRegular(join(dir, "state.json"));
	if (bytes === undefined) return undefined;
	const state = decodeState(json(bytes));
	if (state.scope !== scope || state.dagId !== dagId)
		fail("corrupt-state", "Snapshot scope or DAG identity mismatch");
	return state;
}

class Lease implements DagLease {
	private closed = false;
	private saving: Promise<void> | undefined;
	private releasing: Promise<void> | undefined;
	private readonly pending = new Set<Promise<unknown>>();

	constructor(
		readonly dagId: string,
		private readonly scope: string,
		private readonly dir: string,
		readonly ownership: Ownership,
	) {}

	admit<T>(operation: () => Promise<T>): Promise<T> {
		if (this.closed)
			return Promise.reject(
				new DagError({ code: "resource-in-use", message: "DAG lease is closing or released" }),
			);
		const pending = guarded(operation);
		this.pending.add(pending);
		void pending.then(
			() => this.pending.delete(pending),
			() => this.pending.delete(pending),
		);
		return pending;
	}

	save(
		state: DagState,
		expectedVersion: number | undefined,
		beforePublish?: () => void,
	): Promise<void> {
		if (this.saving)
			return Promise.reject(
				new DagError({ code: "resource-in-use", message: "Another snapshot save is pending" }),
			);
		const pending = this.admit(async () => {
			const bytes = canonicalJson(decodeState(state));
			const snapshot = decodeState(JSON.parse(bytes));
			if (snapshot.scope !== this.scope || snapshot.dagId !== this.dagId)
				fail("corrupt-state", "Snapshot scope or DAG identity mismatch");
			await assertOwner(this.ownership);
			const current = await readSnapshot(this.dir, this.scope, this.dagId);
			if (current?.version !== expectedVersion || snapshot.version !== (expectedVersion ?? 0) + 1) {
				throw new DagError({
					code: "stale-version",
					message: "Snapshot version does not match the committed predecessor",
					...(current ? { currentVersion: current.version } : {}),
				});
			}
			const temporary = await writeTemp(this.dir, bytes);
			let replaced = false;
			let failure: DagError | undefined;
			try {
				await assertOwner(this.ownership);
				beforePublish?.();
				try {
					await rename(temporary, join(this.dir, "state.json"));
					replaced = true;
				} catch (error) {
					if (
						!["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EISDIR", "ENOTEMPTY", "EXDEV", "EROFS"].some(
							(code) => hasCode(error, code),
						)
					)
						fail("commit-unknown", "Snapshot replacement could not be confirmed");
					throw error;
				}
				await syncDirectory(this.dir);
			} catch (error) {
				failure = replaced
					? new DagError({ code: "commit-unknown", message: "Snapshot durability is unknown" })
					: storageError(error);
			}
			try {
				await removeTemp(temporary);
			} catch (error) {
				failure ??= replaced
					? new DagError({ code: "commit-unknown", message: "Committed snapshot cleanup failed" })
					: storageError(error);
			}
			if (failure) throw failure;
		});
		this.saving = pending;
		void pending.then(
			() => {
				this.saving = undefined;
			},
			() => {
				this.saving = undefined;
			},
		);
		return pending;
	}

	release(): Promise<void> {
		if (this.releasing) return this.releasing;
		this.closed = true;
		const pending = [...this.pending];
		this.releasing = guarded(async () => {
			await Promise.allSettled(pending);
			await relinquish(this.ownership);
		});
		return this.releasing;
	}
}

export function createDagStore(options: { storageRoot: string; scope: string }): DagStore {
	const { scope } = options;
	const root = join(canonicalRoot(options.storageRoot), digest(scope));
	const leases = new Map<string, Lease>();
	const dagDirectory = (dagId: string) => {
		safeId(dagId);
		return join(root, dagId);
	};
	return {
		ownerStatus(dagId) {
			return guarded(() => ownerStatus(join(dagDirectory(dagId), "owners")));
		},
		claim(dagId) {
			return guarded(async () => {
				const dir = dagDirectory(dagId);
				const ownership = await acquire(join(dir, "owners"));
				const lease = new Lease(dagId, scope, dir, ownership);
				leases.set(dagId, lease);
				return lease;
			});
		},
		read(dagId) {
			return guarded(() => readSnapshot(dagDirectory(dagId), scope, dagId));
		},
		list() {
			return guarded(async () => {
				if (!(await directory(root))) return [];
				const summaries: DagSummary[] = [];
				for (const dagId of (await readdir(root)).sort()) {
					safeId(dagId, "corrupt-state");
					const state = await readSnapshot(dagDirectory(dagId), scope, dagId);
					if (!state) continue;
					const {
						dagId: id,
						title,
						version,
						graphRevision,
						mode,
						lifecycle,
						createdAt,
						updatedAt,
					} = state;
					summaries.push({
						dagId: id,
						title,
						version,
						graphRevision,
						mode,
						lifecycle,
						createdAt,
						updatedAt,
					});
				}
				return summaries;
			});
		},
		put(dagId, input, maxBytes = LIMITS.valueBytes) {
			return guarded(async () => {
				const dir = dagDirectory(dagId);
				if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > LIMITS.historyBytes)
					fail("limit-exceeded", "Invalid payload byte limit");
				const length = typeof input === "string" ? Buffer.byteLength(input) : input.byteLength;
				if (length > maxBytes) fail("limit-exceeded", "Captured payload exceeds its byte limit");
				const bytes =
					typeof input === "string" ? new TextEncoder().encode(input) : Uint8Array.from(input);
				const sha256 = digest(bytes);
				const file: StoredFile = { artifactId: sha256, sha256, sizeBytes: bytes.byteLength };
				const lease = leases.get(dagId);
				if (!lease) fail("resource-in-use", "Payload writes require this store's DAG lease");
				return lease.admit(async () => {
					await assertOwner(lease.ownership);
					const payloads = join(dir, "payloads");
					await directory(payloads, true);
					const path = join(payloads, file.artifactId);
					await assertOwner(lease.ownership);
					if (!(await publishExclusive(path, bytes))) {
						await readPayload(path, file);
						await syncDirectory(payloads);
					}
					return file;
				});
			});
		},
		load(dagId, input) {
			return guarded(async () => {
				const file = storedFile(input);
				const payloads = join(dagDirectory(dagId), "payloads");
				if (!(await directory(payloads))) fail("corrupt-state", "Missing payload directory");
				return readPayload(join(payloads, file.artifactId), file);
			});
		},
		reference(dagId, input) {
			try {
				const file = storedFile(input);
				const localPath = join(dagDirectory(dagId), "payloads", file.artifactId);
				try {
					regularHint(localPath, file.sizeBytes);
				} catch (error) {
					if (hasCode(error, "ENOENT") || hasCode(error, "ELOOP"))
						fail("corrupt-state", "Missing or symlinked captured payload");
					throw error;
				}
				return { ...file, localPath };
			} catch (error) {
				throw storageError(error);
			}
		},
	};
}
