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
import {
	canonicalIssueInstanceUrl,
	type IssueReference,
	isIssueReference,
	isLocalePreference,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

export interface IssueSessionAssociation {
	sessionId: string;
	workspaceId: string;
	projectId: string;
	reference: IssueReference;
	stage: "design" | "implementation";
	/** Effective canonical BCP-47 locale, never the unresolved system preference. */
	locale: string;
}

const maxBytes = 16384;
const maxSummaries = 1000;
function stop(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue session requires reconciliation.");
}
function hash(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}
function id(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
function operationID(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype &&
		Reflect.ownKeys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
function reference(value: unknown): IssueReference {
	if (
		!exact(value, ["provider", "instanceUrl", "projectId", "number"]) ||
		!isIssueReference(value) ||
		value.instanceUrl.length > 2048 ||
		/[\s\\?#@]/.test(value.instanceUrl) ||
		!/^[1-9][0-9]{0,15}$/.test(value.projectId) ||
		!Number.isSafeInteger(Number(value.projectId))
	)
		stop();
	const instanceUrl = canonicalIssueInstanceUrl(value.instanceUrl);
	if (instanceUrl === null) stop();
	return {
		provider: value.provider,
		instanceUrl,
		projectId: value.projectId,
		number: value.number,
	};
}
function association(value: unknown): IssueSessionAssociation {
	if (
		!exact(value, ["sessionId", "workspaceId", "projectId", "reference", "stage", "locale"]) ||
		!id(value.sessionId) ||
		!id(value.workspaceId) ||
		!id(value.projectId) ||
		!["design", "implementation"].includes(value.stage as string) ||
		typeof value.locale !== "string" ||
		value.locale.length > 35 ||
		value.locale === "system" ||
		!isLocalePreference(value.locale)
	)
		stop();
	return {
		sessionId: value.sessionId,
		workspaceId: value.workspaceId,
		projectId: value.projectId,
		reference: reference(value.reference),
		stage: value.stage as IssueSessionAssociation["stage"],
		locale: value.locale,
	};
}
function absent(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function directory(path: string): void {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isDirectory()) stop();
}
function flushDirectory(path: string): void {
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

/** Existing private trusted root only. No credentials, recovery, replay or agent dispatch. */
export function createIssueSessionStore(root: string) {
	const dir = resolve(root);
	function folder(sessionId: string): string {
		if (!id(sessionId)) stop();
		directory(dir);
		return join(dir, hash(sessionId));
	}
	function read(path: string): unknown | null {
		try {
			const stat = lstatSync(path);
			if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0 || stat.size > maxBytes)
				stop();
			const fd = openSync(path, "r+");
			try {
				const current = fstatSync(fd);
				if (!current.isFile() || current.size === 0 || current.size > maxBytes) stop();
				const bytes = Buffer.alloc(maxBytes + 1);
				let length = 0;
				while (length < bytes.length) {
					const n = readSync(fd, bytes, length, bytes.length - length, null);
					if (!n) break;
					length += n;
				}
				if (length !== current.size || length > maxBytes) stop();
				const result: unknown = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
				);
				fsyncSync(fd);
				return result;
			} finally {
				closeSync(fd);
			}
		} catch (error) {
			if (absent(error)) return null;
			stop();
		}
	}
	function write(path: string, value: unknown, parent: string): void {
		const text = JSON.stringify(value);
		if (Buffer.byteLength(text) > maxBytes) stop();
		// Exclusive immutable creation IS the commit/reservation. Never unlink, including on failure.
		const fd = openSync(path, "wx", 0o600);
		try {
			writeFileSync(fd, text);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		flushDirectory(parent);
		flushDirectory(dir);
	}
	function load(sessionId: string): { binding: IssueSessionAssociation; path: string } | null {
		const path = folder(sessionId);
		try {
			directory(path);
		} catch (error) {
			if (absent(error)) return null;
			throw error;
		}
		const raw = read(join(path, "bind.json"));
		if (raw === null) stop();
		const binding = association(raw);
		if (binding.sessionId !== sessionId) stop();
		flushDirectory(path);
		flushDirectory(dir);
		return { binding, path };
	}
	function required(sessionId: string) {
		const loaded = load(sessionId);
		if (!loaded) stop();
		return loaded;
	}
	function marker(path: string, sessionId: string): boolean {
		const raw = read(path);
		if (raw === null) return false;
		if (!exact(raw, ["sessionId"]) || raw.sessionId !== sessionId) stop();
		return true;
	}
	async function guarded<T>(run: () => T | Promise<T>): Promise<T> {
		try {
			return await run();
		} catch {
			return stop();
		}
	}
	return {
		bind(input: IssueSessionAssociation): Promise<IssueSessionAssociation> {
			return guarded(() => {
				const binding = association(input);
				const previous = load(binding.sessionId);
				if (previous) {
					if (JSON.stringify(previous.binding) !== JSON.stringify(binding)) stop();
					return previous.binding;
				}
				const path = folder(binding.sessionId);
				try {
					mkdirSync(path, { mode: 0o700 });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
				directory(path);
				try {
					write(join(path, "bind.json"), binding, path);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
					const winner = required(binding.sessionId);
					if (JSON.stringify(winner.binding) !== JSON.stringify(binding)) stop();
				}
				return binding;
			});
		},
		get(sessionId: string): Promise<IssueSessionAssociation | null> {
			return guarded(() => load(sessionId)?.binding ?? null);
		},
		reserveStartup(sessionId: string): Promise<boolean> {
			return guarded(() => {
				const { path } = required(sessionId);
				if (marker(join(path, "startup.completed"), sessionId)) {
					flushDirectory(path);
					flushDirectory(dir);
					return false;
				}
				if (read(join(path, "startup.pending")) !== null) stop();
				write(join(path, "startup.pending"), { sessionId }, path);
				return true;
			});
		},
		/** Caller invokes only after the initial message was accepted; no agent is called here. */
		completeStartup(sessionId: string): Promise<void> {
			return guarded(() => {
				const { path } = required(sessionId);
				if (marker(join(path, "startup.completed"), sessionId)) {
					flushDirectory(path);
					flushDirectory(dir);
					return;
				}
				if (!marker(join(path, "startup.pending"), sessionId)) stop();
				write(join(path, "startup.completed"), { sessionId }, path);
			});
		},
		async recordSummary(
			sessionId: string,
			operationId: string,
			body: string,
			send: () => Promise<number>,
		): Promise<number> {
			const intent = await guarded(() => {
				const { path } = required(sessionId);
				if (
					!operationID(operationId) ||
					typeof body !== "string" ||
					body.length === 0 ||
					Buffer.byteLength(body) > 131072 ||
					typeof send !== "function"
				)
					stop();
				const digest = hash(body);
				const entries = readdirSync(path);
				if (
					entries.length > maxSummaries * 2 + 3 ||
					entries.some(
						(name) =>
							!["bind.json", "startup.pending", "startup.completed"].includes(name) &&
							!/^[1-9][0-9]*\.(intent|completed)$/.test(name),
					)
				)
					stop();
				const intents = entries.filter((name) => name.endsWith(".intent"));
				let confirmed: number | undefined;
				for (let n = 1; n <= intents.length; n++) {
					const pending = read(join(path, `${n}.intent`));
					if (
						!exact(pending, ["sessionId", "operationId", "digest"]) ||
						pending.sessionId !== sessionId ||
						!operationID(pending.operationId) ||
						typeof pending.digest !== "string" ||
						!/^[a-f0-9]{64}$/.test(pending.digest)
					)
						stop();
					const completed = read(join(path, `${n}.completed`));
					if (
						!exact(completed, ["sessionId", "operationId", "digest", "noteId"]) ||
						completed.sessionId !== sessionId ||
						completed.operationId !== pending.operationId ||
						completed.digest !== pending.digest ||
						typeof completed.noteId !== "number" ||
						!Number.isSafeInteger(completed.noteId) ||
						completed.noteId < 1
					)
						stop();
					if (pending.operationId === operationId) {
						if (pending.digest !== digest || confirmed !== undefined) stop();
						confirmed = completed.noteId;
					}
				}
				if (
					entries.filter((name) => /^[1-9][0-9]*\.completed$/.test(name)).length !== intents.length
				)
					stop();
				flushDirectory(path);
				flushDirectory(dir);
				if (confirmed !== undefined) return { confirmed };
				if (intents.length >= maxSummaries) stop();
				const pending = { sessionId, operationId, digest };
				const revision = intents.length + 1;
				write(join(path, `${revision}.intent`), pending, path);
				return { path, revision, pending };
			});
			if (intent.confirmed !== undefined) return intent.confirmed;
			// Exactly one attempt, outside guarded: provider errors may propagate, intent always remains.
			const noteId = await send();
			return guarded(() => {
				if (!Number.isSafeInteger(noteId) || noteId < 1 || !intent.path || !intent.pending) stop();
				directory(dir);
				directory(intent.path);
				write(
					join(intent.path, `${intent.revision}.completed`),
					{ ...intent.pending, noteId },
					intent.path,
				);
				return noteId;
			});
		},
	};
}

export type IssueSessionStore = ReturnType<typeof createIssueSessionStore>;
