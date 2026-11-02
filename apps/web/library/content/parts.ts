import type { PropDoc } from "./types";

export type PartDocs<P> = Partial<Record<keyof P, PropDoc>>;

export function partProps(part: string, docs: Readonly<Record<string, PropDoc>>) {
	return Object.fromEntries(
		Object.entries(docs).map(([name, doc]) => [`${part}.${name}`, doc]),
	) as Record<string, PropDoc>;
}
