import type { ComponentType, ReactNode } from "react";
import { contentFile } from "../content/files";
import type { ComponentDoc } from "../content/types";
import { CopyText } from "../parts/CodeBlock";
import { DemoCard } from "../parts/DemoCard";
import { InlineMarkdown, Markdown } from "../parts/Markdown";
import { Section, Table } from "../parts/Section";
import { Toc, type TocEntry } from "../parts/Toc";
import { showcases } from "../showcase";
import { Playground } from "../showcase/Playground";
import { sectionTitles } from "./sections";

const exampleModules = import.meta.glob<{ default: ComponentType }>("../examples/*/*.tsx", {
	eager: true,
});
const exampleSources = import.meta.glob<string>("../examples/*/*.tsx", {
	eager: true,
	query: "?raw",
	import: "default",
});

function sectionId(doc: ComponentDoc, id: string) {
	return `${doc.slug}-${id}`;
}

function WhenToUse({ doc }: { doc: ComponentDoc }) {
	return (
		<Section id={sectionId(doc, "when")} title={sectionTitles.when}>
			<ul className="flex list-disc flex-col gap-8 pl-24 tr-text-reading text-text-default">
				{doc.whenToUse.map((line) => (
					<li key={line}>
						<InlineMarkdown source={line} />
					</li>
				))}
			</ul>
			<h3 className="tr-title-section text-text-default">Choose something else when</h3>
			<ul className="flex list-disc flex-col gap-8 pl-24 tr-text-reading text-text-default">
				{doc.alternatives.map((alt) => (
					<li key={alt.name}>
						<span className="tr-text-emphasis">{alt.name}</span>
						<span className="text-text-muted"> — </span>
						<InlineMarkdown source={alt.when} />
					</li>
				))}
			</ul>
		</Section>
	);
}

function StatesTable({ doc }: { doc: ComponentDoc }) {
	return (
		<Table
			head={["State", "How", "Appearance"]}
			rows={doc.states.map((state) => [
				<span key="state" className="tr-text-emphasis">
					{state.state}
				</span>,
				<InlineMarkdown key="how" source={state.how} />,
				<InlineMarkdown key="look" source={state.appearance} />,
			])}
		/>
	);
}

function Showcases({ doc }: { doc: ComponentDoc }) {
	const showcase = showcases[doc.slug];
	const sections = showcase?.sections ?? [];
	const hasStates = sections.some((section) => section.id === "states");
	return (
		<>
			{sections.map(({ id, title, description, Render }) => (
				<Section
					key={id}
					id={sectionId(doc, id)}
					title={title}
					description={description ? <InlineMarkdown source={description} /> : undefined}
				>
					<Render />
					{id === "states" ? <StatesTable doc={doc} /> : null}
				</Section>
			))}
			{hasStates ? null : (
				<Section id={sectionId(doc, "states")} title={sectionTitles.states}>
					<StatesTable doc={doc} />
				</Section>
			)}
			{showcase?.playground ? (
				<Section
					id={sectionId(doc, "playground")}
					title={sectionTitles.playground}
					description="Combine supported props; the preview is the real component and the code updates with it."
				>
					<Playground config={showcase.playground} />
				</Section>
			) : null}
		</>
	);
}

function showcaseToc(doc: ComponentDoc): TocEntry[] {
	const showcase = showcases[doc.slug];
	const sections = showcase?.sections ?? [];
	return [
		...sections.map((section) => ({ id: sectionId(doc, section.id), title: section.title })),
		...(sections.some((section) => section.id === "states")
			? []
			: [{ id: sectionId(doc, "states"), title: sectionTitles.states }]),
		...(showcase?.playground
			? [{ id: sectionId(doc, "playground"), title: sectionTitles.playground }]
			: []),
	];
}

export function exampleAnchor(doc: ComponentDoc, id: string) {
	return `${doc.slug}-example-${id}`;
}

function Examples({ doc }: { doc: ComponentDoc }) {
	return (
		<Section id={sectionId(doc, "examples")} title={sectionTitles.examples}>
			<div className="gap-16 xl:columns-2">
				{doc.examples.map((example) => {
					const path = `../examples/${doc.slug}/${example.id}.tsx`;
					return (
						<DemoCard
							key={example.id}
							id={exampleAnchor(doc, example.id)}
							testId={`example-${doc.slug}-${example.id}`}
							title={example.title}
							description={example.description}
							file={`apps/web/library/examples/${doc.slug}/${example.id}.tsx`}
							code={exampleSources[path] ?? ""}
							Demo={exampleModules[path]?.default}
						/>
					);
				})}
			</div>
		</Section>
	);
}

function PropsTable({ props }: { props: ComponentDoc["props"] }) {
	return (
		<Table
			head={["Prop", "Type", "Default", "Description"]}
			rows={Object.entries(props).map(([name, prop]) => [
				<code key="name" className="tr-code-text">
					{name}
				</code>,
				<code key="type" className="tr-code-text text-text-muted">
					{prop.type}
				</code>,
				<code key="default" className="tr-code-text text-text-muted">
					{prop.default ?? "—"}
				</code>,
				<InlineMarkdown key="description" source={prop.description} />,
			])}
		/>
	);
}

function Guidance({ doc }: { doc: ComponentDoc }) {
	return (
		<>
			<Section id={sectionId(doc, "api")} title={sectionTitles.api}>
				<h3 className="tr-title-section text-text-default">Anatomy</h3>
				<Table
					head={["Part", "Description"]}
					rows={doc.anatomy.map((part) => [
						<span key="part" className="tr-text-emphasis">
							{part.part}
						</span>,
						<InlineMarkdown key="text" source={part.description} />,
					])}
				/>
				<h3 className="tr-title-section text-text-default">Props</h3>
				<PropsTable props={doc.props} />
				{doc.nativeProps ? (
					<>
						<h3 className="tr-title-section text-text-default">{doc.nativeProps.title}</h3>
						<PropsTable props={doc.nativeProps.props} />
					</>
				) : null}
			</Section>
			<Section id={sectionId(doc, "accessibility")} title={sectionTitles.accessibility}>
				<ul className="flex list-disc flex-col gap-4 pl-16 tr-text-ui">
					{doc.accessibility.map((line) => (
						<li key={line}>
							<InlineMarkdown source={line} />
						</li>
					))}
				</ul>
				<Table
					head={["Keys", "Action"]}
					rows={doc.keyboard.map((entry) => [
						<code key="keys" className="tr-code-text">
							{entry.keys}
						</code>,
						entry.action,
					])}
				/>
			</Section>
			<Section id={sectionId(doc, "rules")} title={sectionTitles.rules}>
				<ul className="flex flex-col gap-8">
					{doc.rules.map((rule) => (
						<li
							key={rule.id}
							className="flex gap-12 rounded-sm border border-border-default bg-container-elevated-bg p-12"
						>
							<code className="shrink-0 tr-code-text text-primary">{rule.id}</code>
							<span className="tr-text-ui">
								<InlineMarkdown source={rule.text} />
							</span>
						</li>
					))}
				</ul>
			</Section>
			<Section
				id={sectionId(doc, "usages")}
				title={sectionTitles.usages}
				description={<InlineMarkdown source="Representative call sites in the app." />}
			>
				<Table
					head={["File", "What it shows"]}
					rows={doc.usages.map((usage) => [
						<code key="file" className="tr-code-text">
							{usage.file}
						</code>,
						<InlineMarkdown key="note" source={usage.note} />,
					])}
				/>
			</Section>
			{doc.contract ? (
				<Section
					id={sectionId(doc, "contract")}
					title={sectionTitles.contract}
					description={
						<InlineMarkdown
							source={`The implementation contract, from \`apps/web/library/content/${doc.contract}\`.`}
						/>
					}
				>
					<Markdown source={contentFile(doc.contract)} />
				</Section>
			) : null}
		</>
	);
}

export function ComponentPage({ doc }: { doc: ComponentDoc }) {
	const toc: TocEntry[] = [
		{ id: sectionId(doc, "when"), title: sectionTitles.when },
		{
			id: sectionId(doc, "examples"),
			title: sectionTitles.examples,
			children: doc.examples.map((example) => ({
				id: exampleAnchor(doc, example.id),
				title: example.title,
			})),
		},
		...showcaseToc(doc),
		...(["api", "accessibility", "rules", "usages"] as const).map((id) => ({
			id: sectionId(doc, id),
			title: sectionTitles[id],
		})),
		...(doc.contract ? [{ id: sectionId(doc, "contract"), title: sectionTitles.contract }] : []),
	];
	const meta: [string, ReactNode][] = [
		[
			"Import",
			<code key="import" className="break-all tr-code-text text-text-default">
				{doc.importLine}
			</code>,
		],
		[
			"Source",
			<code key="source" className="break-all tr-code-text text-text-default">
				{doc.source}
			</code>,
		],
		[
			"Docs",
			<span key="docs" className="flex flex-wrap gap-x-16 gap-y-4">
				<code className="break-all tr-code-text text-text-default">
					apps/web/library/content/components/{doc.slug}.ts
				</code>
				<code className="break-all tr-code-text text-text-default">packages/ui/COMPONENTS.md</code>
			</span>,
		],
	];
	return (
		<div className="mx-auto flex max-w-[90rem] gap-40 px-16 py-24 md:px-40 md:py-40">
			<article className="flex min-w-0 flex-1 flex-col gap-40">
				<header className="flex flex-col gap-16 border-border-default border-b pb-32">
					<h1 className="tr-heading-xl text-text-default">{doc.name}</h1>
					<Markdown source={doc.summary} className="max-w-[56rem]" />
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-24 gap-y-8">
						{meta.map(([label, value]) => (
							<div key={label} className="contents">
								<dt className="tr-text-ui text-text-subtle">{label}</dt>
								<dd className="flex min-w-0 items-center gap-8">
									{value}
									{label === "Import" ? (
										<CopyText text={doc.importLine} label="Copy import" />
									) : null}
								</dd>
							</div>
						))}
					</dl>
				</header>
				<WhenToUse doc={doc} />
				<Examples doc={doc} />
				<Showcases doc={doc} />
				<Guidance doc={doc} />
			</article>
			<aside className="sticky top-40 hidden w-[13rem] shrink-0 self-start xl:block">
				<Toc entries={toc} />
			</aside>
		</div>
	);
}
