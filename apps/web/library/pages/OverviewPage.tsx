import { RiSearchLine } from "@remixicon/react";
import { type ComponentType, useState } from "react";
import { components } from "../content";
import { Markdown } from "../parts/Markdown";

const examples = import.meta.glob<{ default: ComponentType }>("../examples/*/*.tsx", {
	eager: true,
});

export function OverviewPage() {
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const matches = components.filter((doc) => !needle || doc.name.toLowerCase().includes(needle));
	const groups = [...new Set(matches.map((doc) => doc.group))];
	return (
		<article className="mx-auto flex max-w-[72rem] flex-col gap-32 px-16 py-24 md:px-40 md:py-40">
			<header className="flex flex-col gap-16">
				<h1 className="tr-heading-xl text-text-default">Components overview</h1>
				<Markdown
					source="ThinkRail's shared components, rendered live from `packages/ui` with the app's own stylesheet and themes. Every page shows the real component, its rules and copyable examples."
					className="max-w-[48rem]"
				/>
			</header>
			<label className="flex items-center gap-12 border-border-default border-y py-16">
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search in components"
					aria-label="Search in components"
					data-testid="overview-search"
					className="min-w-0 flex-1 bg-transparent tr-heading-sm text-text-default outline-none placeholder:text-text-subtle"
				/>
				<RiSearchLine aria-hidden className="size-20 shrink-0 text-text-subtle" />
			</label>
			{groups.length === 0 ? (
				<p className="tr-text-ui text-text-muted">No component matches “{query}”.</p>
			) : null}
			{groups.map((group) => {
				const items = matches.filter((doc) => doc.group === group);
				return (
					<section key={group} className="flex flex-col gap-16">
						<h2 className="flex items-center gap-8 tr-heading-md text-text-default">
							{group}
							<span className="rounded-xs bg-container-content-bg px-6 tr-text-metadata text-text-muted">
								{items.length}
							</span>
						</h2>
						<div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-24">
							{items.map((doc) => {
								const Preview = examples[`../examples/${doc.slug}/${doc.preview}.tsx`]?.default;
								return (
									<div
										key={doc.slug}
										data-testid={`overview-card-${doc.slug}`}
										className="relative flex flex-col overflow-hidden rounded-md border border-border-default bg-container-elevated-bg transition-shadow focus-within:ring-2 focus-within:ring-primary hover:shadow-[var(--shadow-md)]"
									>
										<a
											href={`#/${doc.slug}`}
											className="border-border-default border-b px-12 py-8 tr-title-section text-text-default outline-none after:absolute after:inset-0 after:content-['']"
										>
											{doc.name}
										</a>
										<div
											inert
											className="pointer-events-none flex h-[9rem] items-center justify-center overflow-hidden p-16 [&>*]:flex-wrap [&>*]:justify-center"
										>
											{Preview ? <Preview /> : null}
										</div>
									</div>
								);
							})}
						</div>
					</section>
				);
			})}
		</article>
	);
}
