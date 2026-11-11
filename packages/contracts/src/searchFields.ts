import type { MatchField } from "./match";

export type SearchFieldSource =
	| { readonly kind: "file"; readonly path: string }
	| {
			readonly kind: "spec";
			readonly title: string;
			readonly specId: string;
			readonly path: string;
	  }
	| { readonly kind: "plan" | "transcript"; readonly title: string };

export function searchHitFields(source: SearchFieldSource): MatchField[] {
	switch (source.kind) {
		case "file":
			return [{ key: "path", text: source.path, path: true }];
		case "spec":
			return [
				{ key: "title", text: source.title },
				{ key: "id", text: source.specId, secondary: true },
				{ key: "path", text: source.path, path: true, secondary: true },
			];
		case "plan":
		case "transcript":
			return [{ key: "title", text: source.title }];
	}
}
