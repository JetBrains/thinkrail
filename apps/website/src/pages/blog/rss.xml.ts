import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { postPath, publishedPosts } from "../../blogCollection";

const TITLE = "ThinkRail Blog";

export async function GET(context: APIContext) {
	const posts = await publishedPosts();
	const site = context.site ?? new URL("https://thinkrail.ai");
	return rss({
		title: TITLE,
		description: "Updates, tutorials, and insights from the ThinkRail team.",
		site,
		customData: `<image><url>${new URL("/apple-touch-icon.png", site)}</url><title>${TITLE}</title><link>${site}</link></image>`,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.excerpt,
			pubDate: post.data.date,
			link: postPath(post),
		})),
	});
}
