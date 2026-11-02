import type { ButtonSize, ButtonTone, ButtonVariant } from "@thinkrail/ui/button";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { InlineMarkdown } from "../parts/Markdown";
import { Table } from "../parts/Section";
import {
	type Content,
	type Kind,
	Specimen,
	type SpecimenConfig,
	specimenCode,
} from "./buttonSpecimen";
import type { PlaygroundConfig, PlaygroundValues, Showcase } from "./types";

interface ButtonDocs {
	variants: Readonly<Record<ButtonVariant, string>>;
	sizes: Readonly<Record<ButtonSize, string>>;
	tones: { note: string; docs: Readonly<Record<ButtonTone, string>> };
}

const keys = <K extends string>(record: Readonly<Record<K, string>>) => Object.keys(record) as K[];
const SELECTED_STYLED: Record<ButtonVariant, boolean> = {
	primary: false,
	"soft-primary": true,
	outline: true,
	ghost: true,
	destructive: false,
};
const TONED: readonly ButtonVariant[] = ["outline", "ghost"];
const FLAGS = ["loading", "spinIcon", "selected", "disabled"] as const;
const CONTENTS: readonly Content[] = ["text", "icon left", "icon right", "both icons"];

const code = (name: string) => (
	<code key="name" className="tr-code-text">
		{name}
	</code>
);

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

function variantsAndSizes(kind: Kind, docs: ButtonDocs) {
	const VARIANTS = keys(docs.variants);
	const SIZES = keys(docs.sizes);
	return function VariantsAndSizes() {
		return (
			<>
				<Table
					head={["Variant", ...SIZES.map((size) => size.toUpperCase()), "Use it for"]}
					rows={VARIANTS.map((variant) => [
						code(variant),
						...SIZES.map((size) => (
							<MeasuredHeight key={size}>
								<Specimen kind={kind} config={{ variant, size, content: "icon left" }} />
							</MeasuredHeight>
						)),
						<InlineMarkdown key="text" source={docs.variants[variant]} />,
					])}
				/>
				<Table
					head={["Size", "Use it for"]}
					rows={SIZES.map((size) => [
						code(size),
						<InlineMarkdown key="text" source={docs.sizes[size]} />,
					])}
				/>
			</>
		);
	};
}

function stateMatrix(kind: Kind, docs: ButtonDocs) {
	const VARIANTS = keys(docs.variants);
	return function StateMatrix() {
		return (
			<Table
				head={["Variant", "Hover · press · Tab", "Disabled", "Loading", "Selected"]}
				rows={VARIANTS.map((variant) => [
					code(variant),
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
		);
	};
}

function toneMatrix(kind: Kind, docs: ButtonDocs) {
	const TONES = keys(docs.tones.docs);
	return function ToneMatrix() {
		return (
			<>
				<Table
					head={["Variant", ...TONES, "disabled"]}
					rows={TONED.map((variant) => [
						code(variant),
						...TONES.map((tone) => (
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
					rows={TONES.map((tone) => [
						code(tone),
						<InlineMarkdown key="text" source={docs.tones.docs[tone]} />,
					])}
				/>
			</>
		);
	};
}

function toConfig(values: PlaygroundValues): SpecimenConfig {
	const tone = values.tone === "none" ? undefined : (values.tone as ButtonTone);
	return {
		variant: values.variant as ButtonVariant,
		size: values.size as ButtonSize,
		tone,
		content: (values.content as Content | undefined) ?? "text",
		...Object.fromEntries(FLAGS.map((flag) => [flag, values[flag] === true])),
	};
}

function playground(kind: Kind, docs: ButtonDocs): PlaygroundConfig {
	const TONES = keys(docs.tones.docs);
	return {
		controls: [
			{ kind: "choice", name: "variant", options: keys(docs.variants) },
			{ kind: "choice", name: "size", options: keys(docs.sizes) },
			...(kind === "button"
				? [{ kind: "choice" as const, name: "content", options: CONTENTS }]
				: []),
			{ kind: "choice", name: "tone", options: ["none", ...TONES] },
			...FLAGS.map((name) => ({ kind: "flag" as const, name })),
		],
		initial: {
			variant: kind === "icon-button" ? "ghost" : "primary",
			size: kind === "icon-button" ? "m" : "l",
			content: "icon left",
			tone: "none",
		},
		Preview: ({ values }) => <Specimen kind={kind} config={toConfig(values)} />,
		code: (values) => specimenCode(kind, toConfig(values)),
	};
}

export function buttonShowcase(kind: Kind, docs: ButtonDocs): Showcase {
	return {
		sections: [
			{ id: "variants", Render: variantsAndSizes(kind, docs) },
			{ id: "states", Render: stateMatrix(kind, docs) },
			{ id: "tone", Render: toneMatrix(kind, docs) },
		],
		playground: playground(kind, docs),
	};
}
