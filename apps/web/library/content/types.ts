export interface PropDoc {
	type: string;
	default?: string;
	description: string;
}

export interface ExampleDoc {
	id: string;
	title: string;
	description: string;
}

export interface UsageLocation {
	file: string;
	note: string;
}

export interface Rule {
	id: string;
	text: string;
}

export interface StateDoc {
	state: string;
	how: string;
	appearance: string;
}

export interface SectionDoc {
	id: string;
	title: string;
	description?: string;
	table?: { head: readonly string[]; rows: readonly (readonly string[])[] };
}

export interface ComponentDoc {
	slug: string;
	name: string;
	group: string;
	source: string;
	preview: string;
	tag: string;
	importLine: string;
	summary: string;
	whenToUse: readonly string[];
	alternatives: readonly { name: string; when: string }[];
	anatomy: readonly { part: string; description: string }[];
	props: Readonly<Record<string, PropDoc>>;
	nativeProps?: { title: string; props: Readonly<Record<string, PropDoc>> };
	variants?: Readonly<Record<string, string>>;
	sizes?: Readonly<Record<string, string>>;
	tones?: { note: string; docs: Readonly<Record<string, string>> };
	sections?: readonly SectionDoc[];
	states: readonly StateDoc[];
	accessibility: readonly string[];
	keyboard: readonly { keys: string; action: string }[];
	rules: readonly Rule[];
	examples: readonly ExampleDoc[];
	usages: readonly UsageLocation[];
	contract?: string;
}

export type DocArea = "guides" | "foundations" | "patterns" | "vocabulary";

export interface DocPage {
	slug: string;
	area: DocArea;
	title: string;
	summary: string;
	file: string;
	sources: readonly string[];
	output?: { path: string; heading: string; frontmatter?: string };
}
