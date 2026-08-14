// spec_types — the registered type cards: the list (name, title, description, lifecycle, origin), or
// one card in full. Reading the card before authoring a spec of its type is the norm the skill sets —
// and for built-in cards (embedded, no file on disk) this tool is the only way to read the body.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ResolvedTypeCard, SpecLifecycle, TypeCardOrigin } from "../core/index.ts";
import { errorResult, getRegistry, textResult } from "./shared.ts";

const parameters = Type.Object({
	name: Type.Optional(
		Type.String({
			description: "A type name: return that card in full (frontmatter core + prose body).",
		}),
	),
});

/** One row of the type listing. */
interface TypeListEntry {
	name: string;
	title: string;
	description: string;
	lifecycle: SpecLifecycle;
	origin: TypeCardOrigin;
	/** Card file path for project/user cards; null for built-ins (embedded — read via spec_types). */
	path: string | null;
}

interface ListDetails {
	types: TypeListEntry[];
}

/** The full-card result: the listing row plus the card's structured core and prose body. */
interface CardDetails extends TypeListEntry {
	home: string | null;
	sections: string[];
	fields: string[];
	statuses: string[];
	links: Record<string, string>;
	body: string;
}

function toEntry(card: ResolvedTypeCard): TypeListEntry {
	return {
		name: card.name,
		title: card.title,
		description: card.description,
		lifecycle: card.lifecycle,
		origin: card.origin,
		path: card.path ?? null,
	};
}

export function registerSpecTypes(pi: ExtensionAPI): void {
	pi.registerTool<typeof parameters, ListDetails | CardDetails | { error: string }>({
		name: "spec_types",
		label: "Spec Types",
		description:
			"List the registered spec types (type cards: name, description, lifecycle, origin), or — given a name — return that card in full, body included. Read a type's card before creating a spec of that type. Types resolve project (.pi/spec-types/) over built-ins.",
		promptSnippet:
			"spec_types — list the registered spec types, or read one type card in full (do this before authoring a spec of that type).",
		parameters,
		async execute(_callId, params, _signal, _onUpdate, ctx) {
			const registry = getRegistry(ctx.cwd);
			if (params.name !== undefined) {
				const card = registry.get(params.name);
				if (card === undefined) {
					const known = registry
						.cards()
						.map((c) => c.name)
						.join(", ");
					return errorResult(`No type card named "${params.name}". Registered: ${known}.`);
				}
				const details: CardDetails = {
					...toEntry(card),
					home: card.home ?? null,
					sections: card.sections,
					fields: card.fields,
					statuses: card.statuses,
					links: card.links,
					body: card.body,
				};
				const header = [
					`# ${card.title} (${card.name}) — ${card.lifecycle}, ${card.origin}`,
					card.description,
					card.home !== undefined ? `home: ${card.home}` : null,
					card.sections.length > 0 ? `sections: ${card.sections.join(", ")}` : null,
					card.statuses.length > 0 ? `statuses: ${card.statuses.join(" | ")}` : null,
				]
					.filter((line): line is string => line !== null)
					.join("\n");
				return textResult(`${header}\n${card.body}`, details);
			}

			const types = registry.cards().map(toEntry);
			const text = types
				.map((t) => `${t.name} (${t.lifecycle}, ${t.origin}) — ${t.description}`)
				.join("\n");
			return textResult(text, { types });
		},
	});
}
