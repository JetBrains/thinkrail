import { type CollectionEntry, getCollection, getEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;
export type BlogAuthor = CollectionEntry<"authors">;

export async function publishedPosts(): Promise<BlogPost[]> {
	const posts = (await getCollection("blog")).filter(
		(post) => !(import.meta.env.PROD && post.data.draft),
	);
	posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

	const bySlug = new Map<string, string>();
	for (const post of posts) {
		const existing = bySlug.get(post.data.slug);
		if (existing) {
			throw new Error(
				`Duplicate blog slug "${post.data.slug}" in ${post.id} (already used by ${existing})`,
			);
		}
		bySlug.set(post.data.slug, post.id);
	}
	return posts;
}

export function postPath(post: BlogPost): string {
	return `/blog/${post.data.slug}/`;
}

export async function postAuthor(post: BlogPost): Promise<BlogAuthor> {
	const author = await getEntry(post.data.author);
	if (!author) {
		throw new Error(`Unknown blog author "${post.data.author.id}" in ${post.id}`);
	}
	return author;
}
