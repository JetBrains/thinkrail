export const sectionTitles = {
	when: "When to use",
	examples: "Examples",
	states: "States",
	playground: "Playground",
	api: "API",
	accessibility: "Accessibility",
	rules: "Usage rules",
	usages: "In production",
	contract: "System contract",
} as const;

export type SectionId = keyof typeof sectionTitles;
