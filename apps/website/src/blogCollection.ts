import { type CollectionEntry, getCollection } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

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
