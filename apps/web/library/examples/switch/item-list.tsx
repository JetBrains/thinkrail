import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";

const EXTENSIONS: readonly { name: string; title: string; description: MessageKey }[] = [
	{
		name: "visualize",
		title: "Visualize",
		description: "settings.extensions.visualize.description",
	},
	{
		name: "web-access",
		title: "Web access",
		description: "settings.extensions.web-access.description",
	},
];

export default function ItemList() {
	const t = useT();
	const [disabled, setDisabled] = useState<readonly string[]>(["web-access"]);
	const toggle = (name: string, enabled: boolean) =>
		setDisabled((list) => (enabled ? list.filter((item) => item !== name) : [...list, name]));
	return (
		<ul className="flex w-full max-w-[28rem] flex-col gap-12">
			{EXTENSIONS.map((entry) => (
				<li key={entry.name} className="flex items-start justify-between gap-12">
					<span className="flex min-w-0 flex-col gap-4">
						<span className="tr-title-compact text-text-default">{entry.title}</span>
						<span className="tr-text-metadata text-text-muted">{t(entry.description)}</span>
					</span>
					<Switch
						checked={!disabled.includes(entry.name)}
						label={t("settings.extensions.enable", { title: entry.title })}
						testId={`extension-toggle-${entry.name}`}
						onCheckedChange={(next) => toggle(entry.name, next)}
					/>
				</li>
			))}
		</ul>
	);
}
