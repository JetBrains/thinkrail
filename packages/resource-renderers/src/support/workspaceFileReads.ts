import type { ResourceMeta } from "@thinkrail/contracts";
import type { ResourceContent } from "../registry";

export type LoadedFile =
	| { status: "loading" }
	| { status: "ready"; content: ResourceContent; meta: ResourceMeta }
	| { status: "error"; message: string };

export type ReadyFile = Extract<LoadedFile, { status: "ready" }>;

export interface WorkspaceFileReads {
	read: () => Promise<{ content: string; meta: ResourceMeta }>;
	subscribe: (onChange: () => void) => () => void;
	bytesUrl: () => string;
	update: (next: (current: LoadedFile | null) => LoadedFile) => void;
}

function fileContent(text: string, meta: ResourceMeta, url: () => string): ResourceContent {
	if (meta.hash === null || meta.byteLength === null) return { kind: "absent" };
	if (meta.text) return { kind: "text", text, hash: meta.hash };
	return { kind: "bytes", url: url(), hash: meta.hash, byteLength: meta.byteLength };
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
					if (previous && meta.hash !== null && previous.meta.hash === meta.hash) return previous;
					return { status: "ready", content: fileContent(content, meta, bytesUrl), meta };
				}),
			(error: unknown) =>
				settle(
					ticket,
					(current) => ready(current) ?? { status: "error", message: errorMessage(error) },
				),
		);
	};
	const unsubscribe = subscribe(load);
	load();
	return () => {
		alive = false;
		unsubscribe();
	};
}
