import { root } from "astro:config/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRoute, GetStaticPaths } from "astro";
import { publishedPosts } from "../../../../blogCollection";
import { imageContentType, postImageFiles } from "../../../../blogImages";

export const getStaticPaths = (async () => {
	const posts = await publishedPosts();
	return posts.flatMap((post) => {
		if (!post.filePath) return [];
		const directory = resolve(fileURLToPath(root), dirname(post.filePath), "images");
		return postImageFiles(directory).map((file) => ({
			params: { slug: post.data.slug, file },
			props: { path: join(directory, file) },
		}));
	});
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ path: string }> = ({ props: { path } }) =>
	new Response(readFileSync(path), {
		headers: { "Content-Type": imageContentType(path) ?? "application/octet-stream" },
	});
