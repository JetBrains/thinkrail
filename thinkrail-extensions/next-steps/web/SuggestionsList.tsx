import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { readSuggestions } from "./suggestions";

export function SuggestionsList({ args, result }: ToolRenderProps) {
	const t = useT();
	const suggestions = readSuggestions(args, result);
	if (suggestions.length === 0)
		return <p className="tr-text-ui text-text-muted">{t("nextSteps.list.empty")}</p>;
	return (
		<ul className="flex list-disc flex-col gap-2 pl-16 tr-text-ui text-text-default">
			{suggestions.map((suggestion) => (
				<li key={suggestion}>{suggestion}</li>
			))}
		</ul>
	);
}
