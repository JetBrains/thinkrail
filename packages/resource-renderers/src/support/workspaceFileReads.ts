import type { ResourceMeta } from "@thinkrail/contracts";
import { PENDING_TEXT_META, type ResourceContent, resourceContent } from "../registry";

export type LoadedFile =
	| { status: "loading" }
	| {
			status: "ready";
			content: ResourceContent;
			meta: ResourceMeta;
			stale?: string | undefined;
	  }
	| { status: "error"; message: string };

export type ReadyFile = Extract<LoadedFile, { status: "ready" }>;

export interface FileState {
	file: string;
	loaded: LoadedFile;
}

export interface WorkspaceFileReads {
	read: () => Promise<{ content: string; meta?: ResourceMeta | undefined }>;
	subscribe: (onChange: () => void) => () => void;
	bytesUrl: () => string;
	update: (next: (current: LoadedFile | null) => LoadedFile) => void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function ready(current: LoadedFile | null): ReadyFile | null {
	return current?.status === "ready" ? current : null;
}

export function updateFileState(
	current: FileState | null,
	file: string,
	next: (current: LoadedFile | null) => LoadedFile,
): FileState {
	const previous = current?.file === file ? current.loaded : null;
	const loaded = next(previous);
	return current && loaded === previous ? current : { file, loaded };
}

export function startWorkspaceFileReads({
	read,
	subscribe,
	bytesUrl,
	update,
}: WorkspaceFileReads): () => void {
	let alive = true;
	let issued = 0;
	let applied = 0;
	let busy = false;
	let again = false;
	const settle = (ticket: number, next: (current: LoadedFile | null) => LoadedFile) => {
		if (!alive || ticket < applied) return;
		applied = ticket;
		update(next);
	};
	const followUp = () => {
		busy = false;
		if (!again || !alive) return;
		again = false;
		load();
	};
	const load = () => {
		if (busy) {
			again = true;
			return;
		}
		busy = true;
		issued += 1;
		const ticket = issued;
		new Promise<Awaited<ReturnType<typeof read>>>((resolve) => resolve(read()))
			.then(
				({ content, meta }) =>
					settle(ticket, (current) => {
						const previous = ready(current);
						if (previous && meta && meta.hash !== null && previous.meta.hash === meta.hash) {
							return previous.stale === undefined
								? previous
								: { status: "ready", content: previous.content, meta: previous.meta };
						}
						return {
							status: "ready",
							content: resourceContent(content, meta, bytesUrl),
							meta: meta ?? PENDING_TEXT_META,
						};
					}),
				(error: unknown) =>
					settle(ticket, (current) => {
						const previous = ready(current);
						const message = errorMessage(error);
						if (previous)
							return previous.stale === message ? previous : { ...previous, stale: message };
						return current?.status === "error" && current.message === message
							? current
							: { status: "error", message };
					}),
			)
			.finally(followUp);
	};
	const unsubscribe = subscribe(load);
	load();
	return () => {
		alive = false;
		unsubscribe();
	};
}
