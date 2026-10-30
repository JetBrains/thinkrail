import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import { publishedPosts } from "../../../../blogCollection";

const CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
};

export const getStaticPaths = (async () => {
	const posts = await publishedPosts();
	return posts.flatMap((post) => {
		if (!post.filePath) return [];
		const directory = resolve(dirname(post.filePath), "images");
		let files: string[];
		try {
			files = readdirSync(directory);
		} catch {
			return [];
		}
		return files
			.filter((file) => extname(file).toLowerCase() in CONTENT_TYPES)
			.map((file) => ({
				params: { slug: post.data.slug, file },
				props: { path: join(directory, file) },
			}));
	});
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ path: string }> = ({ props: { path } }) =>
	new Response(readFileSync(path), {
		headers: {
			"Content-Type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
		},
	});
