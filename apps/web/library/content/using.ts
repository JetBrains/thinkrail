import type { GuidePage } from "./types";

export const using = {
	slug: "using",
	title: "Using the library",
	summary:
		"This library renders ThinkRail's production components from source with the app's own stylesheet, tokens and themes. When a component changes, its page changes with it. The written guidance here is also published as `packages/ui/COMPONENTS.md` for agents and reviews.",
	sections: [
		{
			title: "Rules",
			body: "Follow these before writing any UI, and cite the IDs in reviews.",
			rules: [
				{
					id: "LIB-1",
					text: "**Search and reuse first.** Look for an existing component and its supported variants in this library, `packages/ui/*.tsx`, `apps/web/src/components` and the owning feature module, and check how real call sites use it.",
				},
				{
					id: "LIB-2",
					text: "**Compose or extend before adding.** Combine existing components, or extend one when its behaviour and semantic contract stay the same. Add a component only when the system cannot express the need.",
				},
				{
					id: "LIB-3",
					text: "**Choose by contract, not by look.** Buttons, switches, tabs, menu items, tree rows and disclosures behave differently for keyboards and assistive technology. Never restyle one into another.",
				},
				{
					id: "LIB-4",
					text: "**Use supported props; never recreate appearance.** A component owns its geometry, colour, typography and states. A call site passes props and adds placement only — no copied skins, no state classes, no colour or type overrides.",
				},
				{
					id: "LIB-5",
					text: "**A new component ships with its documentation.** Compare it with the nearest existing components (behaviour, API, styling), record what you adopted and rejected, place it at the right level — shared primitive in `packages/ui`, app composite in `apps/web/src/components`, or local to its feature — and add its page, live examples and checks to this library in the same change.",
				},
			],
		},
		{
			title: "Where values live",
			body: "The library explains usage; it never restates values. Implementation values stay in production code and the token sources: the component source (`packages/ui/<name>.tsx`) and its spec (`packages/ui/SPEC.md`), colour roles (`apps/web/src/styles/COLOR.md`), typography (`TYPOGRAPHY.md`) and spacing (`SPACING.md`). A missing token is added at its source and validated there, never at a call site.",
		},
		{
			title: "Examples",
			body: "Every example is a real component rendered from source with mocked data and real interactions — hover, press, Tab, click. Copy the code as a starting point; labels use locale keys, as the app requires.",
		},
		{
			title: "Adding a component page",
			body: "Write its guidance in `apps/web/library/content/<name>.ts` — including its sidebar `group` and the example shown as its overview `preview` — and its examples in `apps/web/library/examples/<name>/`, register it in `content/index.ts`, then run `bun run library:md` to regenerate the Markdown reference. `library.test.ts` fails when the reference is stale, an example file is missing, or a listed production usage no longer uses the component.",
		},
		{
			title: "Commands",
			body: "`bun run library:dev` starts the library with hot reload. `bun run library:build` checks the Markdown reference, typechecks and writes the static site to `apps/web/dist-library/`. `bun run library:md` regenerates `packages/ui/COMPONENTS.md`.",
		},
	],
} satisfies GuidePage;
