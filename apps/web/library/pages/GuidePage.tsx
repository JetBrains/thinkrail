import type { GuidePage as GuidePageDoc } from "../content/types";
import { InlineMarkdown, Markdown } from "../parts/Markdown";
import { Section } from "../parts/Section";

export function GuidePage({ page }: { page: GuidePageDoc }) {
	return (
		<article className="mx-auto flex max-w-[56rem] flex-col gap-24 px-16 py-24 md:px-40 md:py-40">
			<header className="flex flex-col gap-8">
				<h1 className="tr-heading-lg text-text-default">{page.title}</h1>
				<Markdown source={page.summary} />
			</header>
			{page.sections.map((section) => (
				<Section key={section.title} title={section.title}>
					<Markdown source={section.body} />
					{section.rules ? (
						<ul className="flex flex-col gap-8">
							{section.rules.map((rule) => (
								<li
									key={rule.id}
									className="flex gap-12 rounded-sm border border-border-default bg-container-elevated-bg p-12"
								>
									<code className="shrink-0 tr-code-text text-primary">{rule.id}</code>
									<span className="tr-text-ui text-text-default">
										<InlineMarkdown source={rule.text} />
									</span>
								</li>
							))}
						</ul>
					) : null}
				</Section>
			))}
		</article>
	);
}
