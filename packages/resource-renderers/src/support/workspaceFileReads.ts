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

export function startWorkspaceFileReads({
	read,
	subscribe,
	bytesUrl,
	update,
}: WorkspaceFileReads): () => void {
	let alive = true;
	let issued = 0;
	let applied = 0;
	const settle = (ticket: number, next: (current: LoadedFile | null) => LoadedFile) => {
		if (!alive || ticket < applied) return;
		applied = ticket;
		update(next);
	};
	const load = () => {
		issued += 1;
		const ticket = issued;
		read().then(
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
					return previous ? { ...previous, stale: message } : { status: "error", message };
				}),
		);
	};
	const unsubscribe = subscribe(load);
	load();
	return () => {
		alive = false;
		unsubscribe();
	};
}
