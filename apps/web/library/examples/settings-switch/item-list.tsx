import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsSwitch } from "@/panels/SettingsSwitch";

const MODELS = [
	{ id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "anthropic", window: "200K" },
	{ id: "gpt-5", name: "GPT-5", provider: "openai", window: "400K" },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google", window: "1M" },
];

export default function ItemList() {
	const t = useT();
	const [hidden, setHidden] = useState<readonly string[]>(["gemini-2.5-pro"]);
	const toggle = (id: string) =>
		setHidden((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
	return (
		<div className="flex w-full max-w-[28rem] flex-col gap-12">
			{MODELS.map((model) => (
				<div key={model.id} className="flex items-center gap-12">
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate tr-text-ui text-text-default">{model.name}</span>
						<span className="truncate tr-text-metadata text-text-muted">
							{t("settings.visibleModels.meta", { provider: model.provider, window: model.window })}
						</span>
					</span>
					<SettingsSwitch
						checked={!hidden.includes(model.id)}
						label={t("settings.visibleModels.show", { name: model.name })}
						testId={`model-visibility-${model.provider}-${model.id}`}
						onChange={() => toggle(model.id)}
					/>
				</div>
			))}
		</div>
	);
}
