import { contentFile } from "../content/files";
import type { DocPage as DocPageDoc } from "../content/types";
import { headings, Markdown } from "../parts/Markdown";
import { Toc, type TocEntry } from "../parts/Toc";

function outline(source: string, prefix: string): TocEntry[] {
	const entries: TocEntry[] = [];
	for (const heading of headings(source, prefix)) {
		const last = entries.at(-1);
		if (heading.depth === 3 && last) {
			last.children = [...(last.children ?? []), { id: heading.id, title: heading.text }];
		} else entries.push({ id: heading.id, title: heading.text });
	}
	return entries;
}

export function DocPage({ page }: { page: DocPageDoc }) {
	const source = contentFile(page.file);
	const toc = outline(source, page.slug);
	const meta: [string, readonly string[]][] = [
		["Values", page.sources],
		["Content", [`apps/web/library/content/${page.file}`]],
		["Generated", page.output ? [page.output.path] : []],
	];
	return (
		<div className="mx-auto flex max-w-[90rem] gap-40 px-16 py-24 md:px-40 md:py-40">
			<article className="flex min-w-0 max-w-[64rem] flex-1 flex-col gap-24">
				<header className="flex flex-col gap-16 border-border-default border-b pb-32">
					<h1 className="tr-heading-xl text-text-default">{page.title}</h1>
					<p className="tr-text-reading text-text-muted">{page.summary}</p>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-24 gap-y-8">
						{meta
							.filter(([, paths]) => paths.length > 0)
							.map(([label, paths]) => (
								<div key={label} className="contents">
									<dt className="tr-text-ui text-text-subtle">{label}</dt>
									<dd className="flex min-w-0 flex-wrap gap-x-16 gap-y-4">
										{paths.map((path) => (
											<code key={path} className="break-all tr-code-text text-text-default">
												{path}
											</code>
										))}
									</dd>
								</div>
							))}
					</dl>
				</header>
				<Markdown source={source} anchors={page.slug} />
			</article>
			{toc.length > 1 ? (
				<aside className="sticky top-40 hidden w-[13rem] shrink-0 self-start xl:block">
					<Toc entries={toc} />
				</aside>
			) : null}
		</div>
	);
}
