import { createHash } from "node:crypto";
import type { ExtensionRunResult } from "@thinkrail/extension-api/server";
import {
	type CliReading,
	OPENSPEC_ARGV,
	readList,
	readStatus,
	readValidation,
	readVersion,
	type Validation,
	validateArgv,
	withCli,
} from "./cli";
import { type OpenspecChange, type OpenspecTree, parseOpenspec } from "./parse";

export type OpenspecRunner = (
	workspaceId: string,
	argv: readonly string[],
) => Promise<ExtensionRunResult>;
export type OpenspecTreeReader = (workspaceId: string) => Promise<OpenspecTree | null>;

/** One workspace's changes: the CLI's answers over the parse once they are in for this tree, else the parse. */
export interface OpenspecSnapshot {
	workspaceId: string;
	changes: OpenspecChange[];
	source: "cli" | "files";
	/** `validate --all --strict` by change: this tree's, or the last tree's while this one's is running. */
	validation: ReadonlyMap<string, Validation>;
}

/** The user's `openspec` on the project's PATH: its version, `null` without one; `checking` while probed. */
export interface CliState {
	version: string | null;
	checking: boolean;
}

/** How long a missing CLI stays missing before the next probe. */
export const PROBE_RETRY_MS = 5 * 60_000;

function signatureOf(tree: OpenspecTree): string {
	const hash = createHash("sha1");
	for (const file of tree.files) hash.update(`${file.path}\0${file.text}\0`);
	return hash.digest("hex");
}

/**
 * Reads OpenSpec changes per workspace: the parse at once, and with the CLI present (`openspec --version`,
 * probed once per project) its `list`, `status` and `validate --all` behind the read, keyed by the tree's
 * content, `onChange` saying when they landed. One CLI reading runs per workspace; a failed one is not
 * retried until the tree changes.
 */
export class OpenspecReader {
	private readonly tree: OpenspecTreeReader;
	private readonly run: OpenspecRunner;
	private readonly now: () => number;
	private readonly onChange: (projectId: string) => void;
	private readonly probes = new Map<string, { version: string | null; at: number }>();
	private readonly probing = new Map<string, Promise<void>>();
	private readonly readings = new Map<
		string,
		{ signature: string; reading: CliReading | null; validation: Map<string, Validation> }
	>();
	private readonly fetching = new Map<string, Promise<void>>();

	constructor(options: {
		tree: OpenspecTreeReader;
		run: OpenspecRunner;
		now: () => number;
		onChange: (projectId: string) => void;
	}) {
		this.tree = options.tree;
		this.run = options.run;
		this.now = options.now;
		this.onChange = options.onChange;
	}

	/** The CLI as last probed for this project. */
	cli(projectId: string): CliState {
		return {
			version: this.probes.get(projectId)?.version ?? null,
			checking: this.probing.has(projectId),
		};
	}

	/** Probes the project's CLI in `workspaceId` unless a fresh answer is in (a missing one is retried later). */
	private probe(projectId: string, workspaceId: string): void {
		const probe = this.probes.get(projectId);
		const fresh = !!probe && (probe.version !== null || this.now() - probe.at < PROBE_RETRY_MS);
		if (!fresh && !this.probing.has(projectId)) {
			const task = this.run(workspaceId, OPENSPEC_ARGV.version)
				.then(
					(run) => (run.ok ? readVersion(run.out) : null),
					() => null,
				)
				.then((version) => {
					this.probes.set(projectId, { version, at: this.now() });
				})
				.finally(() => {
					this.probing.delete(projectId);
					this.onChange(projectId);
				});
			this.probing.set(projectId, task);
		}
	}

	/**
	 * A workspace's changes, `null` when it has no `openspec/` (or is not open); a tree found probes the
	 * project's CLI in `probeIn` (its Default workspace) once.
	 */
	async read(
		projectId: string,
		workspaceId: string,
		probeIn: string,
	): Promise<OpenspecSnapshot | null> {
		const tree = await this.tree(workspaceId).catch(() => null);
		if (!tree) return null;
		this.probe(projectId, probeIn);
		const cli = this.probes.get(projectId)?.version ?? null;
		const changes = parseOpenspec(tree);
		const cached = this.readings.get(workspaceId);
		if (!cli) return { workspaceId, changes, source: "files", validation: new Map() };
		const signature = signatureOf(tree);
		if (cached?.signature === signature && cached.reading)
			return {
				workspaceId,
				changes: withCli(changes, cached.reading),
				source: "cli",
				validation: cached.reading.validation,
			};
		if (cached?.signature !== signature) this.fetch(projectId, workspaceId, signature);
		return { workspaceId, changes, source: "files", validation: cached?.validation ?? new Map() };
	}

	private fetch(projectId: string, workspaceId: string, signature: string): void {
		if (this.fetching.has(workspaceId)) return;
		const previous = this.readings.get(workspaceId)?.validation ?? new Map<string, Validation>();
		const task = (async () => {
			const out = async (argv: readonly string[]) =>
				(await this.run(workspaceId, argv).catch(() => null))?.out ?? "";
			const list = readList(await out(OPENSPEC_ARGV.list));
			const status = readStatus(await out(OPENSPEC_ARGV.status));
			const validation = readValidation(await out(OPENSPEC_ARGV.validateAll));
			this.readings.set(workspaceId, {
				signature,
				reading: list && status ? { list, status, validation: validation ?? previous } : null,
				validation: validation ?? previous,
			});
		})().finally(() => {
			this.fetching.delete(workspaceId);
			this.onChange(projectId);
		});
		this.fetching.set(workspaceId, task);
	}

	/** `openspec validate <change> --strict --json` in that workspace; `null` when it answered no verdict. */
	async validate(workspaceId: string, change: string): Promise<Validation | null> {
		const run = await this.run(workspaceId, validateArgv(change));
		return readValidation(run.out)?.get(change) ?? null;
	}

	forget(workspaceId: string): void {
		this.readings.delete(workspaceId);
	}

	async idle(): Promise<void> {
		while (this.probing.size + this.fetching.size > 0)
			await Promise.all([...this.probing.values(), ...this.fetching.values()]);
	}
}
