/**
 * Blog build script — discovers Markdown posts in content/blog/, parses frontmatter,
 * converts to HTML, and generates:
 * 1. Static HTML pages for each post in dist/blog/[slug].html
 * 2. A manifest JSON (dist/blog/posts.json) for the blog index
 * 3. Copies post images to dist/blog/images/[slug]/
 *
 * Run with: bun scripts/build-blog.ts
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import matter from "gray-matter";
import { Marked, type MarkedExtension } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

// Languages to support in code blocks
const SUPPORTED_LANGUAGES = [
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"json",
	"html",
	"css",
	"scss",
	"bash",
	"shell",
	"powershell",
	"markdown",
	"yaml",
	"toml",
	"python",
	"rust",
	"go",
	"java",
	"c",
	"cpp",
	"csharp",
	"ruby",
	"php",
	"swift",
	"kotlin",
	"sql",
	"graphql",
	"docker",
	"diff",
	"plaintext",
] as const;

// Theme for syntax highlighting (matches the blog's dark theme)
const SHIKI_THEME = "github-dark";

// Average reading speed in words per minute
const WORDS_PER_MINUTE = 200;

/**
 * Calculates estimated reading time in minutes from markdown content
 */
function calculateReadingTime(content: string): number {
	// Strip markdown syntax for more accurate word count
	const text = content
		.replace(/```[\s\S]*?```/g, "") // Remove code blocks
		.replace(/`[^`]+`/g, "") // Remove inline code
		.replace(/!?\[[^\]]*\]\([^)]*\)/g, "") // Remove links and images
		.replace(/[#*_~>-]/g, "") // Remove markdown symbols
		.replace(/\s+/g, " ") // Normalize whitespace
		.trim();

	const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;
	const minutes = Math.ceil(wordCount / WORDS_PER_MINUTE);
	return Math.max(1, minutes); // At least 1 minute
}

let highlighter: Highlighter | null = null;

/**
 * Creates a marked extension that uses shiki for syntax highlighting
 */
function createShikiExtension(hl: Highlighter): MarkedExtension {
	return {
		renderer: {
			code({ text, lang }: { text: string; lang?: string }) {
				const language = lang || "plaintext";
				const loadedLangs = hl.getLoadedLanguages();

				// Use shiki if the language is loaded, otherwise fall back to plain text
				if (loadedLangs.includes(language as (typeof loadedLangs)[number])) {
					const html = hl.codeToHtml(text, {
						lang: language,
						theme: SHIKI_THEME,
					});
					// Strip inline background-color so CSS can control it without !important
					return html.replace(/background-color:[^;"]+;?/g, "");
				}

				// Fallback for unknown languages
				const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
				return `<pre class="shiki"><code>${escaped}</code></pre>`;
			},
		},
	};
}

/**
 * Initializes shiki highlighter with supported languages
 */
async function initHighlighter(): Promise<Highlighter> {
	if (!highlighter) {
		highlighter = await createHighlighter({
			themes: [SHIKI_THEME],
			langs: [...SUPPORTED_LANGUAGES],
		});
	}
	return highlighter;
}

const CONTENT_DIR = join(import.meta.dirname, "../content/blog");
const OUTPUT_DIR = join(import.meta.dirname, "../dist/blog");
const TEMPLATE_PATH = join(import.meta.dirname, "../src/blog/post-template.html");
const INDEX_TEMPLATE_PATH = join(import.meta.dirname, "../src/blog/index-template.html");
const BLOG_CSS_PATH = join(import.meta.dirname, "../src/blog/blog.css");

interface PostFrontmatter {
	title: string;
	slug: string;
	date: string;
	excerpt?: string;
	coverImage?: string;
	tags?: string[];
}

interface PostManifestEntry {
	title: string;
	slug: string;
	date: string;
	excerpt: string;
	coverImage: string | null;
	tags: string[];
	url: string;
	readingTime: number; // in minutes
}

/**
 * Discovers all blog post directories in content/blog/
 */
async function discoverPosts(): Promise<string[]> {
	const entries = await readdir(CONTENT_DIR, { withFileTypes: true });
	return entries.filter((e) => e.isDirectory()).map((e) => join(CONTENT_DIR, e.name));
}

/**
 * Reads and parses a blog post's Markdown file
 */
async function parsePost(
	postDir: string,
	hl: Highlighter,
): Promise<{ frontmatter: PostFrontmatter; content: string; html: string; readingTime: number }> {
	const mdPath = join(postDir, "index.md");
	const raw = await readFile(mdPath, "utf-8");
	const { data, content } = matter(raw);

	// Validate required frontmatter
	if (!data.title || !data.slug || !data.date) {
		throw new Error(`Post at ${postDir} missing required frontmatter (title, slug, date)`);
	}

	const frontmatter: PostFrontmatter = {
		title: data.title,
		slug: data.slug,
		date: data.date,
		excerpt: data.excerpt,
		coverImage: data.coverImage,
		tags: data.tags || [],
	};

	// Configure marked with shiki extension
	const markedWithShiki = new Marked(createShikiExtension(hl));

	// Convert Markdown to HTML with syntax highlighting
	const html = await markedWithShiki.parse(content);

	// Calculate reading time
	const readingTime = calculateReadingTime(content);

	return { frontmatter, content, html, readingTime };
}

/**
 * Resolves image paths in HTML content — transforms ./images/foo.svg to /blog/images/[slug]/foo.svg
 */
function resolveImagePaths(html: string, slug: string): string {
	// Replace relative image paths with absolute paths to the blog images directory
	return html.replace(/src=["']\.\/images\/([^"']+)["']/g, `src="./images/${slug}/$1"`);
}

/**
 * Copies post images to the output directory
 */
async function copyPostImages(postDir: string, slug: string): Promise<void> {
	const imagesDir = join(postDir, "images");
	const outputImagesDir = join(OUTPUT_DIR, "images", slug);

	if (existsSync(imagesDir)) {
		await mkdir(outputImagesDir, { recursive: true });
		await cp(imagesDir, outputImagesDir, { recursive: true });
	}
}

/**
 * Generates the HTML page for a single blog post
 */
async function generatePostPage(
	frontmatter: PostFrontmatter,
	html: string,
	template: string,
	allPosts: PostManifestEntry[],
	readingTime: number,
): Promise<string> {
	// Find previous and next posts for navigation
	const currentIndex = allPosts.findIndex((p) => p.slug === frontmatter.slug);
	const prevPost = currentIndex > 0 ? allPosts[currentIndex - 1] : null;
	const nextPost = currentIndex < allPosts.length - 1 ? allPosts[currentIndex + 1] : null;

	// Build navigation HTML
	const navHtml = `
		<nav class="blog-post-nav">
			${prevPost ? `<a href="./${prevPost.slug}.html" class="blog-nav-prev">← ${prevPost.title}</a>` : "<span></span>"}
			<a href="./index.html" class="blog-nav-home">All Posts</a>
			${nextPost ? `<a href="./${nextPost.slug}.html" class="blog-nav-next">${nextPost.title} →</a>` : "<span></span>"}
		</nav>
	`;

	// Format date
	const formattedDate = new Date(frontmatter.date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	// Build tags HTML
	const tagsHtml = frontmatter.tags?.length
		? `<div class="blog-post-tags">${frontmatter.tags.map((t) => `<span class="blog-tag">${t}</span>`).join("")}</div>`
		: "";

	// Format reading time
	const readingTimeText = `${readingTime} min read`;

	// Replace template placeholders
	return template
		.replace(/\{\{title\}\}/g, frontmatter.title)
		.replace(/\{\{date\}\}/g, formattedDate)
		.replace(/\{\{readingTime\}\}/g, readingTimeText)
		.replace(/\{\{tags\}\}/g, tagsHtml)
		.replace(/\{\{content\}\}/g, html)
		.replace(/\{\{navigation\}\}/g, navHtml);
}

/**
 * Main build function
 */
async function build(): Promise<void> {
	console.log("📝 Building blog...");

	// Initialize syntax highlighter
	console.log("   Initializing syntax highlighter...");
	const hl = await initHighlighter();

	// Ensure output directory exists
	await mkdir(OUTPUT_DIR, { recursive: true });

	// Discover all posts
	const postDirs = await discoverPosts();
	console.log(`   Found ${postDirs.length} posts`);

	// Parse all posts
	const posts: Array<{
		dir: string;
		frontmatter: PostFrontmatter;
		html: string;
		readingTime: number;
	}> = [];

	for (const dir of postDirs) {
		try {
			const { frontmatter, html, readingTime } = await parsePost(dir, hl);
			const resolvedHtml = resolveImagePaths(html, frontmatter.slug);
			posts.push({ dir, frontmatter, html: resolvedHtml, readingTime });
		} catch (err) {
			console.error(`   ⚠️  Skipping ${basename(dir)}: ${err}`);
		}
	}

	// Sort posts by date (newest first)
	posts.sort(
		(a, b) => new Date(b.frontmatter.date).getTime() - new Date(a.frontmatter.date).getTime(),
	);

	// Build manifest
	const manifest: PostManifestEntry[] = posts.map((p) => ({
		title: p.frontmatter.title,
		slug: p.frontmatter.slug,
		date: p.frontmatter.date,
		excerpt: p.frontmatter.excerpt || "",
		coverImage: p.frontmatter.coverImage
			? `./images/${p.frontmatter.slug}/${basename(p.frontmatter.coverImage)}`
			: null,
		tags: p.frontmatter.tags || [],
		url: `./${p.frontmatter.slug}.html`,
		readingTime: p.readingTime,
	}));

	// Write manifest
	await writeFile(join(OUTPUT_DIR, "posts.json"), JSON.stringify(manifest, null, "\t"));
	console.log("   ✓ Generated posts.json");

	// Load template
	let template: string;
	try {
		template = await readFile(TEMPLATE_PATH, "utf-8");
	} catch {
		console.error("   ⚠️  Post template not found, using minimal fallback template");
		template = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>{{title}} — ThinkRail Blog</title>
	<link rel="stylesheet" href="../styles.css">
	<link rel="stylesheet" href="./blog.css">
</head>
<body>
	<article class="blog-post">
		<header class="blog-post-header">
			<h1>{{title}}</h1>
			<time>{{date}}</time>
			{{tags}}
		</header>
		<div class="blog-post-content">
			{{content}}
		</div>
		{{navigation}}
	</article>
</body>
</html>`;
	}

	// Generate HTML pages for each post
	for (const post of posts) {
		const pageHtml = await generatePostPage(
			post.frontmatter,
			post.html,
			template,
			manifest,
			post.readingTime,
		);
		const outputPath = join(OUTPUT_DIR, `${post.frontmatter.slug}.html`);
		await writeFile(outputPath, pageHtml);

		// Copy images
		await copyPostImages(post.dir, post.frontmatter.slug);

		console.log(`   ✓ Generated ${post.frontmatter.slug}.html`);
	}

	// Generate blog index page
	let indexTemplate: string;
	try {
		indexTemplate = await readFile(INDEX_TEMPLATE_PATH, "utf-8");
	} catch {
		console.error("   ⚠️  Index template not found");
		indexTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>Blog — ThinkRail</title>
	<link rel="stylesheet" href="./blog.css">
</head>
<body data-theme="dark">
	<main class="blog-main"><div class="blog-posts-list">{{posts}}</div></main>
</body>
</html>`;
	}

	// Generate post cards HTML
	const postsHtml = manifest
		.map((post) => {
			const formattedDate = new Date(post.date).toLocaleDateString("en-US", {
				year: "numeric",
				month: "long",
				day: "numeric",
			});
			const tagsHtml = post.tags.length
				? `<div class="blog-post-card-tags">${post.tags.map((t) => `<span class="blog-tag">${t}</span>`).join("")}</div>`
				: "";
			return `
			<a href="${post.url}" class="blog-post-card">
				<h2 class="blog-post-card-title">${post.title}</h2>
				<div class="blog-post-card-meta">
					<time>${formattedDate}</time>
					<span class="blog-post-card-reading-time">${post.readingTime} min read</span>
				</div>
				${post.excerpt ? `<p class="blog-post-card-excerpt">${post.excerpt}</p>` : ""}
				${tagsHtml}
			</a>`;
		})
		.join("\n");

	const indexHtml = indexTemplate.replace(/\{\{posts\}\}/g, postsHtml);
	await writeFile(join(OUTPUT_DIR, "index.html"), indexHtml);
	console.log("   ✓ Generated index.html");

	// Copy blog.css to output
	try {
		const blogCss = await readFile(BLOG_CSS_PATH, "utf-8");
		await writeFile(join(OUTPUT_DIR, "blog.css"), blogCss);
		console.log("   ✓ Copied blog.css");
	} catch {
		console.error("   ⚠️  blog.css not found");
	}

	console.log("✅ Blog build complete!");
}

// Run build
build().catch((err) => {
	console.error("❌ Blog build failed:", err);
	process.exit(1);
});
