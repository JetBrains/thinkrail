import { randomBytes } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	type StatWatcher,
	statSync,
	unwatchFile,
	watchFile,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { InstalledExtensionState } from "@thinkrail/contracts";
import {
	EXTENSION_API_VERSION,
	type ExtensionManifest,
	extensionApiMismatch,
	hasExtensionManifest,
	parseExtensionManifest,
} from "@thinkrail/extension-api/installed";
import type { ServerExtension } from "@thinkrail/extension-api/server";
import { CodedError } from "@thinkrail/shared/codedError";
import { logger } from "../../log";
import {
	type DeclarationsRead,
	type ExtensionSourceKind,
	extensionSourceKind,
	folderOf,
	readDeclarations,
	writeDeclarations,
	writeJsonAtomic,
} from "./declarations";
import { type ExtensionInstaller, piExtensionInstaller } from "./installer";
import { loadServerDescriptor } from "./loader";

const log = logger("extensions");

export interface InstalledServerExtension {
	readonly extension: ServerExtension;
	readonly entry: string;
	readonly skillRoots: readonly string[];
}

export interface InstalledExtensionRecord {
	readonly source: string;
	readonly sourceKind: ExtensionSourceKind | undefined;
	readonly name: string;
	readonly title: string;
	readonly description?: string;
	readonly version?: string;
	readonly state: InstalledExtensionState;
	readonly error?: string;
	readonly root?: string;
	readonly manifest?: ExtensionManifest;
	readonly server?: InstalledServerExtension;
	readonly fingerprint?: string;
	readonly duplicateOf?: string;
}

export interface InstalledExtensionsOptions {
	dataDir: string;
	reservedNames: () => Iterable<string>;
	skillRoots: (entry: string, extension: ServerExtension) => string[];
	installer?: ExtensionInstaller;
	offline?: () => boolean;
	onChange?: () => void;
	toolNames?: (
		extension: ServerExtension,
	) => Promise<{ tools: readonly string[]; shadowed: readonly string[] }>;
	loadTimeoutMs?: number;
}

export type ExtensionStatusState = InstalledExtensionState | "installing";

export interface ExtensionStatusEntry {
	source: string;
	name?: string;
	version?: string;
	state: ExtensionStatusState;
	error?: string;
	tools?: string[];
	shadowed?: string[];
}

export interface ExtensionsStatus {
	api: string;
	updatedAt: string;
	declarations: string;
	fileError?: string;
	extensions: ExtensionStatusEntry[];
}

export interface StagedExtension {
	readonly source: string;
	readonly name: string;
	readonly install?: InstallRef;
}

interface InstallRef {
	dir: string;
	path: string;
}

type InstallsFile = Record<string, InstallRef>;

const UPDATE_CHECK_TTL_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 1_000;
const STATUS_TOOLS_TIMEOUT_MS = 2_000;

function isOffline(): boolean {
	const value = process.env.PI_OFFLINE?.toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

function readPackageJson(root: string): unknown {
	return JSON.parse(readFileSync(join(root, "package.json"), "utf8").replace(/^\uFEFF/, ""));
}

export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

function lastChanged(dir: string): number {
	try {
		return Math.max(
			statSync(dir).mtimeMs,
			...readdirSync(dir).map((entry) => lstatSync(join(dir, entry)).mtimeMs),
		);
	} catch {
		return Date.now();
	}
}

/** `root`'s package.json when it carries a `thinkrail` manifest, else `undefined`; never throws. */
function extensionPackageAt(root: string): unknown {
	try {
		const packageJson = readPackageJson(root);
		return hasExtensionManifest(packageJson) ? packageJson : undefined;
	} catch {
		return undefined;
	}
}

function statKey(path: string): string {
	try {
		const info = statSync(path);
		return `${info.mtimeMs}:${info.size}`;
	} catch {
		return "-";
	}
}

function fingerprintOf(root: string, manifest?: ExtensionManifest): string {
	const files = ["package.json", manifest?.server, manifest?.web, manifest?.styles];
	return files.map((file) => (file ? statKey(join(root, file)) : "")).join("|");
}

export class InstalledExtensions {
	readonly declarationsPath: string;
	readonly root: string;
	readonly #installsDir: string;
	readonly #installsPath: string;
	readonly #hostDir: string;
	readonly #statusPath: string;
	readonly #options: InstalledExtensionsOptions;
	readonly #installer: ExtensionInstaller;
	#records: readonly InstalledExtensionRecord[] = [];
	#servers: readonly InstalledServerExtension[] = [];
	#fileError: string | undefined;
	#chain: Promise<unknown> = Promise.resolve();
	#reconcileQueued: Promise<void> | undefined;
	readonly #pending = new Set<string>();
	readonly #codeRoots = new Set<string>();
	#watcher: StatWatcher | undefined;
	#swept = false;
	#updates: { at: number; value: Promise<{ source: string }[]> } | undefined;

	constructor(options: InstalledExtensionsOptions) {
		this.#options = options;
		this.#installer = options.installer ?? piExtensionInstaller();
		this.declarationsPath = join(options.dataDir, "extensions.json");
		this.root = join(options.dataDir, "extensions");
		this.#installsDir = join(this.root, "installs");
		this.#installsPath = join(this.root, "installs.json");
		this.#hostDir = join(this.root, "host");
		this.#statusPath = join(this.root, "status.json");
	}

	records(): readonly InstalledExtensionRecord[] {
		return this.#records;
	}

	codeRoots(): readonly string[] {
		return [this.root, ...this.#codeRoots];
	}

	/** Loaded server halves, in declaration order; a new array only when the set changed. */
	servers(): readonly InstalledServerExtension[] {
		return this.#servers;
	}

	fileError(): string | undefined {
		return this.#fileError;
	}

	#enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.#chain.then(task, task);
		this.#chain = run.catch(() => undefined);
		return run;
	}

	reconcile(): Promise<void> {
		if (this.#reconcileQueued) return this.#reconcileQueued;
		const queued = this.#enqueue(async () => {
			this.#reconcileQueued = undefined;
			await this.#reconcileNow();
		});
		this.#reconcileQueued = queued;
		return queued;
	}

	watch(): () => void {
		if (!this.#watcher) {
			this.#watcher = watchFile(
				this.declarationsPath,
				{ interval: POLL_INTERVAL_MS, persistent: false },
				() => {
					void this.reconcile().catch((error) => log.warn("extension reconcile failed", error));
				},
			);
		}
		return () => {
			unwatchFile(this.declarationsPath);
			this.#watcher = undefined;
		};
	}

	#readInstalls(): InstallsFile {
		try {
			const raw: unknown = JSON.parse(readFileSync(this.#installsPath, "utf8"));
			if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
			const installs: InstallsFile = {};
			for (const [source, ref] of Object.entries(raw as Record<string, unknown>)) {
				const { dir, path } = (ref ?? {}) as Partial<InstallRef>;
				if (typeof dir === "string" && typeof path === "string") installs[source] = { dir, path };
			}
			return installs;
		} catch {
			return {};
		}
	}

	#installRoot(ref: InstallRef): string | undefined {
		const dir = join(this.#installsDir, ref.dir);
		const root = resolve(dir, ref.path);
		if (!inside(this.#installsDir, dir) || !inside(dir, root)) return undefined;
		return existsSync(join(root, "package.json")) ? root : undefined;
	}

	#removeInstallDir(dir: string): void {
		const path = join(this.#installsDir, dir);
		if (!inside(this.#installsDir, path)) return;
		try {
			rmSync(path, { recursive: true, force: true });
		} catch (error) {
			log.info(`could not remove ${path} yet: ${messageOf(error)}`);
		}
	}

	#sweep(installs: InstallsFile): void {
		if (this.#swept) return;
		this.#swept = true;
		const kept = new Set(Object.values(installs).map((ref) => ref.dir));
		let entries: string[] = [];
		try {
			entries = readdirSync(this.#installsDir);
		} catch {
			return;
		}
		const now = Date.now();
		for (const entry of entries) {
			if (kept.has(entry) || this.#pending.has(entry)) continue;
			if (now - lastChanged(join(this.#installsDir, entry)) < SWEEP_MIN_AGE_MS) continue;
			this.#removeInstallDir(entry);
		}
	}

	#publish(next: readonly InstalledExtensionRecord[]): void {
		const previous = new Map(this.#records.map((record) => [record.source, record]));
		const records = next.map((record) => {
			const prior = previous.get(record.source);
			return prior && equivalent(prior, record) ? prior : record;
		});
		if (
			records.length === this.#records.length &&
			records.every((record, i) => record === this.#records[i])
		) {
			return;
		}
		this.#records = records;
		const servers = records.flatMap((record) => (record.server ? [record.server] : []));
		if (
			servers.length !== this.#servers.length ||
			servers.some((server, i) => server !== this.#servers[i])
		) {
			this.#servers = servers;
		}
		try {
			this.#options.onChange?.();
		} catch (error) {
			log.warn("installed extensions change listener failed", error);
		}
	}

	#failed(
		source: string,
		error: string,
		extra: Partial<InstalledExtensionRecord> = {},
		state: InstalledExtensionState = "failed",
	): InstalledExtensionRecord {
		const name = extra.name ?? source;
		return {
			source,
			sourceKind: extensionSourceKind(source),
			title: extra.title ?? name,
			...extra,
			name,
			state,
			error,
		};
	}

	#rememberCodeRoot(root: string): void {
		if (this.#codeRoots.has(root)) return;
		this.#codeRoots.add(root);
		try {
			this.#codeRoots.add(realpathSync(root));
		} catch {}
	}

	async #evaluate(
		source: string,
		root: string,
		taken: ReadonlyMap<string, string>,
	): Promise<InstalledExtensionRecord> {
		this.#rememberCodeRoot(root);
		let packageJson: unknown;
		try {
			packageJson = readPackageJson(root);
		} catch (error) {
			return this.#failed(source, `package.json cannot be read: ${messageOf(error)}`, { root });
		}
		const ownName = nameOf(packageJson);
		const named = ownName ? { name: ownName } : {};
		if (!hasExtensionManifest(packageJson)) {
			return this.#failed(
				source,
				'not a ThinkRail extension: package.json has no "thinkrail" manifest',
				{
					root,
					...named,
				},
			);
		}
		const parsed = parseExtensionManifest(packageJson, {
			reservedNames: this.#options.reservedNames(),
		});
		if (!parsed.ok) return this.#failed(source, parsed.error, { root, ...named });
		const { manifest } = parsed;
		const base = manifestBase(root, manifest);
		const owner = taken.get(manifest.name);
		if (owner !== undefined) {
			return this.#failed(source, `${manifest.name} is already installed from ${owner}`, {
				...base,
				duplicateOf: owner,
			});
		}
		const mismatch = extensionApiMismatch(manifest.api);
		if (mismatch) return this.#failed(source, mismatch, base, "incompatible");
		let realRoot: string;
		try {
			realRoot = realpathSync(root);
		} catch (error) {
			return this.#failed(source, messageOf(error), base);
		}
		for (const file of [manifest.server, manifest.web, manifest.styles]) {
			if (file === undefined) continue;
			let real: string;
			try {
				real = realpathSync(join(root, file));
			} catch {
				return this.#failed(source, `${file} is missing from the package`, base);
			}
			if (!inside(realRoot, real)) {
				return this.#failed(source, `${file} points outside the package`, base);
			}
		}
		if (manifest.server === undefined)
			return { source, sourceKind: extensionSourceKind(source), ...base, state: "loaded" };
		const entry = join(root, manifest.server);
		try {
			const extension = await loadServerDescriptor(entry, this.#hostDir, {
				...(this.#options.loadTimeoutMs ? { timeoutMs: this.#options.loadTimeoutMs } : {}),
			});
			if (extension.name !== manifest.name) {
				throw new Error(
					`the server descriptor's name "${extension.name}" must be the package name "${manifest.name}"`,
				);
			}
			const skillRoots = this.#options.skillRoots(entry, extension);
			return {
				source,
				sourceKind: extensionSourceKind(source),
				...base,
				state: "loaded",
				server: { extension, entry, skillRoots },
			};
		} catch (error) {
			log.warn(`installed extension ${manifest.name} failed to load from ${source}`);
			return this.#failed(source, messageOf(error), base);
		}
	}

	async #reconcileNow(): Promise<void> {
		const read = readDeclarations(this.declarationsPath);
		if (!read.ok) {
			if (this.#fileError !== read.error) log.warn(`extensions.json ignored: ${read.error}`);
			this.#fileError = read.error;
			await this.#writeStatus(this.#records.map((record) => record.source));
			return;
		}
		this.#fileError = undefined;
		const previous = new Map(this.#records.map((record) => [record.source, record]));
		const installs = this.#readInstalls();
		for (const source of Object.keys(installs)) {
			if (!read.sources.includes(source)) delete installs[source];
		}
		this.#writeInstalls(installs);
		this.#sweep(installs);
		let records: (InstalledExtensionRecord | undefined)[] = [];
		for (const source of read.sources) {
			const taken = owners(records);
			records.push(
				await this.#guarded(source, () =>
					this.#settle(source, installs[source], previous.get(source), taken),
				),
			);
		}
		const publish = async () => {
			records = await this.#ownNames(records);
			this.#publish(records.filter((record) => record !== undefined));
			await this.#writeStatus(read.sources);
		};
		await publish();
		for (const [index, source] of read.sources.entries()) {
			if (records[index] !== undefined) continue;
			const taken = owners(records.slice(0, index));
			const record = await this.#guarded(source, () =>
				this.#installMissing(source, installs, taken),
			);
			if (!record) continue;
			records[index] = record;
			await publish();
		}
	}

	async #ownNames(
		records: readonly (InstalledExtensionRecord | undefined)[],
	): Promise<(InstalledExtensionRecord | undefined)[]> {
		const owned: (InstalledExtensionRecord | undefined)[] = [];
		for (const record of records) {
			let next = record;
			if (next?.manifest && next.root) {
				const { source, root, manifest, duplicateOf } = next;
				const taken = owners(owned);
				const owner = taken.get(manifest.name);
				if (owner !== undefined && duplicateOf !== owner) {
					next = this.#failed(source, `${manifest.name} is already installed from ${owner}`, {
						...manifestBase(root, manifest),
						duplicateOf: owner,
					});
				} else if (owner === undefined && duplicateOf !== undefined) {
					next = await this.#guarded(source, () => this.#evaluate(source, root, taken));
				}
			}
			owned.push(next);
		}
		return owned;
	}

	async #guarded(
		source: string,
		task: () => Promise<InstalledExtensionRecord | undefined>,
	): Promise<InstalledExtensionRecord | undefined> {
		try {
			return await task();
		} catch (error) {
			log.warn(`installed extension source ${source} could not be settled`);
			return this.#failed(source, messageOf(error));
		}
	}

	async #toolsOf(
		extension: ServerExtension,
	): Promise<{ tools: string[]; shadowed: string[] } | undefined> {
		const names = this.#options.toolNames;
		if (!names) return undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<undefined>((resolve) => {
			timer = setTimeout(() => resolve(undefined), STATUS_TOOLS_TIMEOUT_MS);
		});
		try {
			const listed = Promise.resolve()
				.then(() => names(extension))
				.catch(() => undefined);
			const tools = await Promise.race([listed, timeout]);
			return tools ? { tools: [...tools.tools], shadowed: [...tools.shadowed] } : undefined;
		} finally {
			clearTimeout(timer);
		}
	}

	async #writeStatus(sources: readonly string[]): Promise<void> {
		const bySource = new Map(this.#records.map((record) => [record.source, record]));
		const extensions: ExtensionStatusEntry[] = [];
		for (const source of sources) {
			const record = bySource.get(source);
			if (!record) {
				extensions.push({ source, state: "installing" });
				continue;
			}
			const tools = record.server ? await this.#toolsOf(record.server.extension) : undefined;
			extensions.push({
				source,
				name: record.name,
				...(record.version ? { version: record.version } : {}),
				state: record.state,
				...(record.error ? { error: record.error } : {}),
				...(tools ? { tools: tools.tools } : {}),
				...(tools?.shadowed.length ? { shadowed: tools.shadowed } : {}),
			});
		}
		const status: ExtensionsStatus = {
			api: EXTENSION_API_VERSION,
			updatedAt: new Date().toISOString(),
			declarations: this.declarationsPath,
			...(this.#fileError ? { fileError: this.#fileError } : {}),
			extensions,
		};
		try {
			writeJsonAtomic(this.#statusPath, status);
		} catch (error) {
			log.info(`could not write ${this.#statusPath}: ${messageOf(error)}`);
		}
	}

	async #settle(
		source: string,
		ref: InstallRef | undefined,
		previous: InstalledExtensionRecord | undefined,
		taken: ReadonlyMap<string, string>,
	): Promise<InstalledExtensionRecord | undefined> {
		const kind = extensionSourceKind(source);
		if (kind === undefined) {
			return this.#failed(
				source,
				"not an extension source: use npm:<name>, a git URL or an absolute folder path",
			);
		}
		let root: string | undefined;
		if (kind === "folder") {
			try {
				root = folderOf(source);
			} catch (error) {
				return this.#failed(source, `not a folder path: ${messageOf(error)}`);
			}
			if (!existsSync(join(root, "package.json"))) {
				return this.#failed(source, `no package.json in ${root}`);
			}
		} else {
			root = ref ? this.#installRoot(ref) : undefined;
			if (root === undefined) {
				return previous?.state === "failed" && previous.root === undefined ? previous : undefined;
			}
		}
		if (
			previous?.root === root &&
			previous.fingerprint === fingerprintOf(root, previous.manifest) &&
			previous.duplicateOf === (previous.manifest ? taken.get(previous.name) : undefined)
		) {
			return previous;
		}
		return this.#evaluate(source, root, taken);
	}

	async #installMissing(
		source: string,
		installs: InstallsFile,
		taken: ReadonlyMap<string, string>,
	): Promise<InstalledExtensionRecord | undefined> {
		if ((this.#options.offline ?? isOffline)()) {
			return this.#failed(source, "offline: npm and git extensions cannot be installed");
		}
		let ref: InstallRef;
		try {
			ref = await this.#installFresh(source);
		} catch (error) {
			log.warn(`installing extension ${source} failed`);
			return this.#failed(source, messageOf(error));
		}
		const current = readDeclarations(this.declarationsPath);
		if (current.ok && !current.sources.includes(source)) {
			this.#pending.delete(ref.dir);
			this.#removeInstallDir(ref.dir);
			return undefined;
		}
		installs[source] = ref;
		this.#writeInstalls(installs);
		this.#pending.delete(ref.dir);
		const root = this.#installRoot(ref);
		if (root === undefined)
			return this.#failed(source, "the installed package has no package.json");
		return this.#evaluate(source, root, taken);
	}

	async #installFresh(source: string): Promise<InstallRef> {
		const dir = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
		this.#pending.add(dir);
		mkdirSync(this.#installsDir, { recursive: true });
		try {
			const path = await this.#installer.install(source, join(this.#installsDir, dir));
			return { dir, path };
		} catch (error) {
			this.#pending.delete(dir);
			this.#removeInstallDir(dir);
			throw error;
		}
	}

	#writeInstalls(installs: InstallsFile): void {
		if (Object.keys(installs).length === 0 && !existsSync(this.#installsPath)) return;
		writeJsonAtomic(this.#installsPath, installs);
	}

	#declared(): Extract<DeclarationsRead, { ok: true }> {
		const read = readDeclarations(this.declarationsPath);
		if (!read.ok) throw new CodedError("EXTENSIONS_FILE_INVALID", read.error);
		return read;
	}

	isExtensionAt(root: string): boolean {
		return extensionPackageAt(root) !== undefined;
	}

	async stage(source: string): Promise<StagedExtension | undefined> {
		const kind = extensionSourceKind(source);
		if (kind === undefined) return undefined;
		if (kind === "folder") {
			let packageJson: unknown;
			try {
				packageJson = extensionPackageAt(folderOf(source));
			} catch {
				return undefined;
			}
			return packageJson === undefined
				? undefined
				: { source, name: nameOf(packageJson) ?? source };
		}
		if ((this.#options.offline ?? isOffline)()) {
			throw new CodedError("PACKAGE_OFFLINE", "offline: npm and git packages cannot be installed.");
		}
		let install: InstallRef;
		try {
			install = await this.#installFresh(source);
		} catch (error) {
			throw new CodedError("PACKAGE_INSTALL_FAILED", messageOf(error));
		}
		const root = this.#installRoot(install);
		const packageJson = root === undefined ? undefined : extensionPackageAt(root);
		if (packageJson === undefined) {
			this.discard({ source, name: source, install });
			return undefined;
		}
		return { source, name: nameOf(packageJson) ?? source, install };
	}

	discard(staged: StagedExtension): void {
		if (!staged.install) return;
		this.#pending.delete(staged.install.dir);
		this.#removeInstallDir(staged.install.dir);
	}

	adopt(staged: StagedExtension): Promise<InstalledExtensionRecord> {
		return this.#enqueue(async () => {
			let read: Extract<DeclarationsRead, { ok: true }>;
			try {
				read = this.#declared();
			} catch (error) {
				this.discard(staged);
				throw error;
			}
			if (staged.install) {
				const installs = this.#readInstalls();
				installs[staged.source] = staged.install;
				this.#writeInstalls(installs);
				this.#pending.delete(staged.install.dir);
			}
			if (!read.sources.includes(staged.source)) {
				writeDeclarations(this.declarationsPath, read, [...read.sources, staged.source]);
			}
			this.#updates = undefined;
			await this.#reconcileNow();
			const record = this.#records.find((entry) => entry.source === staged.source);
			if (!record) throw new CodedError("PACKAGE_INSTALL_FAILED", `${staged.source} did not load.`);
			return record;
		});
	}

	remove(source: string): Promise<void> {
		return this.#enqueue(async () => {
			const read = this.#declared();
			if (!read.sources.includes(source)) {
				throw new CodedError("EXTENSION_UNKNOWN", `No extension ${source} is declared.`);
			}
			writeDeclarations(
				this.declarationsPath,
				read,
				read.sources.filter((entry) => entry !== source),
			);
			this.#updates = undefined;
			await this.#reconcileNow();
		});
	}

	update(source: string): Promise<void> {
		return this.#enqueue(async () => {
			const read = this.#declared();
			if (!read.sources.includes(source)) {
				throw new CodedError("EXTENSION_UNKNOWN", `No extension ${source} is declared.`);
			}
			const kind = extensionSourceKind(source);
			if (kind === "folder" || kind === undefined) {
				this.#records = this.#records.filter((record) => record.source !== source);
				await this.#reconcileNow();
				return;
			}
			if ((this.#options.offline ?? isOffline)()) {
				throw new CodedError("PACKAGE_OFFLINE", "offline: extensions cannot be updated.");
			}
			let ref: InstallRef;
			try {
				ref = await this.#installFresh(source);
			} catch (error) {
				throw new CodedError("PACKAGE_UPDATE_FAILED", messageOf(error));
			}
			const root = this.#installRoot(ref);
			const earlier = new Set(read.sources.slice(0, read.sources.indexOf(source)));
			const taken = owners(this.#records.filter((record) => earlier.has(record.source)));
			const record = root ? await this.#evaluate(source, root, taken) : undefined;
			if (record?.state !== "loaded") {
				this.discard({ source, name: source, install: ref });
				throw new CodedError(
					"PACKAGE_UPDATE_FAILED",
					record?.error ?? "the installed package has no package.json",
				);
			}
			const installs = this.#readInstalls();
			installs[source] = ref;
			this.#writeInstalls(installs);
			this.#pending.delete(ref.dir);
			this.#updates = undefined;
			const next = this.#records.map((entry) => (entry.source === source ? record : entry));
			this.#publish((await this.#ownNames(next)).filter((entry) => entry !== undefined));
			await this.#reconcileNow();
		});
	}

	checkUpdates(options: { force?: boolean } = {}): Promise<{ source: string }[]> {
		const cached = this.#updates;
		if (!options.force && cached && Date.now() - cached.at < UPDATE_CHECK_TTL_MS) {
			return cached.value;
		}
		const value = (async () => {
			if ((this.#options.offline ?? isOffline)()) return [];
			const installs = this.#readInstalls();
			const found: { source: string }[] = [];
			for (const record of this.#records) {
				const ref = installs[record.source];
				if (!ref || record.sourceKind === "folder") continue;
				try {
					if (await this.#installer.hasUpdate(record.source, join(this.#installsDir, ref.dir))) {
						found.push({ source: record.source });
					}
				} catch (error) {
					log.info(`update check for ${record.source} failed: ${messageOf(error)}`);
				}
			}
			return found;
		})();
		this.#updates = { at: Date.now(), value };
		value.catch(() => {
			this.#updates = undefined;
		});
		return value;
	}
}

function owners(
	records: readonly (InstalledExtensionRecord | undefined)[],
): ReadonlyMap<string, string> {
	const taken = new Map<string, string>();
	for (const record of records) {
		if (record?.manifest && !taken.has(record.name)) taken.set(record.name, record.source);
	}
	return taken;
}

function manifestBase(root: string, manifest: ExtensionManifest) {
	return {
		root,
		name: manifest.name,
		title: manifest.title ?? manifest.name,
		manifest,
		fingerprint: fingerprintOf(root, manifest),
		...(manifest.description ? { description: manifest.description } : {}),
		...(manifest.version ? { version: manifest.version } : {}),
	};
}

function equivalent(a: InstalledExtensionRecord, b: InstalledExtensionRecord): boolean {
	const view = (record: InstalledExtensionRecord) =>
		JSON.stringify([
			record.source,
			record.name,
			record.title,
			record.description,
			record.version,
			record.state,
			record.error,
			record.root,
			record.fingerprint,
			record.duplicateOf,
		]);
	return a.server === b.server && view(a) === view(b);
}

function nameOf(packageJson: unknown): string | undefined {
	const name = (packageJson as { name?: unknown } | null | undefined)?.name;
	return typeof name === "string" ? name : undefined;
}
