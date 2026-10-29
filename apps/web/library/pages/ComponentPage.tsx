import type { ButtonSize, ButtonTone, ButtonVariant } from "@thinkrail/ui/button";
import { Switch } from "@thinkrail/ui/switch";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { type ComponentType, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { contentFile } from "../content/files";
import type { ComponentDoc } from "../content/types";
import { CodeBlock, CopyText } from "../parts/CodeBlock";
import { DemoCard } from "../parts/DemoCard";
import { InlineMarkdown, Markdown } from "../parts/Markdown";
import { Section, Table } from "../parts/Section";
import {
	type Content,
	type Kind,
	Specimen,
	type SpecimenConfig,
	specimenCode,
} from "../parts/Specimen";
import { Toc, type TocEntry } from "../parts/Toc";
import { type SectionId, sectionTitles } from "./sections";

const exampleModules = import.meta.glob<{ default: ComponentType }>("../examples/*/*.tsx", {
	eager: true,
});
const exampleSources = import.meta.glob<string>("../examples/*/*.tsx", {
	eager: true,
	query: "?raw",
	import: "default",
});

const SELECTED_STYLED: Record<ButtonVariant, boolean> = {
	primary: false,
	"soft-primary": true,
	outline: true,
	ghost: true,
	destructive: false,
};
const TONED: readonly ButtonVariant[] = ["outline", "ghost"];
const FLAGS = ["loading", "spinIcon", "selected", "disabled"] as const;

function flagPatch(flag: (typeof FLAGS)[number], on: boolean): Partial<SpecimenConfig> {
	switch (flag) {
		case "loading":
			return { loading: on };
		case "spinIcon":
			return { spinIcon: on };
		case "selected":
			return { selected: on };
		case "disabled":
			return { disabled: on };
	}
}
const CONTENTS: readonly Content[] = ["text", "icon left", "icon right", "both icons"];

function sectionId(doc: ComponentDoc, id: SectionId) {
	return `${doc.slug}-${id}`;
}

function MeasuredHeight({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [height, setHeight] = useState<number | null>(null);
	useLayoutEffect(() => {
		const button = ref.current?.querySelector("button");
		if (button) setHeight(Math.round(button.getBoundingClientRect().height));
	}, []);
	return (
		<span ref={ref} className="flex flex-col items-start gap-4">
			{children}
			<span className="tr-text-metadata text-text-muted">{height ? `${height}px` : "…"}</span>
		</span>
	);
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

function VariantsAndSizes({ doc, kind }: { doc: ComponentDoc; kind: Kind }) {
	const variants = Object.keys(doc.variants) as ButtonVariant[];
	const sizes = Object.keys(doc.sizes) as ButtonSize[];
	return (
		<Section id={sectionId(doc, "variants")} title={sectionTitles.variants}>
			<Table
				head={["Variant", ...sizes.map((size) => size.toUpperCase()), "Use it for"]}
				rows={variants.map((variant) => [
					<code key="name" className="tr-code-text">
						{variant}
					</code>,
					...sizes.map((size) => (
						<MeasuredHeight key={size}>
							<Specimen kind={kind} config={{ variant, size, content: "icon left" }} />
						</MeasuredHeight>
					)),
					<InlineMarkdown key="text" source={doc.variants[variant] ?? ""} />,
				])}
			/>
			<Table
				head={["Size", "Use it for"]}
				rows={sizes.map((size) => [
					<code key="name" className="tr-code-text">
						{size}
					</code>,
					<InlineMarkdown key="text" source={doc.sizes[size] ?? ""} />,
				])}
			/>
		</Section>
	);
}

function States({ doc, kind }: { doc: ComponentDoc; kind: Kind }) {
	const variants = Object.keys(doc.variants) as ButtonVariant[];
	return (
		<Section
			id={sectionId(doc, "states")}
			title={sectionTitles.states}
			description="Every cell is the real component. Hover and press the first column, or click into the page and press Tab to see keyboard focus. Disabled, loading and selected are real props."
		>
			<Table
				head={["Variant", "Hover · press · Tab", "Disabled", "Loading", "Selected"]}
				rows={variants.map((variant) => [
					<code key="name" className="tr-code-text">
						{variant}
					</code>,
					<Specimen key="live" kind={kind} config={{ variant, size: "m" }} />,
					<Specimen key="disabled" kind={kind} config={{ variant, size: "m", disabled: true }} />,
					<Specimen key="loading" kind={kind} config={{ variant, size: "m", loading: true }} />,
					SELECTED_STYLED[variant] ? (
						<Specimen key="selected" kind={kind} config={{ variant, size: "m", selected: true }} />
					) : (
						<span key="selected" className="tr-text-metadata text-text-muted">
							no selected look
						</span>
					),
				])}
			/>
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
		</Section>
	);
}

function Tones({ doc, kind }: { doc: ComponentDoc; kind: Kind }) {
	const tones = Object.keys(doc.tones) as ButtonTone[];
	return (
		<Section
			id={sectionId(doc, "tone")}
			title={sectionTitles.tone}
			description={
				<InlineMarkdown source="`tone` applies to `outline` and `ghost`; other variants ignore it." />
			}
		>
			<Table
				head={["Variant", ...tones, "disabled"]}
				rows={TONED.map((variant) => [
					<code key="name" className="tr-code-text">
						{variant}
					</code>,
					...tones.map((tone) => (
						<Specimen
							key={tone}
							kind={kind}
							config={{ variant, size: "m", tone, content: "icon left" }}
						/>
					)),
					<Specimen
						key="disabled"
						kind={kind}
						config={{ variant, size: "m", tone: "danger", content: "icon left", disabled: true }}
					/>,
				])}
			/>
			<Table
				head={["Tone", "Use it for"]}
				rows={tones.map((tone) => [
					<code key="name" className="tr-code-text">
						{tone}
					</code>,
					<InlineMarkdown key="text" source={doc.tones[tone] ?? ""} />,
				])}
			/>
		</Section>
	);
}

function Choice<T extends string>({
	name,
	options,
	value,
	onChange,
}: {
	name: string;
	options: readonly T[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
			<legend className="mb-4 tr-text-eyebrow text-text-muted">{name}</legend>
			<div className="flex flex-wrap gap-2">
				{options.map((option) => (
					<ToggleSegment
						key={option}
						testid={`playground-${name}-${option}`}
						label={option}
						active={value === option}
						onClick={() => onChange(option)}
					/>
				))}
			</div>
		</fieldset>
	);
}

function Playground({ doc, kind }: { doc: ComponentDoc; kind: Kind }) {
	const variants = Object.keys(doc.variants) as ButtonVariant[];
	const sizes = Object.keys(doc.sizes) as ButtonSize[];
	const [config, setConfig] = useState<SpecimenConfig>({
		variant: kind === "icon-button" ? "ghost" : "primary",
		size: kind === "icon-button" ? "m" : "l",
		content: "icon left",
	});
	const set = (patch: Partial<SpecimenConfig>) =>
		setConfig((current) => ({ ...current, ...patch }));
	return (
		<Section
			id={sectionId(doc, "playground")}
			title={sectionTitles.playground}
			description="Combine supported props; the preview is the real component and the code updates with it."
		>
			<div className="grid grid-cols-[minmax(0,1fr)] gap-16 rounded-sm border border-border-default p-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="flex flex-col gap-12">
					<Choice
						name="variant"
						options={variants}
						value={config.variant}
						onChange={(variant) => set({ variant })}
					/>
					<Choice
						name="size"
						options={sizes}
						value={config.size}
						onChange={(size) => set({ size })}
					/>
					{kind === "button" ? (
						<Choice
							name="content"
							options={CONTENTS}
							value={config.content ?? "text"}
							onChange={(content) => set({ content })}
						/>
					) : null}
					<Choice
						name="tone"
						options={["none", "warning", "danger"] as const}
						value={config.tone ?? "none"}
						onChange={(tone) => set({ tone: tone === "none" ? undefined : tone })}
					/>
					<div className="flex flex-wrap gap-16">
						{FLAGS.map((flag) => (
							<span key={flag} className="flex items-center gap-8 tr-text-ui">
								<Switch
									checked={config[flag] === true}
									label={flag}
									testId={`playground-${flag}`}
									onCheckedChange={(checked) => set(flagPatch(flag, checked))}
								/>
								{flag}
							</span>
						))}
					</div>
				</div>
				<div className="flex min-w-0 flex-col gap-12">
					<div className="flex min-h-[6rem] items-center justify-center rounded-sm border border-border-default bg-container-elevated-bg p-16">
						<Specimen kind={kind} config={config} />
					</div>
					<CodeBlock code={specimenCode(kind, config)} title="playground.tsx" />
				</div>
			</div>
		</Section>
	);
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
				<h3 className="tr-title-section text-text-default">Native button props</h3>
				<PropsTable props={doc.nativeProps} />
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
			<Section
				id={sectionId(doc, "contract")}
				title={sectionTitles.contract}
				description={
					<InlineMarkdown
						source={`The implementation contract every button follows, from \`apps/web/library/content/${doc.contract}\`.`}
					/>
				}
			>
				<Markdown source={contentFile(doc.contract)} />
			</Section>
		</>
	);
}

export function ComponentPage({ doc }: { doc: ComponentDoc }) {
	const kind: Kind = doc.slug === "icon-button" ? "icon-button" : "button";
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
		...(
			[
				"variants",
				"states",
				"tone",
				"playground",
				"api",
				"accessibility",
				"rules",
				"usages",
				"contract",
			] as const
		).map((id) => ({ id: sectionId(doc, id), title: sectionTitles[id] })),
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
				<VariantsAndSizes doc={doc} kind={kind} />
				<States doc={doc} kind={kind} />
				<Tones doc={doc} kind={kind} />
				<Playground doc={doc} kind={kind} />
				<Guidance doc={doc} />
			</article>
			<aside className="sticky top-40 hidden w-[13rem] shrink-0 self-start xl:block">
				<Toc entries={toc} />
			</aside>
		</div>
	);
}
