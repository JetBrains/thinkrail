# ThinkRail Blog Author Guide

This guide documents how to write and publish blog posts for thinkrail.ai/blog.

## Post Structure

Each post lives in its own directory under `content/blog/`:

```
content/blog/
└── YYYY-MM-DD-post-slug/
    ├── index.md          # The post content
    └── images/           # Optional: local images
        ├── screenshot.png
        └── diagram.svg
```

The directory name should follow the pattern `YYYY-MM-DD-slug` for sorting, though the
actual publish date and URL slug come from frontmatter.

## 	Frontmatter Schema

Every post requires YAML frontmatter at the top of `index.md`:

```yaml
---
title: "Your Post Title"        # Required: displayed as H1 and in browser tab
slug: post-url-slug             # Required: becomes /blog/post-url-slug.html
date: 2026-01-15                # Required: YYYY-MM-DD format (UTC)
excerpt: "A brief summary..."   # Optional: shown on blog index cards
draft: true                     # Optional: if true, post is skipped in build
tags:                           # Optional: displayed on post and index cards
  - announcement
  - feature
---
```

### Field Details

| Field     | Required | Description                                              |
|-----------|----------|----------------------------------------------------------|
| `title`   | Yes      | Post title (don't repeat as H1 in body—it's added automatically) |
| `slug`    | Yes      | URL slug (lowercase, hyphens, no spaces)                 |
| `date`    | Yes      | Publish date in `YYYY-MM-DD` format (interpreted as UTC) |
| `excerpt` | No       | 1-2 sentence summary for index cards and SEO             |
| `draft`   | No       | Set `true` to exclude from production build              |
| `tags`    | No       | Array of lowercase tags for categorization               |

## Markdown Features

Standard Markdown is fully supported, plus:

### Syntax Highlighting

Fenced code blocks with language hints get syntax highlighting via Shiki:

````markdown
```typescript
const greeting: string = "Hello, ThinkRail!";
console.log(greeting);
```
````

Supported languages: `javascript`, `typescript`, `jsx`, `tsx`, `json`, `html`, `css`,
`bash`, `shell`, `powershell`, `markdown`, `yaml`, `python`, `diff`, `plaintext`.

### Local Images

Place images in an `images/` subdirectory and reference them with relative paths:

```markdown
![Screenshot of the settings panel](./images/settings.png)
```

Images are automatically copied to `dist/blog/images/[slug]/` during build.

### YouTube Videos

Embed YouTube videos using the `<iframe>` tag:

```html
<iframe src="https://www.youtube.com/embed/VIDEO_ID" width="640" height="360" allowfullscreen></iframe>
```

## Best Practices

1. **Don't duplicate the title**: The frontmatter `title` is automatically rendered as an H1.
   If your Markdown starts with `# Same Title`, it will be stripped to avoid duplication.

2. **Use descriptive slugs**: The slug becomes the permanent URL. Choose something readable
   and SEO-friendly: `introducing-thinkrail` not `post-1`.

3. **Write an excerpt**: The excerpt appears on index cards. Without one, visitors only see
   the title and date.

4. **Use draft mode**: Set `draft: true` while writing. The post won't appear in production
   builds but you can preview it locally.

5. **Optimize images**: Compress PNGs/JPGs before committing. Large images slow page loads.

6. **Test locally**: Run `bun run build && bun run preview` in `apps/website/` to see
   exactly how your post will appear.

## Build Process

Posts are built by `scripts/build-blog.ts` which:

1. Discovers all `content/blog/*/index.md` files
2. Parses frontmatter and converts Markdown to HTML
3. Applies syntax highlighting (Shiki, dual light/dark themes)
4. Transforms YouTube embeds to responsive iframes
5. Generates individual post pages and the index page
6. Copies images to `dist/blog/images/[slug]/`

The build fails hard on any error (missing frontmatter, malformed Markdown) to prevent
broken posts from reaching production.

## Deployment

Blog posts deploy automatically via GitHub Actions when changes are pushed to
`apps/website/content/blog/**`. The same `site.yml` workflow handles both the main
site and blog.
