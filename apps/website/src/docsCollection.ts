import { type CollectionEntry, getCollection } from "astro:content";

export type Doc = CollectionEntry<"docs">;

export async function publishedDocs(): Promise<Doc[]> {
	const docs = (await getCollection("docs")).filter(
		(doc) => !(import.meta.env.PROD && doc.data.draft),
	);
	docs.sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));

	const bySlug = new Map<string, string>();
	for (const doc of docs) {
		const existing = bySlug.get(doc.data.slug);
		if (existing) {
			throw new Error(
				`Duplicate docs slug "${doc.data.slug}" in ${doc.id} (already used by ${existing})`,
			);
		}
		bySlug.set(doc.data.slug, doc.id);
	}
	return docs;
}

export function docPath(doc: Doc): string {
	return `/docs/${doc.data.slug}/`;
}
